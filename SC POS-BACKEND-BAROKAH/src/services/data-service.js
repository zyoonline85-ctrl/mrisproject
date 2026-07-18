const fs = require("fs");
const path = require("path");
const db = require("../db/knex");
const env = require("../config/env");
const { hasApkAccess } = require("../config/permission-catalog");
const adminMockApi = require("./admin-mock-api");
const getMockData = () => adminMockApi.getStaticData();
const mockData = new Proxy(
  {},
  {
    get(_target, prop) {
      return getMockData()?.[prop];
    }
  }
);
const { parseJson } = require("../utils/json");
const { buildSimpleAccountingProfitLoss } = require("../modules/reports/profit-loss-builder");
const { buildDashboardSalesByOutlet } = require("../modules/dashboard/dashboard-sales-builder");
const { alphabeticPrefix, generateTableNumbers } = require("../modules/master-data/table-number-generator");
const { calculateStockOpname } = require("../modules/inventory/stock-opname-calculator");
const { normalizeActivityPayload } = require("../modules/activity-logs/activity-log");
const { markActivityWritten } = require("../modules/activity-logs/activity-request-context");
const { calculateMaterialDeltas, calculatePaymentCorrection, calculatePointCorrection, calculateTransactionCorrectionTotals } = require("../modules/transactions/transaction-correction-calculator");

const defaultAppSecurity = {
  report_pin_enabled: true,
  report_pin_hash: null
};

const financialAccountGroups = new Set(["cash_bank", "inventory", "other_current_asset", "fixed_asset", "moving_asset", "liability", "equity", "revenue", "discount", "cogs", "expense", "other_income", "other_expense"]);

function normalizeRole(role) {
  if (!role) return null;
  return {
    ...role,
    permissions: parseJson(role.permissions, {})
  };
}

function normalizePermission(permission) {
  return {
    ...permission,
    actions: parseJson(permission.actions, [])
  };
}

function dateOnly(value = new Date()) {
  if (value instanceof Date) {
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${value.getFullYear()}-${month}-${day}`;
  }
  return String(value || new Date().toISOString()).slice(0, 10);
}

const tableColumnExistsCache = new Map();

async function hasDbColumn(tableName, columnName) {
  const key = `${tableName}.${columnName}`;
  if (tableColumnExistsCache.has(key)) return tableColumnExistsCache.get(key);
  try {
    const exists = await db.schema.hasColumn(tableName, columnName);
    tableColumnExistsCache.set(key, exists);
    return exists;
  } catch (_error) {
    tableColumnExistsCache.set(key, false);
    return false;
  }
}

async function reportDateExpression(tableAlias, tableName, fallbackColumn) {
  const fallback = `${tableAlias}.${fallbackColumn}`;
  return (await hasDbColumn(tableName, "operational_at")) ? `COALESCE(${tableAlias}.operational_at, ${fallback})` : fallback;
}

function applyDateRangeExpression(query, expression, from, to) {
  if (from) query.whereRaw(`DATE(${expression}) >= ?`, [dateOnly(from)]);
  if (to) query.whereRaw(`DATE(${expression}) <= ?`, [dateOnly(to)]);
  return query;
}

function createRuntimeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function escapeRegExp(value) {
  return String(value)
    .split("")
    .map((char) => "\\.^$|?*+()[]{}-".includes(char) ? `\\${char}` : char)
    .join("");
}

function parseOrderSuffix(orderNumber, prefix) {
  const match = String(orderNumber || "").match(new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`));
  return match ? Number(match[1]) : 0;
}

async function maxExistingOrderSuffix(connection, prefix) {
  const likePrefix = `${prefix}-%`;
  const [transactions, openBills] = await Promise.all([
    connection("transactions").where("order_number", "like", likePrefix).select("order_number"),
    connection("open_bills").where("order_number", "like", likePrefix).select("order_number")
  ]);
  return [...transactions, ...openBills].reduce((max, row) => Math.max(max, parseOrderSuffix(row.order_number, prefix)), 0);
}

async function ensurePosOrderSequenceRow({ outletId, sequenceDate, connection = db } = {}) {
  const now = new Date();
  const sequenceId = `pos_seq_${outletId}_${sequenceDate.replace(/-/g, "")}`.slice(0, 40);
  await connection.raw(
    "INSERT INTO pos_order_sequences (id, outlet_id, sequence_date, last_number, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?) ON DUPLICATE KEY UPDATE updated_at = updated_at",
    [sequenceId, outletId, sequenceDate, now, now]
  );
  return now;
}

async function nextPosOrderNumber({ outletId, operationalAt = new Date(), connection = db } = {}) {
  const outlet = await connection("outlets").where({ id: outletId, status: "active" }).first();
  if (!outlet) throw new Error("Outlet transaksi tidak valid.");
  const sequenceDate = dateOnly(operationalAt);
  const prefix = `${outlet.code}-${sequenceDate.replace(/-/g, "")}`;
  const now = await ensurePosOrderSequenceRow({ outletId, sequenceDate, connection });

  const row = await connection("pos_order_sequences")
    .where({ outlet_id: outletId, sequence_date: sequenceDate })
    .forUpdate()
    .first();
  const currentMax = Math.max(Number(row?.last_number || 0), await maxExistingOrderSuffix(connection, prefix));
  const next = currentMax + 1;
  await connection("pos_order_sequences")
    .where({ outlet_id: outletId, sequence_date: sequenceDate })
    .update({ last_number: next, updated_at: now });
  return `${prefix}-${String(next).padStart(3, "0")}`;
}

async function reserveSubmittedPosOrderNumber({ outletId, orderNumber, operationalAt = new Date(), connection = db } = {}) {
  const outlet = await connection("outlets").where({ id: outletId, status: "active" }).first();
  if (!outlet) throw new Error("Outlet transaksi tidak valid.");
  const sequenceDate = dateOnly(operationalAt);
  const prefix = `${outlet.code}-${sequenceDate.replace(/-/g, "")}`;
  const suffix = parseOrderSuffix(orderNumber, prefix);
  if (!suffix) throw new Error("Nomor order tidak sesuai outlet atau tanggal operasional.");
  const now = await ensurePosOrderSequenceRow({ outletId, sequenceDate, connection });
  const row = await connection("pos_order_sequences")
    .where({ outlet_id: outletId, sequence_date: sequenceDate })
    .forUpdate()
    .first();
  const currentMax = Math.max(Number(row?.last_number || 0), await maxExistingOrderSuffix(connection, prefix), suffix);
  await connection("pos_order_sequences")
    .where({ outlet_id: outletId, sequence_date: sequenceDate })
    .update({ last_number: currentMax, updated_at: now });
}
function createTemporaryPassword() {
  return `Barokah${Math.random().toString(36).slice(2, 8)}`;
}

async function writeDbActivityLog(payload = {}) {
  const exists = await db.schema.hasTable("activity_logs");
  if (!exists) return;
  const normalized = normalizeActivityPayload(payload, {
    source: payload.source || "admin_web"
  });
  if (normalized.client_event_id) {
    const existing = await db("activity_logs").where({ client_event_id: normalized.client_event_id }).first();
    if (existing) return existing;
  }
  const now = new Date();
  const row = {
    id: payload.id && !String(payload.id).startsWith("activity_local_") ? payload.id : createRuntimeId("activity"),
    ...normalized,
    received_at: now,
    created_at: now
  };
  try {
    await db("activity_logs").insert(row);
    markActivityWritten();
  } catch (error) {
    if (normalized.client_event_id && ["ER_DUP_ENTRY", "SQLITE_CONSTRAINT"].includes(error?.code)) {
      return db("activity_logs").where({ client_event_id: normalized.client_event_id }).first();
    }
    throw error;
  }
  markActivityWritten();
  return row;
}

function productImageUrlFromFile(file) {
  return `/uploads/products/${path.basename(file.path)}`;
}

function deleteLocalProductImage(imagePath) {
  if (!imagePath) return;
  const absolutePath = path.isAbsolute(imagePath) ? imagePath : path.resolve(process.cwd(), imagePath);
  try {
    fs.unlinkSync(absolutePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function roundQuantity(value) {
  return Number(Number(value || 0).toFixed(3));
}

function isDiscountActiveForDate(discount, date = new Date()) {
  if (!discount || discount.status !== "active") return false;
  const currentDate = dateOnly(date);
  const startsAt = dateOnly(discount.starts_at);
  const endsAt = dateOnly(discount.ends_at);
  return startsAt <= currentDate && endsAt >= currentDate;
}

function attachDiscountOutlets(discounts = [], discountOutlets = []) {
  const outletIdsByDiscount = discountOutlets.reduce((result, row) => {
    result[row.discount_id] = result[row.discount_id] || [];
    result[row.discount_id].push(row.outlet_id);
    return result;
  }, {});
  return discounts.map((discount) => ({
    ...discount,
    outlet_ids: outletIdsByDiscount[discount.id] || []
  }));
}

async function roleById(roleId) {
  const role = await db("roles").where({ id: roleId }).first();
  return normalizeRole(role);
}

async function outletsForUser(userId) {
  return db("outlets").join("user_outlets", "outlets.id", "user_outlets.outlet_id").where("user_outlets.user_id", userId).select("outlets.*");
}

async function userContext(user) {
  if (!user) return null;
  const [role, outlets] = await Promise.all([roleById(user.role_id), outletsForUser(user.id)]);
  return {
    ...user,
    role,
    outlets,
    outlet_ids: outlets.map((outlet) => outlet.id)
  };
}

async function userByUsername(username) {
  const user = await db("users").where({ username }).first();
  return userContext(user);
}

async function userById(id) {
  const user = await db("users").where({ id }).first();
  return userContext(user);
}

function mockRoleById(roleId) {
  const store = adminMockApi.getStaticData();
  return normalizeRole(store.roles.find((role) => role.id === roleId));
}

function mockUserContext(user) {
  if (!user) return null;
  const store = adminMockApi.getStaticData();
  const outletIds = user.outlet_ids || [];
  const outlets = store.outlets.filter((outlet) => outletIds.includes(outlet.id));
  return {
    ...user,
    role: mockRoleById(user.role_id),
    outlets,
    outlet_ids: outletIds
  };
}

async function mockUserByUsername(username) {
  const store = adminMockApi.getStaticData();
  return mockUserContext(store.users.find((user) => user.username === username));
}

async function mockUserById(id) {
  const store = adminMockApi.getStaticData();
  return mockUserContext(store.users.find((user) => user.id === id));
}

function cashierLoginOption(user, { mockFallback = false } = {}) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    outlet_ids: user.outlet_ids || [],
    outlets: (user.outlets || []).map((outlet) => ({
      id: outlet.id,
      name: outlet.name,
      code: outlet.code
    })),
    status: user.status,
    role_id: user.role_id,
    role_name: user.role?.name || "",
    has_pin: Boolean(user.pin_hash || user.cashier_pin || (mockFallback && user.role_id === "role_cashier"))
  };
}

function sanitizeUserForAdmin(user, outletIds = user?.outlet_ids || [], { mockFallback = false } = {}) {
  const { password_hash: _passwordHash, pin_hash: _pinHash, cashier_pin: _cashierPin, ...safeUser } = user || {};
  return {
    ...safeUser,
    outlet_ids: outletIds,
    has_pin: Boolean(user.pin_hash || user.cashier_pin || (mockFallback && user?.role_id === "role_cashier" ? "000000" : ""))
  };
}

function normalizeUserAdminPayload(payload = {}, { isCreate = false, currentUser = null } = {}) {
  const name = String(payload.name || "").trim();
  const username = String(payload.username || "").trim();
  const email = String(payload.email || "")
    .trim()
    .toLowerCase();
  const roleId = String(payload.role_id || currentUser?.role_id || "").trim();
  const status = payload.status || currentUser?.status || "active";
  const outletIds = [...new Set(payload.outlet_ids || payload.outletIds || currentUser?.outlet_ids || [])].map((item) => String(item).trim()).filter(Boolean);
  const cashierPin = payload.cashier_pin || payload.pin || payload.cashierPin || "";

  if (!name) throw new Error("Nama user wajib diisi.");
  if (!username) throw new Error("Username wajib diisi.");
  if (!email) throw new Error("Email wajib diisi.");
  if (!roleId) throw new Error("Role wajib dipilih.");
  if (!["active", "inactive"].includes(status)) throw new Error("Status user tidak valid.");
  if (cashierPin && !/^\d{6}$/.test(String(cashierPin))) {
    throw new Error("PIN kasir wajib 6 digit.");
  }

  return {
    name,
    username,
    email,
    role_id: roleId,
    status,
    outlet_ids: outletIds,
    cashier_pin: String(cashierPin || "")
  };
}

function normalizeProfileAdminPayload(payload = {}) {
  const name = String(payload.name || "").trim();
  const username = String(payload.username || "").trim();
  const email = String(payload.email || "")
    .trim()
    .toLowerCase();
  if (!name) throw new Error("Nama profil wajib diisi.");
  if (!username) throw new Error("Username wajib diisi.");
  if (!email) throw new Error("Email wajib diisi.");
  return { name, username, email };
}

async function assertUniqueDbUser({ username, email, userId = null }) {
  const duplicateUsername = await db("users")
    .where({ username })
    .modify((query) => {
      if (userId) query.whereNot({ id: userId });
    })
    .first();
  if (duplicateUsername) throw new Error("Username sudah digunakan.");

  const duplicateEmail = await db("users")
    .where({ email })
    .modify((query) => {
      if (userId) query.whereNot({ id: userId });
    })
    .first();
  if (duplicateEmail) throw new Error("Email sudah digunakan.");
}

async function dbUserRowForAdmin(userId) {
  const user = await db("users").where({ id: userId }).first();
  if (!user) throw new Error("User tidak ditemukan.");
  const [role, outletRows] = await Promise.all([roleById(user.role_id), outletsForUser(user.id)]);
  const outletIds = outletRows.map((outlet) => outlet.id);
  return {
    ...sanitizeUserForAdmin(user, outletIds),
    role,
    outlets: outletRows
  };
}

async function replaceUserOutlets(trx, userId, outletIds = []) {
  await trx("user_outlets").where({ user_id: userId }).delete();
  if (outletIds.length) {
    await trx("user_outlets").insert(outletIds.map((outletId) => ({ user_id: userId, outlet_id: outletId })));
  }
}

async function cashiersForPinLogin() {
  const users = await db("users").where({ status: "active" }).whereNotNull("pin_hash").orderBy("name");
  const contexts = await Promise.all(users.map((user) => userContext(user)));
  return contexts
    .filter((user) => hasApkAccess(user.role))
    .map((user) => cashierLoginOption(user))
    .filter((user) => user.outlet_ids.length);
}

async function mockCashiersForPinLogin() {
  const store = adminMockApi.getStaticData();
  return store.users
    .filter((user) => user.status === "active" && Boolean(user.cashier_pin || (user.role_id === "role_cashier" ? "000000" : "")))
    .map(mockUserContext)
    .filter((user) => hasApkAccess(user.role))
    .map((user) => cashierLoginOption(user, { mockFallback: true }))
    .filter((user) => user.outlet_ids.length);
}

async function verifyPassword(session, password) {
  if (env.dataMode === "mock") {
    const expectedPassword = session?.role_id === "role_cashier" ? "demo123" : "admin123";
    return password === expectedPassword;
  }

  const bcrypt = require("bcryptjs");
  return bcrypt.compare(password, session.password_hash);
}

async function verifyCashierPin(session, pin) {
  if (env.dataMode === "mock") {
    const expectedPin = String(session?.cashier_pin || "000000");
    return pin === expectedPin;
  }

  if (!session?.pin_hash) return false;
  const bcrypt = require("bcryptjs");
  return bcrypt.compare(pin, session.pin_hash);
}

function sanitizeAppSecurity(security = {}) {
  return {
    report_pin_enabled: security.report_pin_enabled !== false,
    has_report_pin: Boolean(security.report_pin_hash || security.report_pin)
  };
}

async function getDbAppSecurityRaw() {
  const row = await db("metadata").where({ key: "app_security" }).first();
  return { ...defaultAppSecurity, ...parseJson(row?.value, {}) };
}

async function updateDbAppSecuritySettings(payload = {}) {
  const current = await getDbAppSecurityRaw();
  const enabled = payload.report_pin_enabled !== false;
  const hasSubmittedPin = Object.prototype.hasOwnProperty.call(payload, "report_pin") && payload.report_pin !== undefined && payload.report_pin !== null && payload.report_pin !== "";
  const pin = hasSubmittedPin ? String(payload.report_pin).trim() : "";

  if ((enabled && !current.report_pin_hash && !pin) || pin) {
    if (!/^\d{6}$/.test(pin)) {
      throw new Error("PIN laporan APK wajib 6 digit angka.");
    }
  }

  const bcrypt = require("bcryptjs");
  const next = {
    ...current,
    report_pin_enabled: enabled,
    report_pin_hash: pin ? bcrypt.hashSync(pin, 10) : current.report_pin_hash || null
  };

  const value = JSON.stringify(next);
  const existing = await db("metadata").where({ key: "app_security" }).first();
  if (existing) {
    await db("metadata").where({ key: "app_security" }).update({ value });
  } else {
    await db("metadata").insert({ key: "app_security", value });
  }

  return sanitizeAppSecurity(next);
}

async function updateAppSecuritySettings(payload = {}) {
  if (env.dataMode === "mock") {
    return adminMockApi.updateAppSecuritySettings(payload);
  }
  const result = await updateDbAppSecuritySettings(payload);
  await writeDbActivityLog({
    actor_user_id: payload.updated_by || payload.updatedBy || null,
    source: "admin_web",
    module: "settings",
    action: "app_security/update",
    entity_type: "app_security",
    entity_id: "report_pin",
    description: "Admin update PIN laporan APK",
    metadata_json: { report_pin_enabled: result.report_pin_enabled }
  });
  return result;
}

async function verifyReportPin(pin, actorUserId = null) {
  if (env.dataMode === "mock") {
    return adminMockApi.verifyReportPin(pin, actorUserId);
  }

  const security = await getDbAppSecurityRaw();
  const submittedPin = String(pin || "").trim();
  let valid = security.report_pin_enabled === false;
  if (!valid && security.report_pin_hash) {
    const bcrypt = require("bcryptjs");
    valid = await bcrypt.compare(submittedPin, security.report_pin_hash);
  }
  await writeDbActivityLog({
    actor_user_id: actorUserId,
    source: "kasir_app",
    module: "report_pin",
    action: "verify",
    entity_type: "app_security",
    entity_id: "report_pin",
    description: valid ? "Kasir berhasil verifikasi PIN laporan" : "Kasir gagal verifikasi PIN laporan",
    metadata_json: { valid }
  });
  return { valid };
}

function normalizeDbDiscountPayload(payload = {}, discountId = null) {
  const name = String(payload.name || "").trim();
  const type = String(payload.type || "").trim();
  const value = Number(payload.value);
  const startsAt = String(payload.starts_at || payload.startsAt || "").slice(0, 10);
  const endsAt = String(payload.ends_at || payload.endsAt || "").slice(0, 10);
  const status = payload.status || "active";
  const outletIds = [...new Set(payload.outlet_ids || payload.outletIds || [])].map(String).filter(Boolean);

  if (!name || !["nominal", "percent"].includes(type) || !Number.isFinite(value)) {
    throw new Error("Nama, tipe, dan nilai discount wajib valid.");
  }
  if (!outletIds.length) {
    throw new Error("Minimal 1 outlet discount wajib dipilih.");
  }
  if (type === "percent" && (value < 1 || value > 100)) {
    throw new Error("Nilai discount persen wajib 1 sampai 100.");
  }
  if (type === "nominal" && value <= 0) {
    throw new Error("Nilai discount nominal wajib lebih dari 0.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsAt) || !/^\d{4}-\d{2}-\d{2}$/.test(endsAt)) {
    throw new Error("Periode discount wajib diisi.");
  }
  if (endsAt < startsAt) {
    throw new Error("Tanggal selesai tidak boleh sebelum tanggal mulai.");
  }
  if (!["active", "inactive"].includes(status)) {
    throw new Error("Status discount tidak valid.");
  }

  return {
    name,
    type,
    value: type === "percent" ? Number(value) : Math.round(value),
    starts_at: startsAt,
    ends_at: endsAt,
    outlet_ids: outletIds,
    status,
    discountId
  };
}

async function assertDbDiscountPayload(payload) {
  const outlets = await db("outlets").whereIn("id", payload.outlet_ids).where({ status: "active" });
  if (outlets.length !== payload.outlet_ids.length) {
    throw new Error("Outlet discount tidak ditemukan atau nonaktif.");
  }

  const discounts = await db("discounts").select("id", "name");
  const discountOutlets = await db("discount_outlets").select("discount_id", "outlet_id");
  const outletIdsByDiscount = discountOutlets.reduce((result, row) => {
    result[row.discount_id] = result[row.discount_id] || [];
    result[row.discount_id].push(row.outlet_id);
    return result;
  }, {});
  const duplicate = discounts.some((discount) => {
    if (discount.id === payload.discountId || String(discount.name || "").toLowerCase() !== payload.name.toLowerCase()) {
      return false;
    }
    const existingOutletIds = outletIdsByDiscount[discount.id] || [];
    return payload.outlet_ids.some((outletId) => existingOutletIds.includes(outletId));
  });
  if (duplicate) {
    throw new Error("Nama discount sudah digunakan.");
  }
}

async function getDbDiscountRows({ outletId = null } = {}) {
  const [discounts, discountOutlets, outlets] = await Promise.all([db("discounts").orderBy(["starts_at", "name"]), db("discount_outlets"), db("outlets").select("id", "name", "code")]);
  const outletMap = new Map(outlets.map((outlet) => [outlet.id, outlet]));
  const outletIdsByDiscount = discountOutlets.reduce((result, row) => {
    result[row.discount_id] = result[row.discount_id] || [];
    result[row.discount_id].push(row.outlet_id);
    return result;
  }, {});

  return discounts
    .map((discount) => {
      const outletIds = outletIdsByDiscount[discount.id] || [];
      return {
        ...discount,
        value: Number(discount.value || 0),
        starts_at: dateOnly(discount.starts_at),
        ends_at: dateOnly(discount.ends_at),
        outlet_ids: outletIds,
        outlets: outletIds.map((id) => outletMap.get(id)).filter(Boolean)
      };
    })
    .filter((discount) => !outletId || discount.outlet_ids.includes(outletId));
}

async function createDiscount(payload = {}) {
  const discountPayload = normalizeDbDiscountPayload(payload);
  await assertDbDiscountPayload(discountPayload);
  const id = payload.id || createRuntimeId("discount");
  await db.transaction(async (trx) => {
    await trx("discounts").insert({
      id,
      name: discountPayload.name,
      type: discountPayload.type,
      value: discountPayload.value,
      starts_at: discountPayload.starts_at,
      ends_at: discountPayload.ends_at,
      status: discountPayload.status
    });
    await trx("discount_outlets").insert(
      discountPayload.outlet_ids.map((outletId) => ({
        discount_id: id,
        outlet_id: outletId
      }))
    );
  });
  await writeDbActivityLog({
    actor_user_id: payload.created_by || payload.createdBy || null,
    module: "discount",
    action: "create",
    entity_type: "discount",
    entity_id: id,
    description: `Discount ${discountPayload.name} dibuat.`,
    metadata_json: { outlet_ids: discountPayload.outlet_ids }
  });
  return (await getDbDiscountRows()).find((item) => item.id === id);
}

async function updateDiscount(discountId, payload = {}) {
  const existing = await db("discounts").where({ id: discountId }).first();
  if (!existing) throw new Error("Discount tidak ditemukan.");
  const discountPayload = normalizeDbDiscountPayload(payload, discountId);
  await assertDbDiscountPayload(discountPayload);
  await db.transaction(async (trx) => {
    await trx("discounts").where({ id: discountId }).update({
      name: discountPayload.name,
      type: discountPayload.type,
      value: discountPayload.value,
      starts_at: discountPayload.starts_at,
      ends_at: discountPayload.ends_at,
      status: discountPayload.status
    });
    await trx("discount_outlets").where({ discount_id: discountId }).delete();
    await trx("discount_outlets").insert(
      discountPayload.outlet_ids.map((outletId) => ({
        discount_id: discountId,
        outlet_id: outletId
      }))
    );
  });
  await writeDbActivityLog({
    actor_user_id: payload.updated_by || payload.updatedBy || null,
    module: "discount",
    action: "update",
    entity_type: "discount",
    entity_id: discountId,
    description: `Discount ${discountPayload.name} diperbarui.`,
    metadata_json: { outlet_ids: discountPayload.outlet_ids }
  });
  return (await getDbDiscountRows()).find((item) => item.id === discountId);
}

async function toggleDiscountStatus(discountId, actorUserId = null) {
  const existing = await db("discounts").where({ id: discountId }).first();
  if (!existing) throw new Error("Discount tidak ditemukan.");
  const status = existing.status === "active" ? "inactive" : "active";
  await db("discounts").where({ id: discountId }).update({ status });
  await writeDbActivityLog({
    actor_user_id: actorUserId,
    module: "discount",
    action: "toggle_status",
    entity_type: "discount",
    entity_id: discountId,
    description: `Status discount ${existing.name} menjadi ${status}.`
  });
  return (await getDbDiscountRows()).find((item) => item.id === discountId);
}

async function getPosDiscounts(filters = {}) {
  return getDbDiscountRows({ outletId: filters.outletId });
}

function customerToMobile(customer = {}) {
  return {
    id: customer.id,
    outletId: customer.outlet_id || customer.outletId,
    name: customer.name,
    phone: customer.phone,
    barcode: customer.barcode,
    points: Number(customer.points || 0)
  };
}

function normalizePhone(value) {
  return String(value || "")
    .replace(/[^0-9+]/g, "")
    .trim();
}

function normalizePaymentMethodCode(value) {
  return (
    String(value || "cash")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "cash"
  );
}

function selectedVariantsFromMetadata(metadata) {
  const parsed = parseJson(metadata, {});
  const variants = parsed?.selected_variants || parsed?.selectedVariants || [];
  return Array.isArray(variants)
    ? variants
        .map((variant) => ({
          id: variant.id,
          product_id: variant.product_id || variant.productId,
          name: variant.name
        }))
        .filter((variant) => variant.id || variant.name)
    : [];
}

function transactionItemToMobileDb(item = {}) {
  const selectedVariants = selectedVariantsFromMetadata(item.metadata_json);
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unit_price || item.unitPrice || 0);
  return {
    productId: item.product_id || item.productId || "",
    productName: item.product_name || item.productName || "",
    categoryId: item.category_id || item.categoryId || "",
    categoryName: item.category_name || item.categoryName || "",
    quantity,
    unitPrice,
    subtotal: Number(item.subtotal || quantity * unitPrice || 0),
    variantIds: selectedVariants.map((variant) => variant.id).filter(Boolean),
    selectedVariants
  };
}

function normalizeDbPaymentRows(input) {
  const rows = Array.isArray(input) ? input : input ? [input] : [];
  return rows
    .map((payment) => ({
      ...payment,
      method: payment?.method || payment?.payment_method || "cash",
      payment_method_id: payment?.payment_method_id || payment?.paymentMethodId || null,
      amount: Number(payment?.amount ?? payment?.paid_amount ?? payment?.paidAmount ?? 0),
      change_amount: Number(payment?.change_amount ?? payment?.changeAmount ?? 0)
    }))
    .filter((payment) => payment.method && Number(payment.amount || 0) > 0);
}

function transactionToMobileDb(transaction = {}, items = [], paymentInput = null) {
  const payments = normalizeDbPaymentRows(paymentInput);
  const payment = payments[0] || null;
  const paidAmount = payments.length
    ? payments.reduce((total, row) => total + Number(row.amount || 0), 0)
    : Number(transaction.paid_amount || transaction.paidAmount || transaction.total || 0);
  const changeAmount = payments.length
    ? payments.reduce((total, row) => total + Number(row.change_amount || 0), 0)
    : Number(transaction.change_amount || transaction.changeAmount || 0);

  return {
    id: transaction.id,
    orderNumber: transaction.order_number || transaction.orderNumber || "",
    outletId: transaction.outlet_id || transaction.outletId || "",
    cashierId: transaction.cashier_id || transaction.cashierId || "",
    serviceType: transaction.service_type || transaction.serviceType || (transaction.table_number ? "dine_in" : "takeaway"),
    tableNumber: transaction.table_number || transaction.tableNumber || null,
    paymentMethod: payment?.method || transaction.payment_method || transaction.paymentMethod || "cash",
    paymentMethodId: payment?.payment_method_id || transaction.payment_method_id || transaction.paymentMethodId || null,
    paidAmount,
    changeAmount,
    payments,
    subtotal: Number(transaction.subtotal || transaction.total || 0),
    discount: Number(transaction.discount || 0),
    tax: Number(transaction.tax || 0),
    total: Number(transaction.total || 0),
    note: transaction.note || "",
    discountId: transaction.discount_id || transaction.discountId || null,
    discountType: transaction.discount_type || transaction.discountType || null,
    discountValue: Number(transaction.discount_value || transaction.discountValue || 0),
    discountName: transaction.discount_name || transaction.discountName || null,
    createdAt: serializeDateTime(transaction.transaction_date || transaction.createdAt),
    transactionDate: serializeDateTime(transaction.transaction_date || transaction.createdAt),
    status: transaction.status || "paid",
    synced: true,
    customerId: transaction.customer_id || transaction.customerId || null,
    customerName: transaction.customer_name || transaction.customerName || null,
    customerPhone: transaction.customer_phone || transaction.customerPhone || null,
    customerPointsBefore: Number(transaction.customer_points_before || transaction.customerPointsBefore || 0),
    customerPointsEarned: Number(transaction.customer_points_earned || transaction.customerPointsEarned || 0),
    customerPointsAfter: Number(transaction.customer_points_after || transaction.customerPointsAfter || 0),
    items: items.map(transactionItemToMobileDb)
  };
}

async function fetchDbTransactions({ outletId = "all", from, to, paymentMethod = "all", statuses = null } = {}) {
  const paymentFilter = paymentMethod && paymentMethod !== "all" ? normalizePaymentMethodCode(paymentMethod) : null;
  const rows = await db("transactions as t")
    .leftJoin("dining_tables as dt", "dt.id", "t.table_id")
    .select("t.*", db.raw("dt.number as table_number"))
    .modify((query) => {
      if (outletId && outletId !== "all") query.where("t.outlet_id", outletId);
      if (from) query.whereRaw("date(t.transaction_date) >= ?", [dateOnly(from)]);
      if (to) query.whereRaw("date(t.transaction_date) <= ?", [dateOnly(to)]);
      if (Array.isArray(statuses) && statuses.length) query.whereIn("t.status", statuses);
      if (paymentFilter) {
        query.whereExists(function paymentExists() {
          this.select(1)
            .from("payments as pf")
            .whereRaw("pf.transaction_id = t.id")
            .where("pf.method", paymentFilter);
        });
      }
    })
    .orderBy("t.transaction_date", "desc")
    .orderBy("t.id", "desc");

  const transactionIds = rows.map((row) => row.id);
  const [items, payments] = transactionIds.length
    ? await Promise.all([
        db("transaction_items as ti").leftJoin("products as p", "p.id", "ti.product_id").leftJoin("categories as c", "c.id", "p.category_id").whereIn("ti.transaction_id", transactionIds).select("ti.*", db.raw("p.name as product_name"), db.raw("p.category_id as category_id"), db.raw("c.name as category_name")),
        db("payments").whereIn("transaction_id", transactionIds).orderBy("paid_at").orderBy("id")
      ])
    : [[], []];
  const itemsByTransaction = items.reduce((result, item) => {
    result[item.transaction_id] = result[item.transaction_id] || [];
    result[item.transaction_id].push(item);
    return result;
  }, {});
  const paymentsByTransaction = payments.reduce((result, payment) => {
    result[payment.transaction_id] = result[payment.transaction_id] || [];
    result[payment.transaction_id].push(payment);
    return result;
  }, {});

  return rows.map((row) =>
    transactionToMobileDb(row, itemsByTransaction[row.id] || [], paymentsByTransaction[row.id] || [])
  );
}

function buildDailySales(rows = [], from, to) {
  const totals = new Map();
  rows.forEach((transaction) => {
    const key = dateOnly(transaction.createdAt || transaction.transactionDate || transaction.transaction_date || transaction.created_at);
    totals.set(key, (totals.get(key) || 0) + Number(transaction.total || 0));
  });
  if (!from || !to) {
    return [...totals.entries()].map(([date, total]) => ({ date, total })).sort((a, b) => a.date.localeCompare(b.date));
  }
  const result = [];
  const cursor = new Date(`${dateOnly(from)}T00:00:00`);
  const end = new Date(`${dateOnly(to)}T00:00:00`);
  while (cursor <= end) {
    const key = dateOnly(cursor);
    result.push({ date: key, total: totals.get(key) || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function buildDailyExpenses(rows = [], from, to) {
  const totals = new Map();
  rows
    .filter((expense) => (expense.status || "approved") === "approved")
    .forEach((expense) => {
      const dateValue = expense.operationalAt || expense.operational_at || expense.expense_date || expense.date || expense.created_at;
      if (!dateValue) return;
      const key = dateOnly(dateValue);
      totals.set(key, (totals.get(key) || 0) + Number(expense.amount || 0));
    });
  if (!from || !to) {
    return [...totals.entries()].map(([date, total]) => ({ date, total })).sort((a, b) => a.date.localeCompare(b.date));
  }
  const result = [];
  const cursor = new Date(`${dateOnly(from)}T00:00:00`);
  const end = new Date(`${dateOnly(to)}T00:00:00`);
  while (cursor <= end) {
    const key = dateOnly(cursor);
    result.push({ date: key, total: totals.get(key) || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function reportPercentOf(amount, base) {
  return base ? Number(((Number(amount || 0) / Number(base || 0)) * 100).toFixed(2)) : 0;
}

function accountingReportRow(description, total, base, options = {}) {
  return {
    description,
    total: Math.round(Number(total || 0)),
    percent_of_income: reportPercentOf(total, base),
    level: options.level || 0,
    kind: options.kind || "account",
    bold: Boolean(options.bold),
    account_code: options.account_code || null
  };
}

function describeReportAccount(account, fallback, code = null) {
  const accountCode = account?.code || code || null;
  const name = account?.name || fallback || "Akun";
  return accountCode ? `[${accountCode}] ${name}` : name;
}

function groupReportAmounts(items = [], keyFn, descriptionFn) {
  const groups = new Map();
  items.forEach((item) => {
    const amount = Number(item.amount ?? item.total ?? 0);
    if (!amount) return;
    const accountCode = item.account_code || item.account?.code || null;
    const key = keyFn(item) || accountCode || item.id || item.description || "unmapped";
    const current = groups.get(key) || {
      key,
      description: descriptionFn(item),
      account_code: accountCode,
      total: 0
    };
    current.total += amount;
    if (!current.account_code && accountCode) current.account_code = accountCode;
    groups.set(key, current);
  });
  return [...groups.values()].sort((a, b) => String(a.description || "").localeCompare(String(b.description || ""), "id-ID"));
}

function financeEntrySignedAmount(entry = {}) {
  return (entry.movement_type || "in") === "out" ? -Number(entry.amount || 0) : Number(entry.amount || 0);
}

async function buildBalanceSheetReportDb({ outletId = "all", netIncome = 0, date } = {}) {
  const reportDate = date || getDefaultReportRange().to;
  const [accounts, paymentMethods, transactionRows, stockRows, financeEntries, bonPurchases] = await Promise.all([
    db("financial_accounts").orderBy("sort_order"),
    db("payment_methods").catch(() => []),
    db("transactions as t")
      .leftJoin("payments as p", "p.transaction_id", "t.id")
      .leftJoin("outlets as o", "o.id", "t.outlet_id")
      .select("t.id", "t.order_number", "t.total", "t.transaction_date", "t.outlet_id", "p.method as payment_method", "o.name as outlet_name")
      .where("t.status", "paid")
      .modify((query) => {
        applyOutletFilter(query, "t.outlet_id", outletId);
        applyDateRange(query, "t.transaction_date", null, reportDate);
      }),
    db("raw_material_stocks as rms")
      .leftJoin("raw_materials as rm", "rm.id", "rms.material_id")
      .leftJoin("outlets as o", "o.id", "rms.outlet_id")
      .select("rms.*", "rm.name as material_name", "rm.unit as material_unit", "o.name as outlet_name")
      .modify((query) => applyOutletFilter(query, "rms.outlet_id", outletId)),
    db("balance_sheet_entries as bse")
      .leftJoin("financial_accounts as fa", "fa.code", "bse.account_code")
      .select("bse.*", "fa.report_group as account_report_group")
      .whereNot("bse.status", "inactive")
      .modify((query) => {
        applyOutletFilter(query, "bse.outlet_id", outletId, {
          includeGlobal: true
        });
        applyDateRange(query, "bse.entry_date", null, reportDate);
      }),
    db("purchases as p")
      .leftJoin("suppliers as s", "s.id", "p.supplier_id")
      .select("p.*", "s.name as supplier_name")
      .where("p.status", "approved")
      .where("p.payment_type", "bon")
      .modify((query) => {
        applyOutletFilter(query, "p.outlet_id", outletId);
        applyDateRange(query, "p.purchase_date", null, reportDate);
      })
  ]);

  const activeAccounts = accounts.filter((account) => account.status !== "inactive");
  const accountByCode = new Map(activeAccounts.map((account) => [String(account.code), account]));
  const paymentMethodByCode = new Map();
  paymentMethods.forEach((method) => {
    paymentMethodByCode.set(String(method.code || ""), method);
    paymentMethodByCode.set(normalizePaymentMethodCode(method.code), method);
  });
  const cashAccount = findPrimaryAccount(activeAccounts, "cash_bank");
  const inventoryAccount = findPrimaryAccount(activeAccounts, "inventory");
  const liabilityAccount = findPrimaryAccount(activeAccounts, "liability");
  const financeRows = financeEntries.map((entry) => ({
    ...entry,
    account: accountByCode.get(String(entry.account_code)) || null,
    group: entry.account_report_group || entry.group,
    amount: financeEntrySignedAmount(entry)
  }));
  const financeGroupRows = (groups) => financeRows.filter((entry) => groups.includes(entry.group));
  const financeGroupsByAccount = (groups, keyPrefix, fallback) =>
    groupReportAmounts(
      financeGroupRows(groups),
      (entry) => `${keyPrefix}_${entry.account_code || entry.id}`,
      (entry) => describeReportAccount(entry.account, entry.name || fallback, entry.account_code)
    );

  const cashGroups = groupReportAmounts(
    transactionRows.map((transaction) => {
      const paymentCode = normalizePaymentMethodCode(transaction.payment_method || "cash");
      const method = paymentMethodByCode.get(paymentCode) || {};
      const account = accountByCode.get(String(method.account_code || "")) || cashAccount;
      return {
        amount: Number(transaction.total || 0),
        account,
        account_code: account?.code || method.account_code || null
      };
    }),
    (item) => `cash_${item.account_code || "unmapped"}`,
    (item) => describeReportAccount(item.account, "Kas / Bank", item.account_code)
  );

  const inventory = stockRows.reduce((total, stock) => total + (Number(stock.stock_value || 0) || Number(stock.quantity || 0) * Number(stock.last_purchase_price || 0)), 0);
  const otherCurrentAssetGroups = financeGroupsByAccount(["other_current_asset", "reserve_fund"], "current_asset", "Aset Lancar Lain");
  const fixedAssetGroups = financeGroupsByAccount(["fixed_asset"], "fixed_asset", "Aset Tetap");
  const movingAssetGroups = financeGroupsByAccount(["moving_asset"], "moving_asset", "Aset Bergerak");
  const liabilityEntryGroups = financeGroupsByAccount(["liability"], "liability", "Kewajiban");
  const bonTotal = bonPurchases.reduce((total, purchase) => total + Number(purchase.total || 0), 0);
  const bonGroups = bonTotal
    ? [
        {
          description: describeReportAccount(liabilityAccount, "Hutang / Bon Pembelian"),
          account_code: liabilityAccount?.code || null,
          total: bonTotal,
          amount: bonTotal
        }
      ]
    : [];
  const liabilityGroups = groupReportAmounts(
    [...liabilityEntryGroups, ...bonGroups],
    (item) => `liability_${item.account_code || item.key || item.description}`,
    (item) => item.description
  );
  const equityGroups = financeGroupsByAccount(["equity"], "equity", "Ekuitas");
  const cashTotal = cashGroups.reduce((total, item) => total + Number(item.total || 0), 0);
  const otherCurrentAssetTotal = otherCurrentAssetGroups.reduce((total, item) => total + Number(item.total || 0), 0);
  const fixedAssetTotal = fixedAssetGroups.reduce((total, item) => total + Number(item.total || 0), 0);
  const movingAssetTotal = movingAssetGroups.reduce((total, item) => total + Number(item.total || 0), 0);
  const totalAsset = cashTotal + inventory + otherCurrentAssetTotal + fixedAssetTotal + movingAssetTotal;
  const totalLiability = liabilityGroups.reduce((total, item) => total + Number(item.total || 0), 0);
  const inputEquity = equityGroups.reduce((total, item) => total + Number(item.total || 0), 0);
  const equity = inputEquity + Number(netIncome || 0);
  const liabilitiesAndEquity = totalLiability + equity;
  const balanceDifference = totalAsset - liabilitiesAndEquity;

  return {
    title: "Neraca",
    date: reportDate,
    columns: ["Description", "Total"],
    rows: [
      accountingReportRow("ASSET", 0, totalAsset, { kind: "section" }),
      accountingReportRow("Cash and Bank", 0, totalAsset, {
        level: 1,
        kind: "section"
      }),
      ...cashGroups.map((item) =>
        accountingReportRow(item.description, item.total, totalAsset, {
          level: 2,
          account_code: item.account_code
        })
      ),
      accountingReportRow("Total Cash and Bank", cashTotal, totalAsset, {
        level: 1,
        kind: "total",
        bold: true
      }),
      accountingReportRow("Inventory", 0, totalAsset, {
        level: 1,
        kind: "section"
      }),
      accountingReportRow(describeReportAccount(inventoryAccount, "Persediaan"), inventory, totalAsset, { level: 2, account_code: inventoryAccount?.code }),
      accountingReportRow("Total Inventory", inventory, totalAsset, {
        level: 1,
        kind: "total",
        bold: true
      }),
      accountingReportRow("Other Current Asset", 0, totalAsset, {
        level: 1,
        kind: "section"
      }),
      ...otherCurrentAssetGroups.map((item) =>
        accountingReportRow(item.description, item.total, totalAsset, {
          level: 2,
          account_code: item.account_code
        })
      ),
      accountingReportRow("Total Other Current Asset", otherCurrentAssetTotal, totalAsset, { level: 1, kind: "total", bold: true }),
      accountingReportRow("Fixed Asset", 0, totalAsset, {
        level: 1,
        kind: "section"
      }),
      ...fixedAssetGroups.map((item) =>
        accountingReportRow(item.description, item.total, totalAsset, {
          level: 2,
          account_code: item.account_code
        })
      ),
      accountingReportRow("Total Fixed Asset", fixedAssetTotal, totalAsset, {
        level: 1,
        kind: "total",
        bold: true
      }),
      accountingReportRow("Moving Asset", 0, totalAsset, {
        level: 1,
        kind: "section"
      }),
      ...movingAssetGroups.map((item) =>
        accountingReportRow(item.description, item.total, totalAsset, {
          level: 2,
          account_code: item.account_code
        })
      ),
      accountingReportRow("Total Moving Asset", movingAssetTotal, totalAsset, {
        level: 1,
        kind: "total",
        bold: true
      }),
      accountingReportRow("TOTAL ASSET", totalAsset, totalAsset, {
        kind: "grand_total",
        bold: true
      }),
      accountingReportRow("LIABILITIES AND EQUITY", 0, totalAsset, {
        kind: "section"
      }),
      accountingReportRow("LIABILITY", 0, totalAsset, {
        level: 1,
        kind: "section"
      }),
      ...liabilityGroups.map((item) =>
        accountingReportRow(item.description, item.total, totalAsset, {
          level: 2,
          account_code: item.account_code
        })
      ),
      accountingReportRow("Total Liability", totalLiability, totalAsset, {
        level: 1,
        kind: "total",
        bold: true
      }),
      accountingReportRow("EQUITY", 0, totalAsset, {
        level: 1,
        kind: "section"
      }),
      ...equityGroups.map((item) =>
        accountingReportRow(item.description, item.total, totalAsset, {
          level: 2,
          account_code: item.account_code
        })
      ),
      accountingReportRow("Net Income", netIncome, totalAsset, { level: 2 }),
      ...(Math.round(balanceDifference) !== 0 ? [accountingReportRow("Selisih belum seimbang", balanceDifference, totalAsset, { level: 2, kind: "warning" })] : []),
      accountingReportRow("Total Equity", equity, totalAsset, {
        level: 1,
        kind: "total",
        bold: true
      }),
      accountingReportRow("TOTAL LIABILITIES AND EQUITY", liabilitiesAndEquity, totalAsset, { kind: "grand_total", bold: true })
    ],
    summary: {
      assets: totalAsset,
      liabilities: totalLiability,
      equity,
      balance_difference: balanceDifference,
      balanced: Math.round(balanceDifference) === 0
    }
  };
}

async function getPosHistory(filters = {}) {
  return fetchDbTransactions(filters);
}

async function getPosReports({ outletId = "all", from, to } = {}) {
  const transactions = await fetchDbTransactions({
    outletId,
    from,
    to,
    statuses: ["paid"]
  });
  const [paymentMethods, expenses, purchases] = await Promise.all([
    db("payment_methods").whereNot("status", "inactive").orderBy("sort_order").orderBy("name"),
    getPosExpenses({ outletId, from, to }),
    getPosPurchases({ outletId, from, to })
  ]);
  const approvedExpenses = expenses.filter((expense) => (expense.status || "approved") === "approved");
  const approvedPurchases = purchases.filter((purchase) => (purchase.status || "pending") === "approved");
  const paymentTotals = paymentMethods.reduce((result, method) => ({ ...result, [method.code]: 0 }), {});
  transactions.forEach((transaction) => {
    const method = normalizePaymentMethodCode(transaction.paymentMethod || "cash");
    paymentTotals[method] = (paymentTotals[method] || 0) + Number(transaction.total || 0);
  });
  const revenue = transactions.reduce((total, transaction) => total + Number(transaction.total || 0), 0);
  const discountTotal = transactions.reduce((total, transaction) => total + Number(transaction.discount || 0), 0);
  const expenseTotal = approvedExpenses.reduce((total, expense) => total + Number(expense.amount || 0), 0);
  return {
    revenue,
    transaction_count: transactions.length,
    discount_total: discountTotal,
    expense_total: expenseTotal,
    net_total: revenue - expenseTotal,
    payment_totals: paymentTotals,
    sales_by_day: buildDailySales(transactions, from, to),
    expenses_by_day: buildDailyExpenses(approvedExpenses, from, to),
    accounting_profit_loss: buildSimpleAccountingProfitLoss({
      rows: transactions,
      approvedPurchases,
      approvedExpenses,
      paymentMethods,
      paymentTotals,
      from,
      to,
      outletId
    }),
    transactions,
    expenses
  };
}

async function normalizeTransactionPayloadForDb(payload = {}, createdBy = null) {
  const outletId = String(mobilePayloadValue(payload, "outletId", "outlet_id", "") || "").trim();
  const cashierId = String(mobilePayloadValue(payload, "cashierId", "cashier_id", createdBy || "") || "").trim();
  const orderNumber = String(mobilePayloadValue(payload, "orderNumber", "order_number", "") || "").trim();
  const transactionDate = serializeMysqlDateTime(mobilePayloadValue(payload, "operationalAt", "operational_at", mobilePayloadValue(payload, "createdAt", "transaction_date", new Date())));
  const transactionDateOnly = dateOnly(transactionDate);
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const productIds = [...new Set(rawItems.map((item) => String(mobilePayloadValue(item, "productId", "product_id", "") || "").trim()).filter(Boolean))];
  const [outlet, cashier, products, variants, paymentMethods, discounts] = await Promise.all([outletId ? db("outlets").where({ id: outletId, status: "active" }).first() : null, cashierId ? db("users").where({ id: cashierId, status: "active" }).first() : null, productIds.length ? db("products").whereIn("id", productIds).whereNot("status", "inactive") : [], productIds.length ? db("product_variants").whereIn("product_id", productIds).where({ status: "active" }) : [], db("payment_methods").whereNot("status", "inactive"), db("discounts").whereNot("status", "inactive")]);
  if (!outlet) throw new Error("Outlet transaksi tidak valid.");
  if (!cashier) throw new Error("Kasir transaksi tidak valid.");

  const productMap = new Map(products.map((product) => [product.id, product]));
  const variantMap = new Map(variants.map((variant) => [variant.id, variant]));
  const items = rawItems
    .map((item, index) => {
      const productId = String(mobilePayloadValue(item, "productId", "product_id", "") || "").trim();
      const product = productMap.get(productId);
      const quantity = Math.max(0, Math.round(mobilePayloadNumber(item, "quantity", "quantity", 0)));
      const unitPrice = Math.max(0, Math.round(mobilePayloadNumber(item, "unitPrice", "unit_price", 0)));
      if (!product || quantity <= 0 || unitPrice <= 0) throw new Error(`Produk, qty, dan harga baris ${index + 1} wajib valid.`);
      const requestedVariantIds = [...new Set([...((Array.isArray(item.variantIds) ? item.variantIds : []) || []), ...((Array.isArray(item.variant_ids) ? item.variant_ids : []) || []), ...((Array.isArray(item.selectedVariants) ? item.selectedVariants.map((variant) => variant.id) : []) || []), ...((Array.isArray(item.selected_variants) ? item.selected_variants.map((variant) => variant.id) : []) || [])].map((id) => String(id || "")).filter(Boolean))];
      const selectedVariants = requestedVariantIds.map((variantId) => {
        const variant = variantMap.get(variantId);
        if (!variant || variant.product_id !== productId) throw new Error("Catatan variant produk tidak valid atau tidak aktif.");
        return {
          id: variant.id,
          product_id: variant.product_id,
          name: variant.name
        };
      });
      return {
        product_id: productId,
        quantity,
        unit_price: unitPrice,
        subtotal: Math.max(0, Math.round(mobilePayloadNumber(item, "subtotal", "subtotal", quantity * unitPrice))),
        selectedVariants
      };
    })
    .filter((item) => item.product_id && item.quantity > 0);
  const subtotal = Math.max(
    0,
    Math.round(
      mobilePayloadNumber(
        payload,
        "subtotal",
        "subtotal",
        items.reduce((sum, item) => sum + item.subtotal, 0)
      )
    )
  );
  if (!items.length || subtotal <= 0) throw new Error("Item transaksi wajib diisi.");

  const rawDiscountId = mobilePayloadValue(payload, "discountId", "discount_id", null);
  const discountId = rawDiscountId == null || String(rawDiscountId).trim() === "" ? null : String(rawDiscountId).trim();
  const selectedDiscount = discountId ? discounts.find((discount) => discount.id === discountId) : null;
  let discount = 0;
  let discountType = null;
  let discountValue = 0;
  let discountName = null;
  if (discountId) {
    if (!selectedDiscount) throw new Error("Discount tidak aktif atau tidak valid.");
    const isActive = isDiscountActiveForDate(selectedDiscount, transactionDateOnly);
    const outletRows = await db("discount_outlets").where({
      discount_id: discountId
    });
    if (!isActive || !outletRows.some((row) => row.outlet_id === outletId)) throw new Error("Discount tidak berlaku untuk outlet atau periode transaksi.");
    const value = Math.max(0, Number(selectedDiscount.value || 0));
    discount = Math.min(subtotal, selectedDiscount.type === "percent" ? Math.round((subtotal * value) / 100) : Math.round(value));
    discountType = selectedDiscount.type;
    discountValue = value;
    discountName = selectedDiscount.name;
  } else {
    const manualType = String(mobilePayloadValue(payload, "discountType", "discount_type", "") || "").trim();
    const manualValue = Math.max(0, Math.round(mobilePayloadNumber(payload, "discountValue", "discount_value", 0)));
    if ((manualType === "percent" || manualType === "nominal") && manualValue > 0) {
      if (manualType === "percent" && (manualValue < 1 || manualValue > 100)) throw new Error("Discount persen wajib 1 sampai 100.");
      discount = Math.min(subtotal, manualType === "percent" ? Math.round((subtotal * manualValue) / 100) : manualValue);
      discountType = manualType;
      discountValue = manualValue;
      discountName = "Diskon Manual";
    }
  }

  const requestedServiceType = String(mobilePayloadValue(payload, "serviceType", "service_type", "takeaway") || "takeaway");
  const rawTableNumber = mobilePayloadValue(payload, "tableNumber", "table_number", null);
  const tableNumber = rawTableNumber == null ? "" : String(rawTableNumber).trim().toUpperCase();
  const serviceType = requestedServiceType === "dine_in" && tableNumber ? "dine_in" : "takeaway";
  const table = serviceType === "dine_in" ? await db("dining_tables").where({ outlet_id: outletId, number: tableNumber, status: "active" }).first() : null;
  if (serviceType === "dine_in" && !table) throw new Error("Meja transaksi dine in tidak valid.");

  const paymentCode = normalizePaymentMethodCode(mobilePayloadValue(payload, "paymentMethod", "payment_method", "cash"));
  const paymentMethod = paymentMethods.find((method) => method.code === paymentCode);
  if (!paymentMethod) throw new Error("Metode pembayaran tidak aktif atau tidak valid.");

  const customerId = mobilePayloadValue(payload, "customerId", "customer_id", null);
  const customer = customerId ? await db("customers").where({ id: customerId }).first() : null;
  const total = Math.max(0, subtotal - discount + Math.max(0, Math.round(mobilePayloadNumber(payload, "tax", "tax", 0))));
  const allowZeroPayment = total === 0;
  const rawPayments = Array.isArray(payload?.payments)
    ? payload.payments
    : Array.isArray(payload?.payment_details)
      ? payload.payment_details
      : Array.isArray(payload?.paymentDetails)
        ? payload.paymentDetails
        : [];
  const normalizedPayments = rawPayments.length
    ? rawPayments
        .map((row) => {
          const methodCode = normalizePaymentMethodCode(row?.method || row?.payment_method || row?.paymentMethod || paymentCode);
          const method = paymentMethods.find((item) => item.code === methodCode);
          if (!method) throw new Error("Metode pembayaran split tidak aktif atau tidak valid.");
          return {
            id: createRuntimeId("payment"),
            method: method.code,
            payment_method_id: method.id,
            amount: Math.max(0, Math.round(Number(row?.amount ?? row?.paid_amount ?? row?.paidAmount ?? 0))),
            status: "paid",
            paid_at: transactionDate,
            change_amount: Math.max(0, Math.round(Number(row?.change_amount ?? row?.changeAmount ?? 0)))
          };
        })
        .filter((payment) => payment.amount > 0 || allowZeroPayment)
        .slice(0, 2)
    : [
        {
          id: createRuntimeId("payment"),
          method: paymentMethod.code,
          payment_method_id: paymentMethod.id,
          amount: Math.max(0, Math.round(mobilePayloadNumber(payload, "paidAmount", "paid_amount", total))),
          status: "paid",
          paid_at: transactionDate,
          change_amount: Math.max(0, Math.round(mobilePayloadNumber(payload, "changeAmount", "change_amount", 0)))
        }
      ];
  if (!normalizedPayments.length) throw new Error("Pembayaran transaksi wajib diisi.");
  const paidTotal = normalizedPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  if (paidTotal < total) throw new Error("Nominal pembayaran kurang dari total transaksi.");

  return {
    transaction: {
      id: String(mobilePayloadValue(payload, "id", "id", createRuntimeId("trx")) || ""),
      client_ref: mobilePayloadValue(payload, "clientRef", "client_ref", null),
      order_number: orderNumber,
      outlet_id: outletId,
      cashier_id: cashierId,
      customer_id: customer?.id || null,
      table_id: table?.id || null,
      service_type: serviceType,
      transaction_date: transactionDate,
      operational_at: transactionDate,
      subtotal,
      discount,
      tax: Math.max(0, Math.round(mobilePayloadNumber(payload, "tax", "tax", 0))),
      total,
      status: "paid",
      note: String(mobilePayloadValue(payload, "note", "note", "") || "")
        .trim()
        .slice(0, 500),
      discount_id: selectedDiscount?.id || null,
      discount_type: discount > 0 ? discountType : null,
      discount_value: discount > 0 ? discountValue : 0,
      discount_name: discount > 0 ? discountName : null,
      customer_name: mobilePayloadValue(payload, "customerName", "customer_name", customer?.name || null),
      customer_phone: mobilePayloadValue(payload, "customerPhone", "customer_phone", customer?.phone || null),
      customer_points_before: Math.max(0, Math.round(mobilePayloadNumber(payload, "customerPointsBefore", "customer_points_before", customer?.points || 0))),
      customer_points_earned: Math.max(0, Math.round(mobilePayloadNumber(payload, "customerPointsEarned", "customer_points_earned", 0))),
      customer_points_after: Math.max(0, Math.round(mobilePayloadNumber(payload, "customerPointsAfter", "customer_points_after", customer?.points || 0))),
      stock_deducted: true,
      stock_deducted_at: transactionDate,
      updated_at: transactionDate
    },
    items,
    payment: normalizedPayments[0],
    payments: normalizedPayments,
    tableNumber,
    customer
  };
}

async function applyDbTransactionStockDeduction(trx, transaction, items = []) {
  const productIds = [...new Set(items.map((item) => item.product_id))];
  const compositions = productIds.length ? await trx("product_compositions").whereIn("product_id", productIds) : [];
  const materialIds = [...new Set(compositions.map((item) => item.material_id))];
  const materials = materialIds.length ? await trx("raw_materials").whereIn("id", materialIds) : [];
  const materialMap = new Map(materials.map((material) => [material.id, material]));
  const totals = new Map();
  items.forEach((item) => {
    compositions
      .filter((composition) => composition.product_id === item.product_id)
      .forEach((composition) => {
        const material = materialMap.get(composition.material_id);
        if (!material || material.status === "inactive") return;
        totals.set(material.id, Number(totals.get(material.id) || 0) + Number(composition.quantity || 0) * Number(item.quantity || 0));
      });
  });
  for (const [materialId, quantity] of totals.entries()) {
    const material = materialMap.get(materialId);
    const stock = await trx("raw_material_stocks").where({ outlet_id: transaction.outlet_id, material_id: materialId }).first();
    const nextQuantity = roundQuantity(Number(stock?.quantity || 0) - Number(quantity || 0));
    if (stock) {
      await trx("raw_material_stocks")
        .where({ id: stock.id })
        .update({ quantity: nextQuantity, unit: material?.unit || stock.unit });
    } else {
      await trx("raw_material_stocks").insert({
        id: createRuntimeId("stock"),
        outlet_id: transaction.outlet_id,
        material_id: materialId,
        quantity: nextQuantity,
        unit: material?.unit || "unit",
        last_purchase_price: 0,
        stock_value: 0
      });
    }
  }
}

async function createPosTransaction(payload = {}, createdBy = null) {
  const orderNumber = String(mobilePayloadValue(payload, "orderNumber", "order_number", "") || "").trim();
  const transactionId = String(mobilePayloadValue(payload, "id", "id", "") || "").trim();
  const clientRef = String(mobilePayloadValue(payload, "clientRef", "client_ref", "") || "").trim();
  const openBillId = String(mobilePayloadValue(payload, "openBillId", "open_bill_id", "") || "").trim();
  const duplicate =
    transactionId || clientRef
      ? await db("transactions")
          .where((query) => {
            if (transactionId) query.where({ id: transactionId });
            if (clientRef) query.orWhere({ client_ref: clientRef });
          })
          .first()
      : null;
  if (duplicate) {
    const rows = await fetchDbTransactions({ outletId: duplicate.outlet_id });
    return rows.find((row) => row.id === duplicate.id);
  }
  const normalized = await normalizeTransactionPayloadForDb(payload, createdBy);
  let duplicateInTransaction = null;
  await db.transaction(async (trx) => {
    let openBill = null;
    if (openBillId) {
      openBill = await trx("open_bills")
        .where((query) => {
          query.where({ id: openBillId }).orWhere({ order_number: openBillId });
        })
        .where({ outlet_id: normalized.transaction.outlet_id, status: "open" })
        .forUpdate()
        .first();
      if (!openBill) throw new Error("Open bill tidak ditemukan atau sudah dibayar.");
      normalized.transaction.order_number = openBill.order_number;
      normalized.transaction.table_id = openBill.table_id || normalized.transaction.table_id;
      normalized.transaction.service_type = openBill.service_type || normalized.transaction.service_type;
    }
    if (!normalized.transaction.order_number) {
      normalized.transaction.order_number = await nextPosOrderNumber({
        outletId: normalized.transaction.outlet_id,
        operationalAt: normalized.transaction.operational_at || normalized.transaction.transaction_date,
        connection: trx
      });
    } else {
      await reserveSubmittedPosOrderNumber({
        outletId: normalized.transaction.outlet_id,
        orderNumber: normalized.transaction.order_number,
        operationalAt: normalized.transaction.operational_at || normalized.transaction.transaction_date,
        connection: trx
      });
    }
    duplicateInTransaction = await trx("transactions")
      .where({ order_number: normalized.transaction.order_number })
      .first();
    if (duplicateInTransaction) {
      if (normalized.transaction.client_ref && duplicateInTransaction.client_ref === normalized.transaction.client_ref) return;
      
      let baseOrderNumber = normalized.transaction.order_number;
      let counter = 1;
      let uniqueOrderNumber = `${baseOrderNumber}-${counter}`;
      while (await trx("transactions").where({ order_number: uniqueOrderNumber }).first()) {
        counter++;
        uniqueOrderNumber = `${baseOrderNumber}-${counter}`;
      }
      normalized.transaction.order_number = uniqueOrderNumber;
    }
    await trx("transactions").insert(normalized.transaction);
    await trx("transaction_items").insert(
      normalized.items.map((item) => ({
        id: createRuntimeId("trx_item"),
        transaction_id: normalized.transaction.id,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        subtotal: item.subtotal,
        metadata_json: { selected_variants: item.selectedVariants }
      }))
    );
    await trx("payments").insert(
      normalized.payments.map((payment) => ({
        ...payment,
        transaction_id: normalized.transaction.id
      }))
    );
    await applyDbTransactionStockDeduction(trx, normalized.transaction, normalized.items);
    if (normalized.customer && Number(normalized.transaction.customer_points_earned || 0) > 0) {
      await trx("customers").where({ id: normalized.customer.id }).update({ points: normalized.transaction.customer_points_after });
    }
    await trx("open_bills")
      .modify((query) => {
        if (openBill) query.where({ id: openBill.id });
        else query.where({ order_number: normalized.transaction.order_number });
      })
      .delete()
      .catch(() => {});
  });
  if (duplicateInTransaction) {
    const rows = await fetchDbTransactions({ outletId: duplicateInTransaction.outlet_id });
    return rows.find((row) => row.id === duplicateInTransaction.id);
  }
  await writeDbActivityLog({
    actor_user_id: normalized.transaction.cashier_id,
    outlet_id: normalized.transaction.outlet_id,
    source: "kasir_app",
    module: "transaction",
    action: "create",
    entity_type: "transaction",
    entity_id: normalized.transaction.id,
    description: `Kasir membuat transaksi ${normalized.transaction.order_number}`,
    metadata_json: {
      total: normalized.transaction.total,
      item_count: normalized.items.length,
        payment_method: normalized.payments.map((payment) => payment.method).join(" + ")
      }
    });
  if (normalized.transaction.discount > 0) {
    await writeDbActivityLog({
      actor_user_id: normalized.transaction.cashier_id,
      outlet_id: normalized.transaction.outlet_id,
      source: "kasir_app",
      module: "transaction",
      action: normalized.transaction.discount_id ? "apply_discount" : "apply_manual_discount",
      entity_type: "transaction",
      entity_id: normalized.transaction.id,
      description: `${normalized.transaction.discount_name || "Discount"} dipakai pada transaksi ${normalized.transaction.order_number}.`,
      metadata_json: {
        discount_id: normalized.transaction.discount_id,
        discount_type: normalized.transaction.discount_type,
        discount_value: normalized.transaction.discount_value,
        subtotal: normalized.transaction.subtotal,
        discount: normalized.transaction.discount,
        total: normalized.transaction.total
      }
    });
  }
  const rows = await fetchDbTransactions({
    outletId: normalized.transaction.outlet_id
  });
  return rows.find((row) => row.id === normalized.transaction.id);
}

function normalizeTransferType(value) {
  return value === "loan" ? "loan" : "regular";
}

function transferTypeLabel(transfer = {}) {
  if (transfer.loan_return_for_transfer_id || transfer.loanReturnForTransferId) return "Pengembalian Pinjaman";
  return normalizeTransferType(transfer.transfer_type || transfer.transferType) === "loan" ? "Pinjaman" : "Regular";
}

function getLoanReturnTotalsFromTransfers(transfers = [], itemsByTransfer = {}, loanTransferId) {
  return transfers
    .filter((transfer) => transfer.loan_return_for_transfer_id === loanTransferId && transfer.status === "approved")
    .reduce((totals, transfer) => {
      (itemsByTransfer[transfer.id] || []).forEach((item) => {
        totals.set(item.material_id, roundQuantity((totals.get(item.material_id) || 0) + Number(item.quantity || 0)));
      });
      return totals;
    }, new Map());
}

function buildLoanSummaryFromTransferRows(transfer = {}, items = [], transfers = [], itemsByTransfer = {}) {
  if (normalizeTransferType(transfer.transfer_type) !== "loan") {
    return {
      loan_status: null,
      loan_remaining_items: [],
      loan_returned_items: [],
      loan_return_count: 0
    };
  }

  const returnedTotals = getLoanReturnTotalsFromTransfers(transfers, itemsByTransfer, transfer.id);
  const returnedTransfers = transfers.filter((item) => item.loan_return_for_transfer_id === transfer.id && item.status === "approved");
  const returnedItems = items.map((item) => ({
    material_id: item.material_id,
    material_name: item.material?.name || item.material_name || item.material_id,
    material_type: item.material_type || item.material?.type || "hpp",
    unit: item.unit || item.material?.unit || "",
    quantity: roundQuantity(returnedTotals.get(item.material_id) || 0)
  }));
  const remainingItems = items.map((item, index) => ({
    material_id: item.material_id,
    material_name: item.material?.name || item.material_name || item.material_id,
    material_type: item.material_type || item.material?.type || "hpp",
    unit: item.unit || item.material?.unit || "",
    quantity: roundQuantity(Math.max(0, Number(item.quantity || 0) - Number(returnedItems[index]?.quantity || 0)))
  }));

  let loanStatus = "pending";
  if (transfer.status === "rejected") {
    loanStatus = "rejected";
  } else if (transfer.status !== "pending") {
    const totalReturned = returnedItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const totalRemaining = remainingItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    loanStatus = totalRemaining <= 0 ? "returned" : totalReturned > 0 ? "partial_returned" : "open";
  }

  return {
    loan_status: loanStatus,
    loan_remaining_items: remainingItems,
    loan_returned_items: returnedItems,
    loan_return_count: returnedTransfers.length
  };
}

function transferRowToMobile(transfer = {}, items = [], loanSummary = null) {
  const resolvedLoanSummary = loanSummary || {
    loan_status: normalizeTransferType(transfer.transfer_type) === "loan" ? (transfer.status === "approved" ? "open" : transfer.status || "pending") : null,
    loan_remaining_items: [],
    loan_returned_items: [],
    loan_return_count: 0
  };

  return {
    ...transfer,
    transfer_type: normalizeTransferType(transfer.transfer_type),
    transfer_type_label: transferTypeLabel(transfer),
    loan_return_for_transfer_id: transfer.loan_return_for_transfer_id || null,
    ...resolvedLoanSummary,
    source: transfer.source || "admin_web",
    batch_id: transfer.batch_id || null,
    note: transfer.note || "",
    transfer_date: dateOnly(transfer.transfer_date),
    items,
    from_outlet: transfer.from_outlet_name ? { id: transfer.from_outlet_id, name: transfer.from_outlet_name } : null,
    to_outlet: transfer.to_outlet_name ? { id: transfer.to_outlet_id, name: transfer.to_outlet_name } : null,
    requested_user: transfer.requested_user_name ? { id: transfer.requested_by, name: transfer.requested_user_name } : null,
    approved_user: transfer.approved_user_name ? { id: transfer.approved_by, name: transfer.approved_user_name } : null,
    item_count: items.length,
    synced: true
  };
}

async function fetchTransferRows({ outletId = "all", from, to, status } = {}) {
  const transfers = await db("stock_transfers as st")
    .leftJoin("outlets as fo", "fo.id", "st.from_outlet_id")
    .leftJoin("outlets as to", "to.id", "st.to_outlet_id")
    .leftJoin("users as requested_user", "requested_user.id", "st.requested_by")
    .leftJoin("users as approved_user", "approved_user.id", "st.approved_by")
    .select("st.*", db.raw("fo.name as from_outlet_name"), db.raw("to.name as to_outlet_name"), db.raw("requested_user.name as requested_user_name"), db.raw("approved_user.name as approved_user_name"))
    .modify((query) => {
      if (outletId && outletId !== "all") query.where((builder) => builder.where("st.from_outlet_id", outletId).orWhere("st.to_outlet_id", outletId));
      if (from) query.where("st.transfer_date", ">=", dateOnly(from));
      if (to) query.where("st.transfer_date", "<=", dateOnly(to));
      if (status) query.where("st.status", status);
    })
    .orderBy("st.transfer_date", "desc")
    .orderBy("st.id", "desc");
  const transferIds = transfers.map((transfer) => transfer.id);
  const items = transferIds.length ? await db("stock_transfer_items as sti").leftJoin("raw_materials as rm", "rm.id", "sti.material_id").leftJoin("raw_material_categories as rmc", "rmc.id", "rm.category_id").whereIn("sti.transfer_id", transferIds).select("sti.*", db.raw("rm.name as material_name"), db.raw("rm.type as material_type"), db.raw("rm.category_id as material_category_id"), db.raw("rmc.name as category_name")) : [];
  const itemsByTransfer = items.reduce((result, item) => {
    const row = {
      id: item.id,
      transfer_id: item.transfer_id,
      material_id: item.material_id,
      quantity: Number(item.quantity || 0),
      unit: item.unit,
      material_type: item.material_type || "hpp",
      material: {
        id: item.material_id,
        name: item.material_name,
        type: item.material_type || "hpp",
        category_id: item.material_category_id,
        unit: item.unit
      },
      category: item.category_name ? { id: item.material_category_id, name: item.category_name } : null
    };
    result[item.transfer_id] = result[item.transfer_id] || [];
    result[item.transfer_id].push(row);
    return result;
  }, {});
  return transfers.map((transfer) => {
    const transferItems = itemsByTransfer[transfer.id] || [];
    const loanSummary = buildLoanSummaryFromTransferRows(transfer, transferItems, transfers, itemsByTransfer);
    return transferRowToMobile(transfer, transferItems, loanSummary);
  });
}

async function getPosTransfers(filters = {}) {
  return fetchTransferRows(filters);
}

async function normalizeTransferPayloadForDb(payload = {}, createdBy = null) {
  const fromOutletId = String(mobilePayloadValue(payload, "fromOutletId", "from_outlet_id", "") || "").trim();
  const toOutletId = String(mobilePayloadValue(payload, "toOutletId", "to_outlet_id", "") || "").trim();
  const transferOperationalAt = serializeMysqlDateTime(mobilePayloadValue(payload, "operationalAt", "operational_at", mobilePayloadValue(payload, "transferDate", "transfer_date", new Date())));
  const transferDate = dateOnly(transferOperationalAt);
  const transferType = normalizeTransferType(mobilePayloadValue(payload, "transferType", "transfer_type", "regular"));
  const loanReturnForTransferId = mobilePayloadValue(payload, "loanReturnForTransferId", "loan_return_for_transfer_id", null);
  const rawItems = Array.isArray(payload.items) ? payload.items : [];

  const [fromOutlet, toOutlet] = await Promise.all([fromOutletId ? db("outlets").where({ id: fromOutletId, status: "active" }).first() : null, toOutletId ? db("outlets").where({ id: toOutletId, status: "active" }).first() : null]);
  if (!fromOutlet || !toOutlet) throw new Error("Outlet asal dan outlet tujuan transfer wajib aktif.");
  if (fromOutletId === toOutletId) throw new Error("Outlet asal dan tujuan tidak boleh sama.");
  if (!rawItems.length) throw new Error("Minimal satu harga pokok produksi transfer wajib diisi.");

  const materialIds = [...new Set(rawItems.map((item) => String(mobilePayloadValue(item, "materialId", "material_id", "") || "").trim()).filter(Boolean))];
  const materials = materialIds.length ? await db("raw_materials").whereIn("id", materialIds).whereNot("status", "inactive") : [];
  const materialMap = new Map(materials.map((material) => [material.id, material]));
  const items = rawItems.map((item, index) => {
    const materialId = String(mobilePayloadValue(item, "materialId", "material_id", "") || "").trim();
    const material = materialMap.get(materialId);
    const quantity = Number(mobilePayloadValue(item, "quantity", "quantity", 0));
    if (!material || quantity <= 0) throw new Error(`Harga Pokok Produksi dan qty baris ${index + 1} wajib valid.`);
    return { material_id: materialId, quantity, unit: material.unit };
  });

  return {
    transfer: {
      id: String(mobilePayloadValue(payload, "id", "id", createRuntimeId("transfer")) || ""),
      from_outlet_id: fromOutletId,
      to_outlet_id: toOutletId,
      requested_by: createdBy || mobilePayloadValue(payload, "requestedBy", "requested_by", null),
      approved_by: null,
      status: "pending",
      transfer_date: transferDate,
      operational_at: transferOperationalAt,
      transfer_type: loanReturnForTransferId ? "regular" : transferType,
      loan_return_for_transfer_id: loanReturnForTransferId || null,
      source: "kasir_app",
      batch_id: mobilePayloadValue(payload, "batchId", "batch_id", mobilePayloadValue(payload, "localId", "local_id", null)),
      note: String(mobilePayloadValue(payload, "note", "note", "") || "").trim()
    },
    items
  };
}

async function createPosTransferRequest(payload = {}, createdBy = null) {
  const batchId = mobilePayloadValue(payload, "batchId", "batch_id", mobilePayloadValue(payload, "localId", "local_id", null));
  if (batchId) {
    const duplicate = await db("stock_transfers").where({ batch_id: batchId }).first();
    if (duplicate) {
      const rows = await fetchTransferRows({
        outletId: duplicate.from_outlet_id
      });
      return rows.find((row) => row.id === duplicate.id);
    }
  }
  const normalized = await normalizeTransferPayloadForDb(payload, createdBy);
  await db.transaction(async (trx) => {
    await trx("stock_transfers").insert(normalized.transfer);
    await trx("stock_transfer_items").insert(
      normalized.items.map((item) => ({
        id: createRuntimeId("transfer_item"),
        transfer_id: normalized.transfer.id,
        ...item
      }))
    );
  });
  await writeDbActivityLog({
    actor_user_id: normalized.transfer.requested_by,
    outlet_id: normalized.transfer.from_outlet_id,
    source: "kasir_app",
    module: "transfer",
    action: normalized.transfer.loan_return_for_transfer_id ? "create_loan_return" : normalizeTransferType(normalized.transfer.transfer_type) === "loan" ? "create_loan" : "create_request",
    entity_type: "stock_transfer",
    entity_id: normalized.transfer.id,
    description: "Kasir input request transfer harga pokok produksi",
    metadata_json: {
      item_count: normalized.items.length,
      from_outlet_id: normalized.transfer.from_outlet_id,
      to_outlet_id: normalized.transfer.to_outlet_id,
      transfer_type: normalizeTransferType(normalized.transfer.transfer_type)
    }
  });
  const rows = await fetchTransferRows({
    outletId: normalized.transfer.from_outlet_id
  });
  return rows.find((row) => row.id === normalized.transfer.id);
}

async function getStockTransferWithItems(transferId, trx = db) {
  const transfer = await trx("stock_transfers").where({ id: transferId }).first();
  if (!transfer) throw new Error("Transfer stok tidak ditemukan.");
  const items = await trx("stock_transfer_items as sti").leftJoin("raw_materials as rm", "rm.id", "sti.material_id").where("sti.transfer_id", transferId).select("sti.*", db.raw("rm.name as material_name"), db.raw("rm.type as material_type"), db.raw("rm.unit as material_unit"));
  return { transfer, items };
}

async function normalizeAdminTransferPayload(payload = {}, actorUserId = null, existingTransfer = null) {
  const normalized = await normalizeTransferPayloadForDb(
    {
      id: existingTransfer?.id || payload.id,
      from_outlet_id: payload.from_outlet_id || payload.fromOutletId || existingTransfer?.from_outlet_id,
      to_outlet_id: payload.to_outlet_id || payload.toOutletId || existingTransfer?.to_outlet_id,
      transfer_date: payload.transfer_date || payload.transferDate || existingTransfer?.transfer_date,
      transfer_type: payload.transfer_type || payload.transferType || existingTransfer?.transfer_type || "regular",
      loan_return_for_transfer_id: payload.loan_return_for_transfer_id || payload.loanReturnForTransferId || existingTransfer?.loan_return_for_transfer_id || null,
      batch_id: payload.batch_id || payload.batchId || existingTransfer?.batch_id || null,
      note: payload.note ?? existingTransfer?.note ?? "",
      items: Array.isArray(payload.items) ? payload.items : []
    },
    existingTransfer?.requested_by || payload.requested_by || payload.requestedBy || actorUserId
  );
  normalized.transfer.source = payload.source || existingTransfer?.source || "admin_web";
  normalized.transfer.requested_by = existingTransfer?.requested_by || payload.requested_by || payload.requestedBy || actorUserId || null;
  normalized.transfer.status = "pending";
  return normalized;
}

async function applyApprovedTransferStockDb(trx, transfer, items) {
  const materialIds = [...new Set(items.map((item) => item.material_id).filter(Boolean))];
  const materials = materialIds.length ? await trx("raw_materials").whereIn("id", materialIds) : [];
  const materialMap = new Map(materials.map((material) => [material.id, material]));

  for (const item of items) {
    const quantity = Number(item.quantity || 0);
    if (quantity <= 0) continue;
    const material = materialMap.get(item.material_id);
    const fromStock = await trx("raw_material_stocks")
      .where({
        outlet_id: transfer.from_outlet_id,
        material_id: item.material_id
      })
      .first();
    const fromQuantity = Number(fromStock?.quantity || 0);
    if (fromQuantity < quantity) {
      const error = new Error(`Stok ${material?.name || item.material_id} di outlet asal tidak cukup.`);
      error.code = "TRANSFER_STOCK_INSUFFICIENT";
      throw error;
    }

    const fromPrice = Number(fromStock?.last_purchase_price || material?.last_purchase_price || 0);
    const nextFromQuantity = roundQuantity(fromQuantity - quantity);
    if (fromStock) {
      await trx("raw_material_stocks")
        .where({ id: fromStock.id })
        .update({
          quantity: nextFromQuantity,
          unit: material?.unit || item.unit || fromStock.unit,
          stock_value: Math.round(nextFromQuantity * fromPrice)
        });
    }

    const toStock = await trx("raw_material_stocks")
      .where({
        outlet_id: transfer.to_outlet_id,
        material_id: item.material_id
      })
      .first();
    const toPrice = Number(toStock?.last_purchase_price || fromPrice || 0);
    const nextToQuantity = roundQuantity(Number(toStock?.quantity || 0) + quantity);
    const toPayload = {
      quantity: nextToQuantity,
      unit: material?.unit || item.unit || toStock?.unit || "",
      last_purchase_price: toPrice,
      last_purchase_date: toStock?.last_purchase_date || fromStock?.last_purchase_date || null,
      stock_value: Math.round(nextToQuantity * toPrice)
    };
    if (toStock) {
      await trx("raw_material_stocks").where({ id: toStock.id }).update(toPayload);
    } else {
      await trx("raw_material_stocks").insert({
        id: createRuntimeId("stock"),
        outlet_id: transfer.to_outlet_id,
        material_id: item.material_id,
        ...toPayload
      });
    }
  }
}

async function createStockTransfer(payload = {}) {
  const batchId = payload.batch_id || payload.batchId || null;
  if (batchId) {
    const duplicate = await db("stock_transfers").where({ batch_id: batchId }).first();
    if (duplicate) {
      const rows = await fetchTransferRows({ outletId: "all" });
      return rows.find((row) => row.id === duplicate.id);
    }
  }
  const requestedBy = payload.requested_by || payload.requestedBy || payload.created_by || null;
  const normalized = await normalizeAdminTransferPayload(payload, requestedBy);
  const finalStatus = ["pending", "approved", "rejected"].includes(String(payload.status || "").toLowerCase()) ? String(payload.status).toLowerCase() : "pending";

  await db.transaction(async (trx) => {
    await trx("stock_transfers").insert({
      ...normalized.transfer,
      status: finalStatus,
      approved_by: finalStatus === "approved" ? requestedBy : null
    });
    const transferItems = normalized.items.map((item) => ({
      id: createRuntimeId("transfer_item"),
      transfer_id: normalized.transfer.id,
      ...item
    }));
    await trx("stock_transfer_items").insert(transferItems);
    if (finalStatus === "approved") await applyApprovedTransferStockDb(trx, normalized.transfer, transferItems);
  });
  await writeDbActivityLog({
    actor_user_id: requestedBy,
    outlet_id: normalized.transfer.from_outlet_id,
    source: "admin_web",
    module: "transfer",
    action: normalizeTransferType(normalized.transfer.transfer_type) === "loan" ? "create_loan" : "create_request",
    entity_type: "stock_transfer",
    entity_id: normalized.transfer.id,
    description: "Admin membuat request transfer stok",
    metadata_json: {
      item_count: normalized.items.length,
      status: finalStatus,
      from_outlet_id: normalized.transfer.from_outlet_id,
      to_outlet_id: normalized.transfer.to_outlet_id
    }
  });
  const rows = await fetchTransferRows({ outletId: "all" });
  return rows.find((row) => row.id === normalized.transfer.id);
}

async function updateStockTransfer(transferId, payload = {}) {
  const { transfer: existing } = await getStockTransferWithItems(transferId);
  if (existing.status !== "pending") throw new Error("Hanya transfer pending yang bisa diedit.");
  const actorUserId = payload.updated_by || payload.updatedBy || payload.requested_by || existing.requested_by || null;
  const normalized = await normalizeAdminTransferPayload(payload, actorUserId, existing);

  await db.transaction(async (trx) => {
    await trx("stock_transfers").where({ id: transferId }).update({
      from_outlet_id: normalized.transfer.from_outlet_id,
      to_outlet_id: normalized.transfer.to_outlet_id,
      requested_by: normalized.transfer.requested_by,
      transfer_date: normalized.transfer.transfer_date,
      transfer_type: normalized.transfer.transfer_type,
      loan_return_for_transfer_id: normalized.transfer.loan_return_for_transfer_id,
      source: normalized.transfer.source,
      batch_id: normalized.transfer.batch_id,
      note: normalized.transfer.note,
      status: "pending",
      approved_by: null,
      rejection_note: null
    });
    await trx("stock_transfer_items").where({ transfer_id: transferId }).del();
    await trx("stock_transfer_items").insert(
      normalized.items.map((item) => ({
        id: createRuntimeId("transfer_item"),
        transfer_id: transferId,
        ...item
      }))
    );
  });
  await writeDbActivityLog({
    actor_user_id: actorUserId,
    outlet_id: normalized.transfer.from_outlet_id,
    source: "admin_web",
    module: "transfer",
    action: "update",
    entity_type: "stock_transfer",
    entity_id: transferId,
    description: "Admin mengoreksi request transfer stok pending",
    metadata_json: {
      item_count: normalized.items.length,
      from_outlet_id: existing.from_outlet_id,
      to_outlet_id: existing.to_outlet_id,
      next_from_outlet_id: normalized.transfer.from_outlet_id,
      next_to_outlet_id: normalized.transfer.to_outlet_id
    }
  });
  const rows = await fetchTransferRows({ outletId: "all" });
  return rows.find((row) => row.id === transferId);
}

async function approveStockTransfer(transferId, payload = {}) {
  const approvedBy = payload.approved_by || payload.approvedBy || null;
  const result = await db.transaction(async (trx) => {
    const { transfer, items } = await getStockTransferWithItems(transferId, trx);
    if (transfer.status !== "pending") throw new Error("Hanya transfer pending yang bisa di-approve.");
    await applyApprovedTransferStockDb(trx, transfer, items);
    await trx("stock_transfers").where({ id: transferId }).update({
      status: "approved",
      approved_by: approvedBy,
      rejection_note: null
    });
    return transfer;
  });
  await writeDbActivityLog({
    actor_user_id: approvedBy,
    outlet_id: result.from_outlet_id,
    source: "admin_web",
    module: "transfer",
    action: result.loan_return_for_transfer_id ? "loan_return_approved" : "approve",
    entity_type: "stock_transfer",
    entity_id: transferId,
    description: "Admin approve transfer stok",
    metadata_json: {
      from_outlet_id: result.from_outlet_id,
      to_outlet_id: result.to_outlet_id,
      transfer_type: normalizeTransferType(result.transfer_type)
    }
  });
  const rows = await fetchTransferRows({ outletId: "all" });
  return rows.find((row) => row.id === transferId);
}

async function rejectStockTransfer(transferId, payload = {}) {
  const rejectedBy = payload.rejected_by || payload.rejectedBy || payload.approved_by || payload.approvedBy || null;
  const reason = String(payload.reason || payload.rejection_note || payload.rejectionNote || "").trim();
  const { transfer } = await getStockTransferWithItems(transferId);
  if (transfer.status !== "pending") throw new Error("Hanya transfer pending yang bisa di-reject.");
  await db("stock_transfers")
    .where({ id: transferId })
    .update({
      status: "rejected",
      approved_by: rejectedBy,
      rejection_note: reason || null
    });
  await writeDbActivityLog({
    actor_user_id: rejectedBy,
    outlet_id: transfer.from_outlet_id,
    source: "admin_web",
    module: "transfer",
    action: "reject",
    entity_type: "stock_transfer",
    entity_id: transferId,
    description: "Admin reject transfer stok",
    metadata_json: {
      reason,
      from_outlet_id: transfer.from_outlet_id,
      to_outlet_id: transfer.to_outlet_id
    }
  });
  const rows = await fetchTransferRows({ outletId: "all" });
  return rows.find((row) => row.id === transferId);
}

function opnameStatusFromDifference(difference) {
  const value = Number(difference || 0);
  if (Math.abs(value) < 0.001) return "pas";
  if (value > 0) return "stock_hilang";
  return "tidak_sesuai_standar";
}

function opnameNoteFromStatus(status) {
  if (status === "stock_hilang") return "Stock Hilang";
  if (status === "tidak_sesuai_standar") return "Tidak Sesuai Standar";
  return "Pas";
}

function normalizeOpnameStatus(status) {
  const value = String(status || "pending").toLowerCase();
  if (["pending", "approved", "rejected"].includes(value)) return value;
  return "approved";
}

function stockOpnameItemFromDb(row = {}) {
  const systemQuantity = Number(row.system_quantity || 0);
  const actualQuantity = Number(row.actual_quantity || 0);
  const difference = Number(row.difference ?? systemQuantity - actualQuantity);
  const unitPrice = Number(row.unit_price || row.stock_unit_price || row.material_unit_price || 0);
  const incomingQuantity = Number(row.incoming_quantity || 0);
  const transferQuantity = Number(row.transfer_quantity || 0);
  const transferOutQuantity = Number(row.transfer_out_quantity || 0);
  const transferInQuantity = Number(row.transfer_in_quantity ?? Math.max(transferQuantity + transferOutQuantity, 0));
  const purchaseQuantity = Number(row.purchase_quantity ?? Math.max(incomingQuantity - transferInQuantity, 0));
  const itemStatus = opnameStatusFromDifference(difference);
  return {
    id: row.id,
    material_id: row.material_id,
    materialId: row.material_id,
    material: {
      id: row.material_id,
      name: row.material_name || row.name || "-",
      type: row.material_type || "hpp",
      unit: row.unit || row.material_unit || "",
      category_id: row.category_id || null
    },
    name: row.material_name || row.name || "-",
    type: row.material_type || "hpp",
    category: row.category_name ? { id: row.category_id, name: row.category_name } : null,
    unit: row.unit || row.material_unit || "",
    opening_quantity: Number(row.opening_quantity || 0),
    purchase_quantity: purchaseQuantity,
    transfer_in_quantity: transferInQuantity,
    incoming_quantity: incomingQuantity,
    transfer_quantity: transferQuantity,
    transfer_out_quantity: transferOutQuantity,
    damage_quantity: Number(row.damage_quantity || 0),
    computed_sales_quantity: Number(row.computed_sales_quantity || 0),
    real_system_quantity: systemQuantity,
    system_quantity: systemQuantity,
    actual_quantity: actualQuantity,
    difference,
    unit_price: unitPrice,
    loss_amount: Number(row.loss_amount ?? Math.max(difference, 0) * unitPrice),
    status: itemStatus,
    note: row.item_note || opnameNoteFromStatus(itemStatus)
  };
}

function groupOpnameRequests(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.request_id || row.batch_id || row.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, groupRows]) => {
    const first = groupRows[0] || {};
    const operationalAt = first.operational_at || first.opname_date || new Date();
    const items = groupRows.map(stockOpnameItemFromDb);
    const missingItems = items.filter((item) => item.difference > 0);
    const totalLossAmount = items.reduce((sum, item) => sum + Number(item.loss_amount || 0), 0);
    return {
      id: first.request_id || key,
      request_id: first.request_id || key,
      batch_id: first.batch_id || first.request_id || key,
      outlet_id: first.outlet_id,
      outlet: first.outlet_name ? { id: first.outlet_id, name: first.outlet_name } : null,
      opname_date: dateOnly(operationalAt),
      operational_at: operationalAt,
      operationalAt,
      status: normalizeOpnameStatus(first.status),
      source: first.source || "admin_web",
      note: first.request_note || first.note || "",
      requested_by: first.created_by || null,
      requested_user: first.created_by_name ? { id: first.created_by, name: first.created_by_name } : null,
      approved_by: first.approved_by || null,
      approved_user: first.approved_by_name ? { id: first.approved_by, name: first.approved_by_name } : null,
      approved_at: first.approved_at || null,
      rejected_by: first.rejected_by || null,
      rejected_user: first.rejected_by_name ? { id: first.rejected_by, name: first.rejected_by_name } : null,
      rejected_at: first.rejected_at || null,
      rejection_note: first.rejection_note || null,
      created_at: first.created_at || null,
      items,
      item_count: items.length,
      summary: {
        total_items: items.length,
        match_items: items.filter((item) => Math.abs(item.difference) < 0.001).length,
        missing_items: missingItems.length,
        total_missing_quantity: missingItems.reduce((sum, item) => sum + Number(item.difference || 0), 0),
        total_loss_amount: totalLossAmount
      },
      synced: true
    };
  });
}

let stockOpnameOperationalAtColumnExists;

async function hasStockOpnameOperationalAtColumn() {
  if (typeof stockOpnameOperationalAtColumnExists === "boolean") return stockOpnameOperationalAtColumnExists;
  stockOpnameOperationalAtColumnExists = await db.schema.hasColumn("stock_opnames", "operational_at");
  return stockOpnameOperationalAtColumnExists;
}

async function fetchStockOpnameRows({ outletId = "all", from, to, status } = {}) {
  const dateExpression = (await hasStockOpnameOperationalAtColumn()) ? "COALESCE(so.operational_at, so.opname_date)" : "so.opname_date";

  return db("stock_opnames as so")
    .leftJoin("outlets as outlets", "outlets.id", "so.outlet_id")
    .leftJoin("raw_materials as rm", "rm.id", "so.material_id")
    .leftJoin("raw_material_categories as rmc", "rmc.id", "rm.category_id")
    .leftJoin("users as created_user", "created_user.id", "so.created_by")
    .leftJoin("users as approved_user", "approved_user.id", "so.approved_by")
    .leftJoin("users as rejected_user", "rejected_user.id", "so.rejected_by")
    .select("so.*", db.raw("outlets.name as outlet_name"), db.raw("rm.name as material_name"), db.raw("rm.type as material_type"), db.raw("rm.unit as material_unit"), db.raw("rm.category_id as category_id"), db.raw("rm.last_purchase_price as material_unit_price"), db.raw("rmc.name as category_name"), db.raw("created_user.name as created_by_name"), db.raw("approved_user.name as approved_by_name"), db.raw("rejected_user.name as rejected_by_name"))
    .modify((query) => {
      if (outletId && outletId !== "all") query.where("so.outlet_id", outletId);
      if (from) {
        query.whereRaw(`DATE(${dateExpression}) >= ?`, [dateOnly(from)]);
      }
      if (to) {
        query.whereRaw(`DATE(${dateExpression}) <= ?`, [dateOnly(to)]);
      }
      if (status && status !== "all") query.where("so.status", status);
    })
    .orderByRaw(`${dateExpression} desc`)
    .orderBy("so.request_id", "desc")
    .orderBy("so.id", "asc");
}

async function getStockOpnameRequests(filters = {}) {
  const rows = await fetchStockOpnameRows(filters);
  return groupOpnameRequests(rows);
}

async function getStockOpnameMaterialSelection(filters = {}) {
  const outletId = String(filters.outletId || filters.outlet_id || "").trim();
  const outlet = outletId ? await db("outlets").where({ id: outletId }).first() : null;
  if (!outlet) throw new Error("Outlet wajib valid.");

  const [materials, selections] = await Promise.all([db("raw_materials").whereNot("status", "inactive").orderBy("name", "asc"), db("stock_opname_material_selections").where({ outlet_id: outletId })]);
  const selectedIds = new Set(selections.map((row) => row.material_id));
  const items = materials.map((material) => ({
    material_id: material.id,
    name: material.name,
    type: material.type || "hpp",
    unit: material.unit,
    selected: selectedIds.has(material.id)
  }));

  return {
    outlet_id: outletId,
    outlet: { id: outlet.id, name: outlet.name },
    selected_material_ids: items.filter((item) => item.selected).map((item) => item.material_id),
    items
  };
}

async function updateStockOpnameMaterialSelection(payload = {}, actorUserId = null) {
  const outletId = String(payload.outlet_id || payload.outletId || "").trim();
  const requestedMaterialIds = payload.material_ids ?? payload.materialIds ?? [];
  if (!Array.isArray(requestedMaterialIds)) throw new Error("Daftar item stock opname wajib berupa array.");
  const materialIds = [...new Set(requestedMaterialIds.map((id) => String(id).trim()).filter(Boolean))];
  const outlet = outletId ? await db("outlets").where({ id: outletId }).first() : null;
  if (!outlet) throw new Error("Outlet wajib valid.");

  const materials = materialIds.length ? await db("raw_materials").whereIn("id", materialIds).whereNot("status", "inactive").select("id") : [];
  if (materials.length !== materialIds.length) throw new Error("Pilihan item stock opname mengandung Harga Pokok Produksi yang tidak aktif atau tidak valid.");

  await db.transaction(async (trx) => {
    await trx("stock_opname_material_selections").where({ outlet_id: outletId }).delete();
    if (materialIds.length) {
      await trx("stock_opname_material_selections").insert(
        materialIds.map((materialId) => ({
          outlet_id: outletId,
          material_id: materialId,
          selected_by: actorUserId,
          updated_at: new Date()
        }))
      );
    }
  });
  await writeDbActivityLog({
    actor_user_id: actorUserId,
    outlet_id: outletId,
    source: "admin_web",
    module: "stock_opname",
    action: "update_apk_material_selection",
    entity_type: "stock_opname_material_selection",
    entity_id: outletId,
    description: `Pilihan item Stock Opname APK ${outlet.name} diperbarui.`,
    metadata_json: {
      material_ids: materialIds,
      material_count: materialIds.length
    }
  });
  return getStockOpnameMaterialSelection({ outletId });
}

async function getSelectedStockOpnameMaterialIds(outletId) {
  const rows = await db("stock_opname_material_selections").where({ outlet_id: outletId }).select("material_id");
  return new Set(rows.map((row) => row.material_id));
}

async function getDbDailySalesMaterialTotals({ outletId, date, materialIds = [], connection = db }) {
  const [grossTransactions, refundTransactions, cancelledTransactions] = await Promise.all([
    connection("transactions").where({ outlet_id: outletId, stock_deducted: true }).whereRaw("DATE(COALESCE(operational_at, transaction_date)) = ?", [date]).select("id"),
    connection("transaction_refunds as refunds").join("transactions as transactions", "transactions.id", "refunds.transaction_id").where("transactions.outlet_id", outletId).where("transactions.stock_deducted", true).whereNot("refunds.status", "cancelled").whereRaw("DATE(refunds.refunded_at) = ?", [date]).select("transactions.id"),
    connection("transactions")
      .where({
        outlet_id: outletId,
        stock_deducted: true,
        stock_cancelled: true
      })
      .whereRaw("DATE(COALESCE(stock_cancelled_at, cancelled_at)) = ?", [date])
      .select("id")
  ]);

  const signsByTransaction = new Map();
  grossTransactions.forEach((transaction) => signsByTransaction.set(transaction.id, (signsByTransaction.get(transaction.id) || 0) + 1));
  refundTransactions.forEach((transaction) => signsByTransaction.set(transaction.id, (signsByTransaction.get(transaction.id) || 0) - 1));
  cancelledTransactions.forEach((transaction) => signsByTransaction.set(transaction.id, (signsByTransaction.get(transaction.id) || 0) - 1));
  const transactionIds = [...signsByTransaction.keys()];
  if (!transactionIds.length) return new Map();

  const transactionItems = await connection("transaction_items").whereIn("transaction_id", transactionIds);
  const productIds = [...new Set(transactionItems.map((item) => item.product_id).filter(Boolean))];
  const compositions = productIds.length ? await connection("product_compositions").whereIn("product_id", productIds) : [];
  const allowedMaterialIds = materialIds.length ? new Set(materialIds) : null;
  const compositionsByProduct = compositions.reduce((result, composition) => {
    result.set(composition.product_id, [...(result.get(composition.product_id) || []), composition]);
    return result;
  }, new Map());
  const totals = new Map();

  transactionItems.forEach((item) => {
    const sign = signsByTransaction.get(item.transaction_id) || 0;
    if (!sign) return;
    (compositionsByProduct.get(item.product_id) || []).forEach((composition) => {
      if (allowedMaterialIds && !allowedMaterialIds.has(composition.material_id)) return;
      const quantity = sign * Number(item.quantity || 0) * Number(composition.quantity || 0);
      totals.set(composition.material_id, roundQuantity((totals.get(composition.material_id) || 0) + quantity));
    });
  });

  return totals;
}

async function getStockOpnameWorksheet(filters = {}, { apkSelectionOnly = false } = {}) {
  const outletId = String(filters.outletId || filters.outlet_id || "").trim();
  const date = dateOnly(filters.date || filters.opnameDate || filters.opname_date || new Date());
  if (!outletId || outletId === "all") {
    return {
      outlet: null,
      date,
      rows: [],
      summary: {
        total_items: 0,
        match_items: 0,
        missing_items: 0,
        total_missing_quantity: 0,
        total_loss_amount: 0
      }
    };
  }

  const outlet = await db("outlets").where({ id: outletId }).first();
  if (!outlet) throw new Error("Outlet tidak ditemukan.");

  const selectedMaterialIds = apkSelectionOnly ? await getSelectedStockOpnameMaterialIds(outletId) : null;
  const materials = await db("raw_materials as rm")
    .leftJoin("raw_material_categories as rmc", "rmc.id", "rm.category_id")
    .whereNot("rm.status", "inactive")
    .modify((query) => {
      if (selectedMaterialIds) query.whereIn("rm.id", [...selectedMaterialIds]);
    })
    .select(db.raw("rm.id as material_id"), db.raw("rm.name as material_name"), db.raw("rm.type as material_type"), db.raw("rm.category_id as category_id"), db.raw("rm.unit as material_unit"), db.raw("rm.last_purchase_price as material_unit_price"), db.raw("rmc.name as category_name"))
    .orderBy("rm.name", "asc");

  const materialIds = materials.map((material) => material.material_id);
  const [stockRows, purchaseRows, transferInRows, transferOutRows, salesByMaterial] = materialIds.length
    ? await Promise.all([
        db("raw_material_stocks").where("outlet_id", outletId).whereIn("material_id", materialIds),
        db("purchase_items as pi").join("purchases as p", "p.id", "pi.purchase_id").where("p.outlet_id", outletId).where("p.status", "approved").where("p.purchase_date", date).whereIn("pi.material_id", materialIds).groupBy("pi.material_id").select("pi.material_id", db.raw("SUM(pi.quantity) as quantity")),
        db("stock_transfer_items as sti").join("stock_transfers as st", "st.id", "sti.transfer_id").where("st.to_outlet_id", outletId).where("st.status", "approved").where("st.transfer_date", date).whereIn("sti.material_id", materialIds).groupBy("sti.material_id").select("sti.material_id", db.raw("SUM(sti.quantity) as quantity")),
        db("stock_transfer_items as sti").join("stock_transfers as st", "st.id", "sti.transfer_id").where("st.from_outlet_id", outletId).where("st.status", "approved").where("st.transfer_date", date).whereIn("sti.material_id", materialIds).groupBy("sti.material_id").select("sti.material_id", db.raw("SUM(sti.quantity) as quantity")),
        getDbDailySalesMaterialTotals({ outletId, date, materialIds })
      ])
    : [[], [], [], [], new Map()];

  const toQuantityMap = (rows) => new Map(rows.map((row) => [row.material_id, Number(row.quantity || 0)]));
  const stockByMaterial = new Map(stockRows.map((stock) => [stock.material_id, stock]));
  const purchasesByMaterial = toQuantityMap(purchaseRows);
  const transferInByMaterial = toQuantityMap(transferInRows);
  const transferOutByMaterial = toQuantityMap(transferOutRows);

  const rows = materials.map((material, index) => {
    const stock = stockByMaterial.get(material.material_id) || {};
    const currentQuantity = Number(stock.quantity || 0);
    const transferInQuantity = Number(transferInByMaterial.get(material.material_id) || 0);
    const purchaseQuantity = Number(purchasesByMaterial.get(material.material_id) || 0);
    const transferOutQuantity = Number(transferOutByMaterial.get(material.material_id) || 0);
    const salesQuantity = Number(salesByMaterial.get(material.material_id) || 0);
    const openingQuantity = Math.max(currentQuantity - purchaseQuantity - transferInQuantity + transferOutQuantity + salesQuantity, 0);
    const calculated = calculateStockOpname({
      openingQuantity,
      purchaseQuantity,
      transferInQuantity,
      transferOutQuantity,
      salesQuantity,
      actualQuantity: currentQuantity,
      unitPrice: Number(stock.last_purchase_price || material.material_unit_price || 0)
    });
    const actualQuantity = currentQuantity;
    const unitPrice = Number(stock.last_purchase_price || material.material_unit_price || 0);
    const itemStatus = calculated.status;
    return {
      id: stock.id || `worksheet_${outletId}_${material.material_id}`,
      no: index + 1,
      outlet_id: outletId,
      outlet: { id: outlet.id, name: outlet.name },
      material_id: material.material_id,
      material: {
        id: material.material_id,
        name: material.material_name,
        type: material.material_type || "hpp",
        unit: stock.unit || material.material_unit,
        category_id: material.category_id
      },
      stock_id: stock.id || null,
      name: material.material_name,
      type: material.material_type || "hpp",
      category: material.category_name ? { id: material.category_id, name: material.category_name } : null,
      unit: stock.unit || material.material_unit,
      unit_price: unitPrice,
      ...calculated,
      actual_quantity: actualQuantity,
      status: itemStatus,
      note: opnameNoteFromStatus(itemStatus)
    };
  });
  const missingRows = rows.filter((row) => row.difference > 0);
  return {
    outlet: { id: outlet.id, name: outlet.name },
    date,
    rows,
    summary: {
      total_items: rows.length,
      match_items: rows.filter((row) => Math.abs(row.difference) < 0.001).length,
      missing_items: missingRows.length,
      total_missing_quantity: missingRows.reduce((sum, row) => sum + Number(row.difference || 0), 0),
      total_loss_amount: rows.reduce((sum, row) => sum + Number(row.loss_amount || 0), 0)
    }
  };
}

async function getPosStockOpnameWorksheet(filters = {}) {
  return getStockOpnameWorksheet(filters, { apkSelectionOnly: true });
}

async function normalizeStockOpnamePayloadForDb(payload = {}, createdBy = null, { allowInactiveMaterialIds = new Set() } = {}) {
  const outletId = String(mobilePayloadValue(payload, "outletId", "outlet_id", "") || "").trim();
  const outlet = outletId ? await db("outlets").where({ id: outletId }).first() : null;
  if (!outlet) throw new Error("Outlet opname wajib valid.");
  const opnameOperationalAt = serializeMysqlDateTime(mobilePayloadValue(payload, "operationalAt", "operational_at", mobilePayloadValue(payload, "opnameDate", "opname_date", mobilePayloadValue(payload, "date", "date", new Date()))));
  const opnameDate = dateOnly(opnameOperationalAt);
  const requestId = String(mobilePayloadValue(payload, "requestId", "request_id", mobilePayloadValue(payload, "id", "id", createRuntimeId("opname_request"))) || "");
  const batchId = String(mobilePayloadValue(payload, "batchId", "batch_id", mobilePayloadValue(payload, "localId", "local_id", requestId)) || requestId);
  const note = String(mobilePayloadValue(payload, "note", "note", "") || "").trim();
  const source = String(mobilePayloadValue(payload, "source", "source", "kasir_app") || "kasir_app").trim() || "kasir_app";
  const rawRows = Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.items) ? payload.items : [];
  if (!rawRows.length) throw new Error("Minimal satu item opname wajib diisi.");

  const materialIds = [...new Set(rawRows.map((row) => String(mobilePayloadValue(row, "materialId", "material_id", row.material?.id || "") || "").trim()).filter(Boolean))];
  const materials = materialIds.length ? await db("raw_materials").whereIn("id", materialIds) : [];
  const materialMap = new Map(materials.map((material) => [material.id, material]));
  const [stockRows, purchaseRows, transferInRows, transferOutRows, salesByMaterial] = materialIds.length
    ? await Promise.all([
        db("raw_material_stocks").where("outlet_id", outletId).whereIn("material_id", materialIds),
        db("purchase_items as pi").join("purchases as p", "p.id", "pi.purchase_id").where("p.outlet_id", outletId).where("p.status", "approved").where("p.purchase_date", opnameDate).whereIn("pi.material_id", materialIds).groupBy("pi.material_id").select("pi.material_id", db.raw("SUM(pi.quantity) as quantity")),
        db("stock_transfer_items as sti").join("stock_transfers as st", "st.id", "sti.transfer_id").where("st.to_outlet_id", outletId).where("st.status", "approved").where("st.transfer_date", opnameDate).whereIn("sti.material_id", materialIds).groupBy("sti.material_id").select("sti.material_id", db.raw("SUM(sti.quantity) as quantity")),
        db("stock_transfer_items as sti").join("stock_transfers as st", "st.id", "sti.transfer_id").where("st.from_outlet_id", outletId).where("st.status", "approved").where("st.transfer_date", opnameDate).whereIn("sti.material_id", materialIds).groupBy("sti.material_id").select("sti.material_id", db.raw("SUM(sti.quantity) as quantity")),
        getDbDailySalesMaterialTotals({
          outletId,
          date: opnameDate,
          materialIds
        })
      ])
    : [[], [], [], [], new Map()];
  const stockByMaterial = new Map(stockRows.map((stock) => [stock.material_id, stock]));
  const toQuantityMap = (rows) => new Map(rows.map((item) => [item.material_id, Number(item.quantity || 0)]));
  const purchasesByMaterial = toQuantityMap(purchaseRows);
  const transferInByMaterial = toQuantityMap(transferInRows);
  const transferOutByMaterial = toQuantityMap(transferOutRows);
  const rows = rawRows.map((row, index) => {
    const materialId = String(mobilePayloadValue(row, "materialId", "material_id", row.material?.id || "") || "").trim();
    const material = materialMap.get(materialId);
    if (!material || (material.status === "inactive" && !allowInactiveMaterialIds.has(materialId))) {
      throw new Error(`Harga Pokok Produksi baris ${index + 1} wajib valid.`);
    }
    const openingQuantity = roundQuantity(mobilePayloadValue(row, "openingQuantity", "opening_quantity", 0));
    const transferOutQuantity = roundQuantity(transferOutByMaterial.get(materialId) || 0);
    const transferInQuantity = roundQuantity(transferInByMaterial.get(materialId) || 0);
    const salesQuantity = roundQuantity(salesByMaterial.get(materialId) || 0);
    const damageQuantity = roundQuantity(mobilePayloadValue(row, "damageQuantity", "damage_quantity", 0));
    const actualQuantity = roundQuantity(mobilePayloadValue(row, "actualQuantity", "actual_quantity", mobilePayloadValue(row, "physicalQuantity", "physical_quantity", 0)));
    if (![openingQuantity, damageQuantity, actualQuantity].every(Number.isFinite) || openingQuantity < 0 || damageQuantity < 0 || actualQuantity < 0) {
      throw new Error(`Stok awal, rusak, dan sisa stok baris ${index + 1} wajib valid.`);
    }
    const stock = stockByMaterial.get(materialId) || {};
    const unitPrice = Number(stock.last_purchase_price || material.last_purchase_price || 0);
    const calculated = calculateStockOpname({
      openingQuantity,
      purchaseQuantity: purchasesByMaterial.get(materialId) || 0,
      transferInQuantity,
      transferOutQuantity,
      salesQuantity,
      damageQuantity,
      actualQuantity,
      unitPrice
    });
    return {
      id: createRuntimeId("opname_item"),
      outlet_id: outletId,
      material_id: materialId,
      system_quantity: calculated.system_quantity,
      actual_quantity: calculated.actual_quantity,
      unit: material.unit || row.unit || "",
      difference: calculated.difference,
      note,
      created_by: createdBy,
      opname_date: opnameDate,
      operational_at: opnameOperationalAt,
      batch_id: batchId,
      damage_quantity: calculated.damage_quantity,
      unit_price: unitPrice,
      loss_amount: calculated.loss_amount,
      status: "pending",
      request_id: requestId,
      opening_quantity: calculated.opening_quantity,
      incoming_quantity: calculated.incoming_quantity,
      transfer_quantity: calculated.transfer_quantity,
      transfer_out_quantity: calculated.transfer_out_quantity,
      computed_sales_quantity: calculated.computed_sales_quantity,
      source,
      approved_by: null,
      approved_at: null,
      rejected_by: null,
      rejected_at: null,
      rejection_note: null
    };
  });
  return { requestId, batchId, outletId, rows };
}

async function createPosStockOpnameRequest(payload = {}, createdBy = null) {
  const normalized = await normalizeStockOpnamePayloadForDb(payload, createdBy);
  const duplicate = await db("stock_opnames")
    .where((query) => query.where("request_id", normalized.requestId).orWhere("batch_id", normalized.batchId))
    .first();
  if (duplicate) {
    const requests = await getStockOpnameRequests({
      outletId: duplicate.outlet_id
    });
    return requests.find((request) => request.id === duplicate.request_id || request.batch_id === duplicate.batch_id);
  }
  const rawRows = Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.items) ? payload.items : [];
  const requestedMaterialIds = [...new Set(rawRows.map((row) => String(mobilePayloadValue(row, "materialId", "material_id", row.material?.id || "") || "").trim()).filter(Boolean))];
  const selectedMaterialIds = await getSelectedStockOpnameMaterialIds(normalized.outletId);
  if (requestedMaterialIds.some((materialId) => !selectedMaterialIds.has(materialId))) {
    const error = new Error("Item request tidak termasuk pilihan Stock Opname APK untuk outlet ini. Muat ulang worksheet.");
    error.status = 422;
    throw error;
  }
  await db("stock_opnames").insert(normalized.rows);
  const source = normalized.rows[0]?.source || "kasir_app";
  await writeDbActivityLog({
    actor_user_id: createdBy,
    outlet_id: normalized.outletId,
    source,
    module: "stock_opname",
    action: "create_request",
    entity_type: "stock_opname_request",
    entity_id: normalized.requestId,
    description: source === "admin_web" ? "Admin input request stock opname" : "Kasir input request stock opname",
    metadata_json: {
      batch_id: normalized.batchId,
      item_count: normalized.rows.length
    }
  });
  const requests = await getStockOpnameRequests({
    outletId: normalized.outletId
  });
  return requests.find((request) => request.id === normalized.requestId || request.batch_id === normalized.batchId);
}

function canEditReport(reportDateStr) {
  if (!reportDateStr) return true;
  const now = new Date();
  
  // reportDateStr format: YYYY-MM-DD atau format string tanggal lain
  const cleanDateStr = reportDateStr.includes(" ") ? reportDateStr.split(" ")[0] : reportDateStr;
  const reportParts = cleanDateStr.split("-");
  if (reportParts.length < 3) return true;
  
  const reportYear = parseInt(reportParts[0], 10);
  const reportMonth = parseInt(reportParts[1], 10) - 1;
  const reportDay = parseInt(reportParts[2], 10);
  
  // Batas edit adalah keesokan harinya jam 12:00:00 WIB (UTC+7)
  // Jam 12:00:00 WIB = 05:00:00 UTC
  const limitDate = new Date(Date.UTC(reportYear, reportMonth, reportDay + 1, 5, 0, 0));
  
  return now.getTime() <= limitDate.getTime();
}

function stockOpnameRequestError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function updatePosStockOpnameRequest(requestId, payload = {}, updatedBy = null) {
  const existingRows = await findStockOpnameRequestRows(requestId);
  if (!existingRows.length) throw stockOpnameRequestError("Request stock opname tidak ditemukan.", 404);
  const request = groupOpnameRequests(existingRows)[0];
  if (request.status !== "pending") throw stockOpnameRequestError("Hanya request opname pending yang bisa diedit.", 409);
  
  // Validasi batas waktu edit (12:00 WIB keesokan harinya)
  const opnameDateStr = request.opname_date || request.date;
  if (opnameDateStr && !canEditReport(opnameDateStr)) {
    throw stockOpnameRequestError("Batas waktu edit laporan logistik (12:00 WIB keesokan harinya) sudah terlewati.", 400);
  }

  const editorUser = await db("users").where({ id: updatedBy }).first();
  const isEditorAdmin = editorUser && ["role_owner", "role_admin", "superadmin"].includes(editorUser.role_id);
  
  if (!isEditorAdmin && (!updatedBy || String(request.requested_by || "") !== String(updatedBy))) {
    throw stockOpnameRequestError("Request opname hanya dapat diedit oleh pembuatnya.", 403);
  }

  const payloadOutletId = String(mobilePayloadValue(payload, "outletId", "outlet_id", "") || "").trim();
  if (payloadOutletId !== String(request.outlet_id)) throw stockOpnameRequestError("Outlet request opname tidak boleh diubah.", 422);

  const rawRows = Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.items) ? payload.items : [];
  const requestedMaterialIds = [...new Set(rawRows.map((row) => String(mobilePayloadValue(row, "materialId", "material_id", row.material?.id || "") || "").trim()).filter(Boolean))];
  const currentSelectedIds = await getSelectedStockOpnameMaterialIds(request.outlet_id);
  const snapshotIds = new Set(existingRows.map((row) => row.material_id));
  if (requestedMaterialIds.some((materialId) => !currentSelectedIds.has(materialId) && !snapshotIds.has(materialId))) {
    throw stockOpnameRequestError("Item edit tidak termasuk pilihan outlet atau snapshot request sebelumnya.", 422);
  }

  const normalized = await normalizeStockOpnamePayloadForDb(
    {
      ...payload,
      id: request.id,
      request_id: request.id,
      batch_id: request.batch_id,
      outlet_id: request.outlet_id,
      source: request.source || "kasir_app"
    },
    request.requested_by,
    { allowInactiveMaterialIds: snapshotIds }
  );
  const previousDate = request.operational_at || request.opname_date;
  const rowIds = existingRows.map((row) => row.id);

  await db.transaction(async (trx) => {
    const lockedRows = await trx("stock_opnames").whereIn("id", rowIds).forUpdate();
    if (lockedRows.length !== rowIds.length || lockedRows.some((row) => row.status !== "pending")) {
      throw stockOpnameRequestError("Request opname sudah diproses Admin. Muat ulang data.", 409);
    }
    await trx("stock_opnames").whereIn("id", rowIds).delete();
    await trx("stock_opnames").insert(
      normalized.rows.map((row) => ({
        ...row,
        created_by: request.requested_by,
        updated_by: updatedBy,
        updated_at: new Date()
      }))
    );
  });

  await writeDbActivityLog({
    actor_user_id: updatedBy,
    outlet_id: request.outlet_id,
    source: "kasir_app",
    module: "stock_opname",
    action: "update_request",
    entity_type: "stock_opname_request",
    entity_id: request.id,
    description: `Request opname ${request.id} diperbarui sebelum approval.`,
    metadata_json: {
      batch_id: request.batch_id,
      previous_date: previousDate,
      next_date: normalized.rows[0]?.operational_at || normalized.rows[0]?.opname_date,
      previous_item_count: existingRows.length,
      next_item_count: normalized.rows.length
    }
  });

  return (await getStockOpnameRequests({ outletId: request.outlet_id })).find((item) => item.id === request.id || item.batch_id === request.batch_id);
}

async function deletePosStockOpnameRequest(requestId, deletedBy = null) {
  const existingRows = await findStockOpnameRequestRows(requestId);
  if (!existingRows.length) throw stockOpnameRequestError("Request stock opname tidak ditemukan.", 404);
  const request = groupOpnameRequests(existingRows)[0];
  if (request.status !== "pending") throw stockOpnameRequestError("Hanya request opname pending yang bisa dihapus.", 409);
  if (!deletedBy || String(request.requested_by || "") !== String(deletedBy)) {
    throw stockOpnameRequestError("Request opname hanya dapat dihapus oleh pembuatnya.", 403);
  }

  const rowIds = existingRows.map((row) => row.id);

  await db.transaction(async (trx) => {
    const lockedRows = await trx("stock_opnames").whereIn("id", rowIds).forUpdate();
    if (lockedRows.length !== rowIds.length || lockedRows.some((row) => row.status !== "pending")) {
      throw stockOpnameRequestError("Request opname sudah diproses Admin. Muat ulang data.", 409);
    }
    await trx("stock_opnames").whereIn("id", rowIds).delete();
  });

  await writeDbActivityLog({
    actor_user_id: deletedBy,
    outlet_id: request.outlet_id,
    source: "kasir_app",
    module: "stock_opname",
    action: "delete_request",
    entity_type: "stock_opname_request",
    entity_id: request.id,
    description: `Request opname ${request.id} dihapus sebelum approval.`,
    metadata_json: {
      batch_id: request.batch_id,
      date: request.operational_at || request.opname_date
    }
  });

  return { id: requestId, deleted: true };
}

async function createStockOpname(payload = {}) {
  const outletId = payload.outlet_id || payload.outletId;
  const materialId = payload.material_id || payload.materialId;
  const stock = outletId && materialId ? await db("raw_material_stocks").where({ outlet_id: outletId, material_id: materialId }).first() : null;
  const material = materialId ? await db("raw_materials").where({ id: materialId }).whereNot("status", "inactive").first() : null;
  const systemQuantity = Number(payload.system_quantity ?? payload.systemQuantity ?? stock?.quantity ?? 0);
  const actualQuantity = Number(payload.actual_quantity ?? payload.actualQuantity ?? payload.physical_quantity ?? payload.physicalQuantity);
  if (!outletId || !material || Number.isNaN(actualQuantity) || actualQuantity < 0) {
    throw new Error("Outlet, produk, dan qty fisik wajib valid.");
  }
  return createPosStockOpnameRequest(
    {
      outlet_id: outletId,
      opname_date: payload.opname_date || payload.opnameDate || new Date(),
      note: payload.note || "",
      source: "admin_web",
      rows: [
        {
          material_id: materialId,
          opening_quantity: Number(payload.opening_quantity ?? payload.openingQuantity ?? systemQuantity),
          incoming_quantity: Number(payload.incoming_quantity ?? payload.incomingQuantity ?? 0),
          transfer_quantity: Number(payload.transfer_quantity ?? payload.transferQuantity ?? 0),
          transfer_out_quantity: Number(payload.transfer_out_quantity ?? payload.transferOutQuantity ?? 0),
          damage_quantity: Number(payload.damage_quantity ?? payload.damageQuantity ?? 0),
          system_quantity: systemQuantity,
          actual_quantity: actualQuantity,
          unit_price: Number(payload.unit_price ?? payload.unitPrice ?? stock?.last_purchase_price ?? material.last_purchase_price ?? 0)
        }
      ]
    },
    payload.created_by || payload.createdBy || null
  );
}

async function createStockOpnameBatch(payload = {}) {
  const rows = Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.items) ? payload.items : [];
  if (!rows.length) throw new Error("Minimal satu item opname wajib diisi.");
  return createPosStockOpnameRequest(
    {
      outlet_id: payload.outlet_id || payload.outletId,
      opname_date: payload.opname_date || payload.opnameDate || payload.date || new Date(),
      note: payload.note || "",
      source: "admin_web",
      rows
    },
    payload.created_by || payload.createdBy || null
  );
}

async function findStockOpnameRequestRows(requestId) {
  const rows = await fetchStockOpnameRows({});
  const direct = rows.filter((row) => row.request_id === requestId || row.batch_id === requestId || row.id === requestId);
  if (!direct.length) throw new Error("Request opname tidak ditemukan.");
  const key = direct[0].request_id || direct[0].batch_id || direct[0].id;
  return rows.filter((row) => (row.request_id || row.batch_id || row.id) === key);
}

async function approveStockOpnameRequest(requestId, payload = {}) {
  const rows = await findStockOpnameRequestRows(requestId);
  const request = groupOpnameRequests(rows)[0];
  if (request.status !== "pending") throw new Error("Hanya request opname pending yang bisa di-approve.");
  const approvedBy = payload.approved_by || payload.approvedBy || null;
  await db.transaction(async (trx) => {
    const lockedRows = await trx("stock_opnames")
      .whereIn(
        "id",
        rows.map((row) => row.id)
      )
      .forUpdate();
    if (lockedRows.length !== rows.length || lockedRows.some((row) => row.status !== "pending")) {
      throw stockOpnameRequestError("Request opname sudah berubah atau diproses. Muat ulang data.", 409);
    }
    for (const row of rows) {
      const stockPayload = {
        quantity: row.actual_quantity,
        unit: row.unit,
        stock_value: Math.round(Number(row.actual_quantity || 0) * Number(row.unit_price || 0))
      };
      const existing = await trx("raw_material_stocks").where({ outlet_id: row.outlet_id, material_id: row.material_id }).first();
      if (existing) {
        await trx("raw_material_stocks").where({ id: existing.id }).update(stockPayload);
      } else {
        await trx("raw_material_stocks").insert({
          id: createRuntimeId("stock"),
          outlet_id: row.outlet_id,
          material_id: row.material_id,
          last_purchase_price: row.unit_price || 0,
          last_purchase_date: row.opname_date,
          ...stockPayload
        });
      }
    }
    await trx("stock_opnames")
      .whereIn(
        "id",
        rows.map((row) => row.id)
      )
      .update({
        status: "approved",
        approved_by: approvedBy,
        approved_at: new Date()
      });
  });
  await writeDbActivityLog({
    actor_user_id: approvedBy,
    outlet_id: request.outlet_id,
    source: "admin_web",
    module: "stock_opname",
    action: "approve",
    entity_type: "stock_opname_request",
    entity_id: request.id,
    description: `Request opname ${request.id} di-approve.`,
    metadata_json: { item_count: request.item_count }
  });
  return (await getStockOpnameRequests({ outletId: request.outlet_id })).find((item) => item.id === request.id || item.batch_id === request.batch_id);
}

async function rejectStockOpnameRequest(requestId, payload = {}) {
  const rows = await findStockOpnameRequestRows(requestId);
  const request = groupOpnameRequests(rows)[0];
  if (request.status !== "pending") throw new Error("Hanya request opname pending yang bisa di-reject.");
  const rejectedBy = payload.rejected_by || payload.rejectedBy || null;
  const rejectionNote = String(payload.rejection_note || payload.reason || payload.note || "").trim();
  if (!rejectionNote) throw new Error("Alasan reject wajib diisi.");
  await db.transaction(async (trx) => {
    const lockedRows = await trx("stock_opnames")
      .whereIn(
        "id",
        rows.map((row) => row.id)
      )
      .forUpdate();
    if (lockedRows.length !== rows.length || lockedRows.some((row) => row.status !== "pending")) {
      throw stockOpnameRequestError("Request opname sudah berubah atau diproses. Muat ulang data.", 409);
    }
    await trx("stock_opnames")
      .whereIn(
        "id",
        rows.map((row) => row.id)
      )
      .update({
        status: "rejected",
        rejected_by: rejectedBy,
        rejected_at: new Date(),
        rejection_note: rejectionNote
      });
  });
  await writeDbActivityLog({
    actor_user_id: rejectedBy,
    outlet_id: request.outlet_id,
    source: "admin_web",
    module: "stock_opname",
    action: "reject",
    entity_type: "stock_opname_request",
    entity_id: request.id,
    description: `Request opname ${request.id} ditolak.`,
    metadata_json: { rejection_note: rejectionNote }
  });
  return (await getStockOpnameRequests({ outletId: request.outlet_id })).find((item) => item.id === request.id || item.batch_id === request.batch_id);
}

async function createDbCustomerBarcode(outletId) {
  const outlet = await db("outlets").where({ id: outletId }).first();
  const outletCode = outlet?.code || "BRK";
  const prefix = `CUST-${outletCode}-`;
  const rows = await db("customers").where({ outlet_id: outletId }).where("barcode", "like", `${prefix}%`).select("barcode");
  const maxNumber = rows.reduce((max, customer) => {
    const number = Number(String(customer.barcode || "").replace(prefix, ""));
    return Number.isNaN(number) ? max : Math.max(max, number);
  }, 0);
  return `${prefix}${String(maxNumber + 1).padStart(4, "0")}`;
}

async function generateCustomerBarcode(outletId, actorUserId = null) {
  const outlet = await db("outlets").where({ id: outletId }).first();
  if (!outlet) {
    const error = new Error("Outlet tidak ditemukan.");
    error.status = 404;
    error.code = "OUTLET_NOT_FOUND";
    throw error;
  }
  const barcode = await createDbCustomerBarcode(outletId);
  await writeDbActivityLog({
    actor_user_id: actorUserId,
    outlet_id: outletId,
    source: "admin_web",
    module: "customer",
    action: "customer/generate_barcode",
    entity_type: "customer_barcode",
    entity_id: outletId,
    description: `Admin generate barcode customer untuk ${outlet.name}.`,
    metadata_json: { barcode }
  });
  return { barcode };
}

function normalizeAdminCustomerPayload(payload = {}, customerId = null) {
  const name = String(payload.name || "").trim();
  const phone = String(payload.phone || "").trim();
  const outletId = String(payload.outlet_id || payload.outletId || "").trim();
  const status = payload.status === "inactive" ? "inactive" : "active";
  const barcode = String(payload.barcode || "")
    .trim()
    .toUpperCase();
  const registeredAt = payload.registered_at || payload.registeredAt ? dateOnly(payload.registered_at || payload.registeredAt) : null;

  if (!name || !phone || !outletId) {
    const error = new Error("Nama customer, nomor HP, dan outlet wajib diisi.");
    error.status = 422;
    error.code = "CUSTOMER_INVALID";
    throw error;
  }

  return {
    name,
    phone,
    outlet_id: outletId,
    status,
    barcode,
    registered_at: registeredAt,
    customerId
  };
}

async function validateAdminCustomerPayload(row) {
  const outlet = await db("outlets").where({ id: row.outlet_id }).first();
  if (!outlet) {
    const error = new Error("Outlet tidak ditemukan.");
    error.status = 422;
    error.code = "CUSTOMER_OUTLET_INVALID";
    throw error;
  }

  const duplicatePhone = await db("customers")
    .where({ outlet_id: row.outlet_id, phone: row.phone })
    .modify((query) => {
      if (row.customerId) query.whereNot({ id: row.customerId });
    })
    .first();
  if (duplicatePhone) {
    const error = new Error("Nomor HP sudah terdaftar di outlet ini.");
    error.status = 422;
    error.code = "CUSTOMER_PHONE_DUPLICATE";
    throw error;
  }

  if (row.barcode) {
    const duplicateBarcode = await db("customers")
      .whereRaw("LOWER(barcode) = ?", [row.barcode.toLowerCase()])
      .modify((query) => {
        if (row.customerId) query.whereNot({ id: row.customerId });
      })
      .first();
    if (duplicateBarcode) {
      const error = new Error("Barcode sudah digunakan customer lain.");
      error.status = 422;
      error.code = "CUSTOMER_BARCODE_DUPLICATE";
      throw error;
    }
  }

  return outlet;
}

function normalizeCustomerRow(row = {}) {
  return {
    ...row,
    registered_at: dateOnly(row.registered_at || row.created_at || new Date()),
    outlet: row.outlet_id
      ? {
          id: row.outlet_id,
          name: row.outlet_name || row.outlet_id,
          code: row.outlet_code || undefined
        }
      : null
  };
}

async function getCustomerDetail(customerId) {
  const row = await db("customers as c").leftJoin("outlets as o", "c.outlet_id", "o.id").where("c.id", customerId).select("c.*", db.raw("o.name as outlet_name"), db.raw("o.code as outlet_code")).first();
  if (!row) {
    const error = new Error("Customer tidak ditemukan.");
    error.status = 404;
    error.code = "CUSTOMER_NOT_FOUND";
    throw error;
  }
  return normalizeCustomerRow(row);
}

async function createCustomer(payload = {}) {
  const normalized = normalizeAdminCustomerPayload(payload);
  await validateAdminCustomerPayload(normalized);
  const id = payload.id || createRuntimeId("customer");
  const barcode = normalized.barcode || (await createDbCustomerBarcode(normalized.outlet_id));
  const row = {
    id,
    outlet_id: normalized.outlet_id,
    name: normalized.name,
    phone: normalized.phone,
    barcode,
    points: Number(payload.points || 0),
    status: normalized.status,
    registered_at: normalized.registered_at || dateOnly(new Date())
  };
  await db("customers").insert(row);
  await writeDbActivityLog({
    actor_user_id: payload.created_by || payload.createdBy || null,
    outlet_id: row.outlet_id,
    source: "admin_web",
    module: "customer",
    action: "customer/create",
    entity_type: "customer",
    entity_id: id,
    description: `Customer ${row.name} dibuat.`,
    metadata_json: { phone: row.phone, barcode: row.barcode }
  });
  return getCustomerDetail(id);
}

async function updateCustomer(customerId, payload = {}) {
  const current = await getCustomerDetail(customerId);
  const normalized = normalizeAdminCustomerPayload(payload, customerId);
  await validateAdminCustomerPayload(normalized);
  const barcode = normalized.barcode || current.barcode || (await createDbCustomerBarcode(normalized.outlet_id));
  await db("customers")
    .where({ id: customerId })
    .update({
      outlet_id: normalized.outlet_id,
      name: normalized.name,
      phone: normalized.phone,
      barcode,
      status: normalized.status,
      registered_at: normalized.registered_at || current.registered_at
    });
  await writeDbActivityLog({
    actor_user_id: payload.updated_by || payload.updatedBy || null,
    outlet_id: normalized.outlet_id,
    source: "admin_web",
    module: "customer",
    action: "customer/update",
    entity_type: "customer",
    entity_id: customerId,
    description: `Customer ${normalized.name} diperbarui.`,
    metadata_json: {
      phone: normalized.phone,
      barcode,
      status: normalized.status
    }
  });
  return getCustomerDetail(customerId);
}

async function toggleCustomerStatus(customerId, actorUserId = null) {
  const current = await getCustomerDetail(customerId);
  const nextStatus = current.status === "active" ? "inactive" : "active";
  await db("customers").where({ id: customerId }).update({ status: nextStatus });
  await writeDbActivityLog({
    actor_user_id: actorUserId,
    outlet_id: current.outlet_id,
    source: "admin_web",
    module: "customer",
    action: "customer/toggle_status",
    entity_type: "customer",
    entity_id: customerId,
    description: `Status customer ${current.name} menjadi ${nextStatus}.`,
    metadata_json: { previous_status: current.status, next_status: nextStatus }
  });
  return getCustomerDetail(customerId);
}

async function getPosCustomers({ outletId = "all", keyword = "" } = {}) {
  const rows = await db("customers")
    .modify((query) => {
      if (outletId && outletId !== "all") query.where("outlet_id", outletId);
      query.whereNot("status", "inactive");
    })
    .orderBy("name");
  return rows.filter((customer) => includesText(`${customer.name} ${customer.phone} ${customer.barcode}`, keyword)).map(customerToMobile);
}

async function createPosCustomer(payload = {}, createdBy = null) {
  const outletId = String(payload.outletId || payload.outlet_id || "").trim();
  const phone = String(payload.phone || "").trim();
  const name = String(payload.name || "").trim();
  const cleanPhone = normalizePhone(phone);
  const outlet = outletId ? await db("outlets").where({ id: outletId, status: "active" }).first() : null;

  if (!outlet || !name) {
    throw new Error("Outlet dan nama customer wajib valid.");
  }

  if (cleanPhone) {
    const existingRows = await db("customers").where({ outlet_id: outletId });
    const existing = existingRows.find((customer) => normalizePhone(customer.phone) === cleanPhone);
    if (existing) {
      throw new Error(`Nomor HP sudah terdaftar atas nama ${existing.name}. Pilih customer tersebut dari daftar, atau gunakan nomor lain.`);
    }
  }

  const customer = {
    id: createRuntimeId("customer"),
    outlet_id: outletId,
    name,
    phone: cleanPhone || null,
    barcode: await createDbCustomerBarcode(outletId),
    points: 0,
    status: "active",
    registered_at: dateOnly(new Date())
  };

  await db("customers").insert(customer);
  await writeDbActivityLog({
    actor_user_id: createdBy || payload.createdBy || payload.created_by || null,
    outlet_id: outletId,
    source: "kasir_app",
    module: "customer",
    action: "customer/create",
    entity_type: "customer",
    entity_id: customer.id,
    description: `Kasir membuat customer ${customer.name}.`,
    metadata_json: { phone: customer.phone, barcode: customer.barcode }
  });
  return customerToMobile(customer);
}

function mobilePayloadValue(payload = {}, camelKey, snakeKey, fallback = null) {
  if (Object.prototype.hasOwnProperty.call(payload, camelKey)) return payload[camelKey];
  if (Object.prototype.hasOwnProperty.call(payload, snakeKey)) return payload[snakeKey];
  return fallback;
}

function mobilePayloadNumber(payload = {}, camelKey, snakeKey, fallback = 0) {
  const value = mobilePayloadValue(payload, camelKey, snakeKey, fallback);
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number(fallback || 0);
}

function serializeDateTime(value = new Date()) {
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function serializeMysqlDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const pad = (part) => String(part).padStart(2, "0");
  return [safeDate.getFullYear(), pad(safeDate.getMonth() + 1), pad(safeDate.getDate())].join("-") + ` ${pad(safeDate.getHours())}:${pad(safeDate.getMinutes())}:${pad(safeDate.getSeconds())}`;
}

function normalizeOpenBillItemToMobile(item = {}) {
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unit_price || item.unitPrice || 0);
  const metadata = parseJson(item.metadata_json, {});
  const selectedVariants = Array.isArray(item.selectedVariants) ? item.selectedVariants : Array.isArray(item.selected_variants) ? item.selected_variants : Array.isArray(metadata.selected_variants) ? metadata.selected_variants : [];
  return {
    productId: item.product_id || item.productId || "",
    productName: item.product_name || item.productName || "",
    categoryId: item.category_id || item.categoryId || "",
    categoryName: item.category_name || item.categoryName || "",
    quantity,
    unitPrice,
    subtotal: Number(item.subtotal || quantity * unitPrice || 0),
    variantIds: selectedVariants.map((variant) => variant.id).filter(Boolean),
    selectedVariants
  };
}

function normalizeOpenBillPrintedItems(value) {
  const rows = parseJson(value, Array.isArray(value) ? value : []);
  return (Array.isArray(rows) ? rows : []).map(normalizeOpenBillItemToMobile);
}

function openBillToMobile(bill = {}, items = []) {
  const serviceType = bill.service_type || bill.serviceType || (bill.table_number || bill.tableNumber ? "dine_in" : "takeaway");
  return {
    id: bill.id,
    orderNumber: bill.order_number || bill.orderNumber || "",
    outletId: bill.outlet_id || bill.outletId || "",
    cashierId: bill.cashier_id || bill.cashierId || "",
    serviceType: serviceType === "dine_in" ? "dine_in" : "takeaway",
    tableId: bill.table_id || bill.tableId || null,
    tableNumber: bill.table_number || bill.tableNumber || null,
    customerId: bill.customer_id || bill.customerId || null,
    customerName: bill.customer_name || bill.customerName || null,
    customerPhone: bill.customer_phone || bill.customerPhone || null,
    customerPoints: Number(bill.customer_points || bill.customerPoints || 0),
    total: Number(bill.total || 0),
    status: bill.status || "open",
    createdAt: serializeDateTime(bill.created_at || bill.createdAt),
    updatedAt: serializeDateTime(bill.updated_at || bill.updatedAt),
    synced: true,
    items: items.map(normalizeOpenBillItemToMobile),
    customerPrintedItems: normalizeOpenBillPrintedItems(bill.customer_printed_items_json ?? bill.customerPrintedItems),
    kitchenPrintedItems: normalizeOpenBillPrintedItems(bill.kitchen_printed_items_json ?? bill.kitchenPrintedItems)
  };
}

async function normalizeOpenBillPayloadForDb(payload = {}) {
  const outletId = String(mobilePayloadValue(payload, "outletId", "outlet_id", "") || "").trim();
  const cashierId = String(mobilePayloadValue(payload, "cashierId", "cashier_id", "") || "").trim();
  const requestedServiceType = String(mobilePayloadValue(payload, "serviceType", "service_type", "takeaway") || "takeaway").trim();
  const serviceType = requestedServiceType === "dine_in" ? "dine_in" : "takeaway";
  const rawTableNumber = String(mobilePayloadValue(payload, "tableNumber", "table_number", "") || "")
    .trim()
    .toUpperCase();
  const tableNumber = serviceType === "dine_in" ? rawTableNumber : null;
  const rawItems = Array.isArray(payload.items) ? payload.items : [];

  const [outlet, cashier, table] = await Promise.all([outletId ? db("outlets").where({ id: outletId, status: "active" }).first() : null, cashierId ? db("users").where({ id: cashierId, status: "active" }).first() : null, outletId && tableNumber ? db("dining_tables").where({ outlet_id: outletId, number: tableNumber, status: "active" }).first() : null]);

  if (!outlet) throw new Error("Outlet open bill tidak valid.");
  if (!cashier) throw new Error("Kasir open bill tidak valid.");
  if (serviceType === "dine_in" && !tableNumber) throw new Error("Meja wajib dipilih untuk open bill dine in.");
  if (serviceType === "dine_in" && !table) throw new Error("Nomor meja tidak valid untuk outlet ini.");

  const productIds = [...new Set(rawItems.map((item) => String(mobilePayloadValue(item, "productId", "product_id", "") || "").trim()).filter(Boolean))];
  const products = productIds.length ? await db("products").whereIn("id", productIds).whereNot("status", "inactive") : [];
  const productMap = new Map(products.map((product) => [product.id, product]));
  const items = rawItems
    .map((item) => {
      const productId = String(mobilePayloadValue(item, "productId", "product_id", "") || "").trim();
      const product = productMap.get(productId);
      const quantity = Math.max(0, Math.round(mobilePayloadNumber(item, "quantity", "quantity", 0)));
      const unitPrice = Math.max(0, Math.round(mobilePayloadNumber(item, "unitPrice", "unit_price", product?.price || 0)));
      const subtotal = Math.max(0, Math.round(mobilePayloadNumber(item, "subtotal", "subtotal", quantity * unitPrice)));
      const selectedVariants = Array.isArray(item.selectedVariants) ? item.selectedVariants : Array.isArray(item.selected_variants) ? item.selected_variants : [];
      return {
        product,
        row: {
          product_id: productId,
          product_name: String(mobilePayloadValue(item, "productName", "product_name", product?.name || "") || ""),
          category_id: String(mobilePayloadValue(item, "categoryId", "category_id", product?.category_id || "") || ""),
          category_name: String(mobilePayloadValue(item, "categoryName", "category_name", "") || ""),
          quantity,
          unit_price: unitPrice,
          subtotal,
          metadata_json: { selected_variants: selectedVariants }
        }
      };
    })
    .filter((item) => item.product && item.row.quantity > 0);

  const calculatedTotal = items.reduce((sum, item) => sum + Number(item.row.subtotal || 0), 0);
  const total = Math.max(0, Math.round(mobilePayloadNumber(payload, "total", "total", calculatedTotal)));
  if (!items.length || total <= 0) throw new Error("Item open bill wajib diisi.");

  const customerId = mobilePayloadValue(payload, "customerId", "customer_id", null);
  const validCustomer = customerId ? await db("customers").where({ id: customerId }).first() : null;
  const now = new Date();
  const rawId = String(mobilePayloadValue(payload, "id", "id", "") || "").trim();
  const id = rawId || createRuntimeId("open_bill");
  const orderNumber = String(mobilePayloadValue(payload, "orderNumber", "order_number", "") || "").trim();
  const hasCustomerCheckpoint = Object.prototype.hasOwnProperty.call(payload, "customerPrintedItems") || Object.prototype.hasOwnProperty.call(payload, "customer_printed_items");
  const hasKitchenCheckpoint = Object.prototype.hasOwnProperty.call(payload, "kitchenPrintedItems") || Object.prototype.hasOwnProperty.call(payload, "kitchen_printed_items");
  const customerCheckpoint = mobilePayloadValue(payload, "customerPrintedItems", "customer_printed_items", []);
  const kitchenCheckpoint = mobilePayloadValue(payload, "kitchenPrintedItems", "kitchen_printed_items", []);

  return {
    bill: {
      id,
      client_ref: mobilePayloadValue(payload, "clientRef", "client_ref", null),
      order_number: orderNumber,
      outlet_id: outletId,
      cashier_id: cashierId,
      service_type: serviceType,
      table_id: table?.id || null,
      table_number: tableNumber,
      customer_id: validCustomer ? validCustomer.id : null,
      customer_name: mobilePayloadValue(payload, "customerName", "customer_name", null),
      customer_phone: mobilePayloadValue(payload, "customerPhone", "customer_phone", null),
      customer_points: Math.max(0, Math.round(mobilePayloadNumber(payload, "customerPoints", "customer_points", 0))),
      total,
      status: mobilePayloadValue(payload, "status", "status", "open") || "open",
      created_at: new Date(mobilePayloadValue(payload, "createdAt", "created_at", now)),
      updated_at: new Date(mobilePayloadValue(payload, "updatedAt", "updated_at", now))
    },
    items: items.map((item) => item.row),
    checkpoints: {
      hasCustomerCheckpoint,
      hasKitchenCheckpoint,
      customer: JSON.stringify(normalizeOpenBillPrintedItems(customerCheckpoint)),
      kitchen: JSON.stringify(normalizeOpenBillPrintedItems(kitchenCheckpoint))
    }
  };
}

async function getOpenBills({ outletId = "all" } = {}) {
  const bills = await db("open_bills")
    .modify((query) => {
      if (outletId && outletId !== "all") query.where("outlet_id", outletId);
      query.where("status", "open");
    })
    .orderBy("updated_at", "desc");
  const billIds = bills.map((bill) => bill.id);
  const items = billIds.length ? await db("open_bill_items").whereIn("open_bill_id", billIds).orderBy("id") : [];
  const itemsByBill = items.reduce((result, item) => {
    result[item.open_bill_id] = result[item.open_bill_id] || [];
    result[item.open_bill_id].push(item);
    return result;
  }, {});
  return bills.map((bill) => openBillToMobile(bill, itemsByBill[bill.id] || []));
}

async function upsertOpenBill(payload = {}) {
  const { bill, items, checkpoints } = await normalizeOpenBillPayloadForDb(payload);
  const occupied =
    bill.service_type === "dine_in"
      ? await db("open_bills")
          .where({
            outlet_id: bill.outlet_id,
            table_number: bill.table_number,
            status: "open"
          })
          .whereNot("id", bill.id)
          .whereNot("order_number", bill.order_number)
          .first()
      : null;
  if (occupied) throw new Error("Meja sudah terpakai oleh open bill lain.");

  const existing = await db("open_bills")
    .where((query) => {
      query.where({ id: bill.id });
      if (bill.order_number) query.orWhere({ order_number: bill.order_number });
      if (bill.client_ref) query.orWhere({ client_ref: bill.client_ref });
    })
    .first();
  if (existing && bill.order_number && existing.order_number === bill.order_number && bill.client_ref && existing.client_ref && existing.client_ref !== bill.client_ref) {
    throw new Error("Nomor order sudah dipakai open bill lain.");
  }

  const saved = await db.transaction(async (trx) => {
    if (existing) {
      const checkpointUpdates = {
        customer_printed_items_json: checkpoints.hasCustomerCheckpoint ? checkpoints.customer : JSON.stringify(normalizeOpenBillPrintedItems(existing.customer_printed_items_json)),
        kitchen_printed_items_json: checkpoints.hasKitchenCheckpoint ? checkpoints.kitchen : JSON.stringify(normalizeOpenBillPrintedItems(existing.kitchen_printed_items_json))
      };
      await trx("open_bills")
        .where({ id: existing.id })
        .update({
          ...bill,
          id: existing.id,
          order_number: existing.order_number || bill.order_number,
          created_at: existing.created_at || bill.created_at,
          updated_at: new Date(),
          ...checkpointUpdates
        });
      await trx("open_bill_items").where({ open_bill_id: existing.id }).delete();
      await trx("open_bill_items").insert(
        items.map((item) => ({
          id: createRuntimeId("open_bill_item"),
          open_bill_id: existing.id,
          ...item
        }))
      );
      return trx("open_bills").where({ id: existing.id }).first();
    }

    if (!bill.order_number) {
      bill.order_number = await nextPosOrderNumber({
        outletId: bill.outlet_id,
        operationalAt: bill.created_at,
        connection: trx
      });
    } else {
      const existingTransaction = await trx("transactions").where({ order_number: bill.order_number }).first();
      if (existingTransaction && (!bill.client_ref || existingTransaction.client_ref !== bill.client_ref)) {
        let baseOrder = bill.order_number;
        let counter = 1;
        let uniqueOrder = `${baseOrder}-${counter}`;
        while (await trx("transactions").where({ order_number: uniqueOrder }).first() || await trx("open_bills").where({ order_number: uniqueOrder }).first()) {
          counter++;
          uniqueOrder = `${baseOrder}-${counter}`;
        }
        bill.order_number = uniqueOrder;
      }
      await reserveSubmittedPosOrderNumber({
        outletId: bill.outlet_id,
        orderNumber: bill.order_number,
        operationalAt: bill.created_at,
        connection: trx
      });
    }
    await trx("open_bills").insert({
      ...bill,
      customer_printed_items_json: checkpoints.hasCustomerCheckpoint ? checkpoints.customer : JSON.stringify([]),
      kitchen_printed_items_json: checkpoints.hasKitchenCheckpoint ? checkpoints.kitchen : JSON.stringify([])
    });
    await trx("open_bill_items").insert(
      items.map((item) => ({
        id: createRuntimeId("open_bill_item"),
        open_bill_id: bill.id,
        ...item
      }))
    );
    return trx("open_bills").where({ id: bill.id }).first();
  });

  await writeDbActivityLog({
    actor_user_id: saved.cashier_id,
    outlet_id: saved.outlet_id,
    source: "kasir_app",
    module: "open_bill",
    action: existing ? "update" : "create",
    entity_type: "open_bill",
    entity_id: saved.id,
    description: `Kasir ${existing ? "memperbarui" : "membuat"} open bill ${saved.order_number || saved.table_number || saved.service_type}`,
    metadata_json: {
      total: saved.total,
      serviceType: saved.service_type,
      tableNumber: saved.table_number
    }
  });

  const savedItems = await db("open_bill_items").where({ open_bill_id: saved.id }).orderBy("id");
  return openBillToMobile(saved, savedItems);
}

async function updateOpenBillPrintCheckpoint(openBillId, payload = {}, actorUserId = null) {
  const template = String(payload.template || "").trim();
  if (!["customer_order", "kitchen_order"].includes(template)) {
    throw new Error("Template checkpoint print tidak valid.");
  }
  const bill = await db("open_bills").where({ id: openBillId, status: "open" }).first();
  if (!bill) throw new Error("Open bill tidak ditemukan.");
  const column = template === "customer_order" ? "customer_printed_items_json" : "kitchen_printed_items_json";
  const items = normalizeOpenBillPrintedItems(payload.items || []);
  await db("open_bills")
    .where({ id: bill.id })
    .update({
      [column]: JSON.stringify(items),
      updated_at: new Date()
    });
  await writeDbActivityLog({
    actor_user_id: actorUserId || bill.cashier_id,
    outlet_id: bill.outlet_id,
    source: "kasir_app",
    module: "open_bill",
    action: "print_checkpoint",
    entity_type: "open_bill",
    entity_id: bill.id,
    description: `Checkpoint print ${bill.order_number} diperbarui.`,
    metadata_json: { template, item_count: items.length }
  });
  return (await getOpenBills({ outletId: bill.outlet_id })).find((item) => item.id === bill.id);
}

async function deleteOpenBill(openBillId) {
  const bill = await db("open_bills")
    .where((query) => {
      query.where({ id: openBillId }).orWhere({ order_number: openBillId });
    })
    .first();
  if (!bill) return { id: openBillId, deleted: true };

  await db("open_bills").where({ id: bill.id }).delete();
  await writeDbActivityLog({
    actor_user_id: bill.cashier_id,
    outlet_id: bill.outlet_id,
    source: "kasir_app",
    module: "open_bill",
    action: "delete",
    entity_type: "open_bill",
    entity_id: bill.id,
    description: `Kasir menghapus open bill ${bill.order_number || bill.table_number || bill.service_type}`,
    metadata_json: {
      total: bill.total,
      serviceType: bill.service_type,
      tableNumber: bill.table_number
    }
  });
  return { id: openBillId, deleted: true };
}

function expenseToMobile(expense = {}) {
  const operationalAt = expense.operational_at || expense.expense_date || expense.date;
  return {
    id: expense.id,
    outletId: expense.outlet_id || expense.outletId || "",
    category: expense.category || "",
    amount: Number(expense.amount || 0),
    note: expense.description || expense.note || "",
    date: dateOnly(operationalAt),
    expense_date: dateOnly(operationalAt),
    description: expense.description || expense.note || "",
    operationalAt,
    operational_at: operationalAt,
    outlet_id: expense.outlet_id || expense.outletId || "",
    created_by: expense.created_by || expense.createdBy || null,
    synced: true,
    status: expense.status || "approved",
    rejectionNote: expense.rejection_note || expense.rejectionNote || ""
  };
}

async function getPosExpenses({ outletId = "all", from, to } = {}) {
  const rows = await db("expenses")
    .modify((query) => {
      if (outletId && outletId !== "all") query.where("outlet_id", outletId);
      if (from) query.where("expense_date", ">=", dateOnly(from));
      if (to) query.where("expense_date", "<=", dateOnly(to));
    })
    .orderBy("expense_date", "desc")
    .orderBy("id", "desc");
  return rows.map(expenseToMobile);
}

async function normalizePosExpensePayload(payload = {}, existing = null) {
  const outletId = String(mobilePayloadValue(payload, "outletId", "outlet_id", existing?.outlet_id || "") || "").trim();
  const category = String(mobilePayloadValue(payload, "category", "category", existing?.category || "") || "").trim();
  const amount = Math.max(0, Math.round(mobilePayloadNumber(payload, "amount", "amount", existing?.amount || 0)));
  const description = String(mobilePayloadValue(payload, "note", "description", existing?.description || "") || "").trim();
  const expenseOperationalAt = serializeMysqlDateTime(mobilePayloadValue(payload, "operationalAt", "operational_at", mobilePayloadValue(payload, "date", "expense_date", existing?.operational_at || existing?.expense_date || new Date())));
  const expenseDate = dateOnly(expenseOperationalAt);
  const outlet = outletId ? await db("outlets").where({ id: outletId, status: "active" }).first() : null;

  if (!outlet) throw new Error("Outlet pengeluaran tidak valid.");
  if (existing && outletId !== existing.outlet_id) throw new Error("Outlet pengeluaran tidak boleh diubah dari APK.");
  if (!category) throw new Error("Nama pengeluaran operasional wajib dipilih.");
  if (amount <= 0) throw new Error("Nominal pengeluaran wajib lebih dari 0.");

  return {
    outlet_id: outletId,
    category,
    description,
    amount,
    expense_date: expenseDate,
    operational_at: expenseOperationalAt
  };
}

async function createPosExpense(payload = {}, createdBy = null) {
  const id = String(mobilePayloadValue(payload, "id", "id", createRuntimeId("expense")) || "");
  const existing = await db("expenses").where({ id }).first();
  if (existing) return expenseToMobile(existing);

  const expensePayload = await normalizePosExpensePayload(payload);
  const row = {
    id,
    client_ref: mobilePayloadValue(payload, "clientRef", "client_ref", null),
    ...expensePayload,
    status: "pending",
    created_by: createdBy || mobilePayloadValue(payload, "createdBy", "created_by", null)
  };
  await db("expenses").insert(row);
  await writeDbActivityLog({
    actor_user_id: row.created_by,
    outlet_id: row.outlet_id,
    source: "kasir_app",
    module: "expense",
    action: "create",
    entity_type: "expense",
    entity_id: row.id,
    description: `Kasir input pengeluaran ${row.category}`,
    metadata_json: {
      amount: row.amount,
      category: row.category,
      expense_date: row.expense_date
    }
  });
  return expenseToMobile(row);
}

async function updatePosExpense(expenseId, payload = {}, updatedBy = null) {
  const existing = await db("expenses").where({ id: expenseId }).first();
  if (!existing) throw new Error("Pengeluaran tidak ditemukan.");
  if ((existing.status || "approved") !== "pending") throw new Error("Pengeluaran hanya bisa diedit sebelum approved/rejected Admin.");

  const expensePayload = await normalizePosExpensePayload(payload, existing);
  await db("expenses")
    .where({ id: existing.id })
    .update({
      ...expensePayload,
      updated_by: updatedBy || mobilePayloadValue(payload, "updatedBy", "updated_by", null),
      updated_at: new Date()
    });
  const updated = await db("expenses").where({ id: existing.id }).first();
  await writeDbActivityLog({
    actor_user_id: updated.updated_by,
    outlet_id: updated.outlet_id,
    source: "kasir_app",
    module: "expense",
    action: "update",
    entity_type: "expense",
    entity_id: updated.id,
    description: `Kasir edit pengeluaran ${updated.category}`,
    metadata_json: {
      amount: updated.amount,
      category: updated.category,
      expense_date: updated.expense_date
    }
  });
  return expenseToMobile(updated);
}

function purchaseRowToMobile(purchase = {}, items = []) {
  const operationalAt = purchase.operational_at || purchase.purchase_date;
  const hppTotal = items.filter((item) => (item.material_type || item.material?.type || "hpp") !== "biaya").reduce((total, item) => total + Number(item.subtotal || 0), 0);
  const biayaTotal = items.filter((item) => (item.material_type || item.material?.type || "hpp") === "biaya").reduce((total, item) => total + Number(item.subtotal || 0), 0);
  return {
    ...purchase,
    items,
    outletId: purchase.outlet_id,
    supplierId: purchase.supplier_id || null,
    purchaseDate: dateOnly(operationalAt),
    operationalAt,
    operational_at: operationalAt,
    paymentType: purchase.payment_type || "lunas",
    source: purchase.source || "admin_web",
    note: purchase.note || "",
    status: purchase.status || "pending",
    synced: true,
    item_count: items.length,
    hpp_total: hppTotal,
    biaya_total: biayaTotal,
    grand_total: Number(purchase.total || hppTotal + biayaTotal || 0)
  };
}

async function fetchPurchaseRows({ outletId = "all", from, to } = {}) {
  const purchaseDateExpression = await reportDateExpression("purchases", "purchases", "purchase_date");
  const purchases = await db("purchases")
    .leftJoin("outlets", "purchases.outlet_id", "outlets.id")
    .leftJoin("suppliers", "purchases.supplier_id", "suppliers.id")
    .leftJoin("users as created_user", "purchases.created_by", "created_user.id")
    .select("purchases.*", db.raw("outlets.name as outlet_name"), db.raw("suppliers.name as supplier_name"), db.raw("created_user.name as created_by_name"))
    .modify((query) => {
      if (outletId && outletId !== "all") query.where("purchases.outlet_id", outletId);
      applyDateRangeExpression(query, purchaseDateExpression, from, to);
    })
    .orderByRaw(`${purchaseDateExpression} desc`)
    .orderBy("purchases.id", "desc");
  const purchaseIds = purchases.map((purchase) => purchase.id);
  const items = purchaseIds.length ? await db("purchase_items as pi").join("raw_materials as rm", "pi.material_id", "rm.id").leftJoin("raw_material_categories as rmc", "rm.category_id", "rmc.id").whereIn("pi.purchase_id", purchaseIds).select("pi.*", db.raw("rm.name as material_name"), db.raw("rm.type as material_type"), db.raw("rm.category_id as material_category_id"), db.raw("rmc.name as category_name"), db.raw("rmc.account_code as category_account_code")) : [];
  const itemsByPurchase = items.reduce((result, item) => {
    const row = {
      material_id: item.material_id,
      quantity: Number(item.quantity || 0),
      unit: item.unit,
      unit_price: Number(item.unit_price || 0),
      subtotal: Number(item.subtotal || 0),
      material_type: item.material_type || "hpp",
      material: {
        id: item.material_id,
        name: item.material_name,
        type: item.material_type || "hpp",
        category_id: item.material_category_id,
        unit: item.unit
      },
      category: item.category_name
        ? {
            id: item.material_category_id,
            name: item.category_name,
            account_code: item.category_account_code
          }
        : null
    };
    result[item.purchase_id] = result[item.purchase_id] || [];
    result[item.purchase_id].push(row);
    return result;
  }, {});

  return purchases.map((purchase) =>
    purchaseRowToMobile(
      {
        ...purchase,
        outlet: purchase.outlet_name ? { id: purchase.outlet_id, name: purchase.outlet_name } : null,
        supplier: purchase.supplier_name ? { id: purchase.supplier_id, name: purchase.supplier_name } : null,
        created_by_user: purchase.created_by_name ? { id: purchase.created_by, name: purchase.created_by_name } : null
      },
      itemsByPurchase[purchase.id] || []
    )
  );
}

async function normalizePurchasePayloadForDb(payload = {}, { createdBy = null, source = "kasir_app", existing = null } = {}) {
  const outletId = String(mobilePayloadValue(payload, "outletId", "outlet_id", existing?.outlet_id || "") || "").trim();
  const supplierId = mobilePayloadValue(payload, "supplierId", "supplier_id", existing?.supplier_id || null);
  const paymentType = String(mobilePayloadValue(payload, "paymentType", "payment_type", existing?.payment_type || "lunas") || "").trim();
  const purchaseOperationalAt = serializeMysqlDateTime(mobilePayloadValue(payload, "operationalAt", "operational_at", mobilePayloadValue(payload, "purchaseDate", "purchase_date", existing?.operational_at || existing?.purchase_date || new Date())));
  const purchaseDate = dateOnly(purchaseOperationalAt);
  const note = String(mobilePayloadValue(payload, "note", "note", existing?.note || "") || "").trim();
  const rawItems = Array.isArray(payload.items) ? payload.items : [];

  const [outlet, supplier] = await Promise.all([outletId ? db("outlets").where({ id: outletId, status: "active" }).first() : null, supplierId ? db("suppliers").where({ id: supplierId, status: "active" }).first() : null]);
  if (!outlet) throw new Error("Outlet pembelian wajib valid.");
  if (existing && outletId !== existing.outlet_id) throw new Error("Outlet pembelian tidak boleh diubah dari APK.");
  if (supplierId && !supplier) throw new Error("Supplier pembelian tidak valid atau inactive.");
  if (!["lunas", "bon"].includes(paymentType)) throw new Error("Tipe pembayaran pembelian harus lunas atau bon.");
  if (!rawItems.length) throw new Error("Minimal satu harga pokok produksi wajib diisi.");

  const materialIds = [...new Set(rawItems.map((item) => String(mobilePayloadValue(item, "materialId", "material_id", "") || "").trim()).filter(Boolean))];
  const materials = materialIds.length ? await db("raw_materials").whereIn("id", materialIds).whereNot("status", "inactive") : [];
  const materialMap = new Map(materials.map((material) => [material.id, material]));
  const items = rawItems.map((item, index) => {
    const materialId = String(mobilePayloadValue(item, "materialId", "material_id", "") || "").trim();
    const material = materialMap.get(materialId);
    const quantity = Number(mobilePayloadValue(item, "quantity", "quantity", 0));
    const unitPrice = Number(mobilePayloadValue(item, "unitPrice", "unit_price", 0));
    if (!material || quantity <= 0 || unitPrice <= 0) {
      throw new Error(`Harga Pokok Produksi, qty, dan harga baris ${index + 1} wajib valid.`);
    }
    return {
      material_id: materialId,
      quantity,
      unit: material.unit,
      unit_price: Math.round(unitPrice),
      subtotal: Math.round(quantity * unitPrice)
    };
  });
  const total = items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);

  return {
    purchase: {
      outlet_id: outletId,
      supplier_id: supplierId || null,
      purchase_date: purchaseDate,
      operational_at: purchaseOperationalAt,
      status: "pending",
      payment_type: paymentType,
      source,
      batch_id: mobilePayloadValue(payload, "batchId", "batch_id", mobilePayloadValue(payload, "localId", "local_id", existing?.batch_id || null)),
      note,
      created_by: existing?.created_by || createdBy || mobilePayloadValue(payload, "createdBy", "created_by", null),
      total
    },
    items
  };
}

async function getPosPurchases(filters = {}) {
  return fetchPurchaseRows(filters);
}

async function createPosPurchaseBatch(payload = {}, createdBy = null) {
  const batchId = mobilePayloadValue(payload, "batchId", "batch_id", mobilePayloadValue(payload, "localId", "local_id", null));
  if (batchId) {
    const duplicate = await db("purchases").where({ batch_id: batchId }).first();
    if (duplicate) {
      const rows = await fetchPurchaseRows({ outletId: duplicate.outlet_id });
      return rows.find((row) => row.id === duplicate.id);
    }
  }

  const normalized = await normalizePurchasePayloadForDb(payload, {
    createdBy,
    source: "kasir_app"
  });
  const purchase = { id: createRuntimeId("purchase"), ...normalized.purchase };
  await db.transaction(async (trx) => {
    await trx("purchases").insert(purchase);
    await trx("purchase_items").insert(
      normalized.items.map((item) => ({
        id: createRuntimeId("purchase_item"),
        purchase_id: purchase.id,
        ...item
      }))
    );
  });
  await writeDbActivityLog({
    actor_user_id: purchase.created_by,
    outlet_id: purchase.outlet_id,
    source: "kasir_app",
    module: "purchase",
    action: "create_batch",
    entity_type: "purchase",
    entity_id: purchase.id,
    description: "Kasir input pembelian harga pokok produksi",
    metadata_json: {
      total: purchase.total,
      item_count: normalized.items.length,
      payment_type: purchase.payment_type
    }
  });
  const rows = await fetchPurchaseRows({ outletId: purchase.outlet_id });
  return rows.find((row) => row.id === purchase.id);
}

async function updatePosPurchaseBatch(purchaseId, payload = {}, updatedBy = null) {
  const existing = await db("purchases").where({ id: purchaseId }).first();
  if (!existing) throw new Error("Pembelian tidak ditemukan.");
  if ((existing.status || "pending") !== "pending") throw new Error("Pembelian sudah diproses admin dan tidak bisa diedit dari APK.");

  const normalized = await normalizePurchasePayloadForDb(payload, {
    createdBy: existing.created_by,
    source: existing.source || "kasir_app",
    existing
  });
  await db.transaction(async (trx) => {
    await trx("purchases")
      .where({ id: existing.id })
      .update({
        ...normalized.purchase,
        updated_by: updatedBy || mobilePayloadValue(payload, "updatedBy", "updated_by", null),
        updated_at: new Date()
      });
    await trx("purchase_items").where({ purchase_id: existing.id }).delete();
    await trx("purchase_items").insert(
      normalized.items.map((item) => ({
        id: createRuntimeId("purchase_item"),
        purchase_id: existing.id,
        ...item
      }))
    );
  });
  const updated = await db("purchases").where({ id: existing.id }).first();
  await writeDbActivityLog({
    actor_user_id: updated.updated_by,
    outlet_id: updated.outlet_id,
    source: "kasir_app",
    module: "purchase",
    action: "update",
    entity_type: "purchase",
    entity_id: updated.id,
    description: "Kasir edit pembelian harga pokok produksi",
    metadata_json: {
      total: updated.total,
      item_count: normalized.items.length,
      payment_type: updated.payment_type
    }
  });
  const rows = await fetchPurchaseRows({ outletId: updated.outlet_id });
  return rows.find((row) => row.id === updated.id);
}

async function getPurchaseWithItems(purchaseId, trx = db) {
  const purchase = await trx("purchases").where({ id: purchaseId }).first();
  if (!purchase) {
    const error = new Error("Pembelian tidak ditemukan.");
    error.status = 404;
    error.code = "PURCHASE_NOT_FOUND";
    throw error;
  }
  const items = await trx("purchase_items").where({ purchase_id: purchase.id });
  return { ...purchase, items };
}

async function applyApprovedPurchaseStockDb(trx, purchase, sign = 1) {
  const items = purchase.items || [];
  const materialIds = [...new Set(items.map((item) => item.material_id).filter(Boolean))];
  const materials = materialIds.length ? await trx("raw_materials").whereIn("id", materialIds) : [];
  const materialById = new Map(materials.map((material) => [material.id, material]));

  for (const item of items) {
    const material = materialById.get(item.material_id);
    if (!material) continue;
    const quantityDelta = roundQuantity(Number(item.quantity || 0) * sign);
    const stock = await trx("raw_material_stocks").where({ outlet_id: purchase.outlet_id, material_id: item.material_id }).first();
    const nextQuantity = roundQuantity(Number(stock?.quantity || 0) + quantityDelta);
    const unitPrice = sign > 0 ? Number(item.unit_price || 0) : Number(stock?.last_purchase_price || material.last_purchase_price || 0);
    const lastPurchaseDate = sign > 0 ? dateOnly(purchase.purchase_date) : stock?.last_purchase_date || material.last_purchase_date || null;

    if (stock) {
      await trx("raw_material_stocks")
        .where({ id: stock.id })
        .update({
          quantity: nextQuantity,
          unit: item.unit || material.unit,
          last_purchase_price: unitPrice,
          last_purchase_date: lastPurchaseDate,
          stock_value: Math.round(nextQuantity * Number(unitPrice || 0))
        });
    } else {
      await trx("raw_material_stocks").insert({
        id: createRuntimeId("stock"),
        outlet_id: purchase.outlet_id,
        material_id: item.material_id,
        quantity: nextQuantity,
        unit: item.unit || material.unit,
        last_purchase_price: unitPrice,
        last_purchase_date: lastPurchaseDate,
        stock_value: Math.round(nextQuantity * Number(unitPrice || 0))
      });
    }

    if (sign > 0) {
      const shouldUpdateMaterial = !material.last_purchase_date || String(dateOnly(purchase.purchase_date)) >= String(dateOnly(material.last_purchase_date));
      if (shouldUpdateMaterial) {
        await trx("raw_materials")
          .where({ id: item.material_id })
          .update({
            last_purchase_price: Number(item.unit_price || 0),
            last_purchase_date: dateOnly(purchase.purchase_date),
            last_purchase_outlet_id: purchase.outlet_id
          });
      }
    }
  }
}

async function refreshPurchasePriceSnapshotsDb(trx, materialIds = [], outletIds = []) {
  const cleanMaterialIds = [...new Set(materialIds.filter(Boolean))];
  const cleanOutletIds = [...new Set(outletIds.filter(Boolean))];
  for (const materialId of cleanMaterialIds) {
    const latest = await trx("purchase_items as pi").join("purchases as p", "p.id", "pi.purchase_id").where("pi.material_id", materialId).where("p.status", "approved").select("pi.unit_price", "p.purchase_date", "p.outlet_id").orderBy("p.purchase_date", "desc").orderBy("p.id", "desc").first();
    await trx("raw_materials")
      .where({ id: materialId })
      .update({
        last_purchase_price: Number(latest?.unit_price || 0),
        last_purchase_date: latest?.purchase_date || null,
        last_purchase_outlet_id: latest?.outlet_id || null
      });

    for (const outletId of cleanOutletIds) {
      const stock = await trx("raw_material_stocks").where({ material_id: materialId, outlet_id: outletId }).first();
      if (!stock) continue;
      const outletLatest = await trx("purchase_items as pi").join("purchases as p", "p.id", "pi.purchase_id").where("pi.material_id", materialId).where("p.outlet_id", outletId).where("p.status", "approved").select("pi.unit_price", "p.purchase_date").orderBy("p.purchase_date", "desc").orderBy("p.id", "desc").first();
      const unitPrice = Number(outletLatest?.unit_price || latest?.unit_price || 0);
      await trx("raw_material_stocks")
        .where({ id: stock.id })
        .update({
          last_purchase_price: unitPrice,
          last_purchase_date: outletLatest?.purchase_date || latest?.purchase_date || null,
          stock_value: Math.round(Number(stock.quantity || 0) * unitPrice)
        });
    }
  }
}

async function createPurchase(payload = {}) {
  const normalized = await normalizePurchasePayloadForDb(payload, {
    createdBy: payload.created_by || payload.createdBy || null,
    source: payload.source || "admin_web"
  });
  const status = ["pending", "approved", "rejected"].includes(payload.status) ? payload.status : "pending";
  const purchase = {
    id: createRuntimeId("purchase"),
    ...normalized.purchase,
    status
  };
  if (status === "approved") {
    purchase.approved_by = payload.approved_by || payload.approvedBy || payload.created_by || payload.createdBy || null;
    purchase.approved_at = new Date();
  }

  await db.transaction(async (trx) => {
    await trx("purchases").insert(purchase);
    await trx("purchase_items").insert(
      normalized.items.map((item) => ({
        id: createRuntimeId("purchase_item"),
        purchase_id: purchase.id,
        ...item
      }))
    );
    if (status === "approved") {
      await applyApprovedPurchaseStockDb(trx, { ...purchase, items: normalized.items }, 1);
      await refreshPurchasePriceSnapshotsDb(
        trx,
        normalized.items.map((item) => item.material_id),
        [purchase.outlet_id]
      );
    }
  });
  await writeDbActivityLog({
    actor_user_id: purchase.created_by,
    outlet_id: purchase.outlet_id,
    source: purchase.source || "admin_web",
    module: "purchase",
    action: "create_batch",
    entity_type: "purchase",
    entity_id: purchase.id,
    description: `Pembelian harga pokok produksi ${purchase.status}`,
    metadata_json: {
      total: purchase.total,
      item_count: normalized.items.length,
      payment_type: purchase.payment_type
    }
  });
  const rows = await fetchPurchaseRows({ outletId: purchase.outlet_id });
  return rows.find((row) => row.id === purchase.id);
}

async function updatePurchase(purchaseId, payload = {}) {
  const existing = await getPurchaseWithItems(purchaseId);
  const previousStatus = existing.status || "pending";
  const nextStatus = previousStatus === "rejected" ? "pending" : previousStatus;
  const normalized = await normalizePurchasePayloadForDb(
    {
      ...payload,
      outlet_id: payload.outlet_id || payload.outletId || existing.outlet_id,
      supplier_id: payload.supplier_id ?? payload.supplierId ?? existing.supplier_id,
      payment_type: payload.payment_type || payload.paymentType || existing.payment_type,
      purchase_date: payload.purchase_date || payload.purchaseDate || existing.purchase_date,
      batch_id: existing.batch_id || payload.batch_id || payload.batchId || null,
      note: payload.note ?? existing.note
    },
    {
      createdBy: existing.created_by,
      source: existing.source || payload.source || "admin_web"
    }
  );
  const affectedMaterialIds = [...new Set([...(existing.items || []).map((item) => item.material_id), ...normalized.items.map((item) => item.material_id)])];
  const affectedOutletIds = [...new Set([existing.outlet_id, normalized.purchase.outlet_id])];

  await db.transaction(async (trx) => {
    if (previousStatus === "approved") {
      await applyApprovedPurchaseStockDb(trx, existing, -1);
    }
    await trx("purchases")
      .where({ id: existing.id })
      .update({
        ...normalized.purchase,
        status: nextStatus,
        rejection_note: nextStatus === "pending" ? null : existing.rejection_note,
        rejected_by: nextStatus === "pending" ? null : existing.rejected_by,
        rejected_at: nextStatus === "pending" ? null : existing.rejected_at,
        approved_by: previousStatus === "approved" ? existing.approved_by : null,
        approved_at: previousStatus === "approved" ? existing.approved_at : null,
        updated_by: payload.updated_by || payload.updatedBy || null,
        updated_at: new Date()
      });
    await trx("purchase_items").where({ purchase_id: existing.id }).delete();
    await trx("purchase_items").insert(
      normalized.items.map((item) => ({
        id: createRuntimeId("purchase_item"),
        purchase_id: existing.id,
        ...item
      }))
    );
    if (previousStatus === "approved") {
      await applyApprovedPurchaseStockDb(trx, { ...normalized.purchase, id: existing.id, items: normalized.items }, 1);
    }
    await refreshPurchasePriceSnapshotsDb(trx, affectedMaterialIds, affectedOutletIds);
  });
  await writeDbActivityLog({
    actor_user_id: payload.updated_by || payload.updatedBy || null,
    outlet_id: normalized.purchase.outlet_id,
    source: payload.activity_source || "admin_web",
    module: "purchase",
    action: "update",
    entity_type: "purchase",
    entity_id: existing.id,
    description: "Admin edit pembelian harga pokok produksi",
    metadata_json: {
      previous_status: previousStatus,
      next_status: nextStatus,
      previous_total: existing.total,
      next_total: normalized.purchase.total,
      item_count: normalized.items.length
    }
  });
  const rows = await fetchPurchaseRows({
    outletId: normalized.purchase.outlet_id
  });
  return rows.find((row) => row.id === existing.id);
}

async function approvePurchase(purchaseId, payload = {}) {
  const purchase = await getPurchaseWithItems(purchaseId);
  if ((purchase.status || "pending") !== "pending") throw new Error("Hanya pembelian pending yang bisa di-approve.");
  const approvedBy = payload.approved_by || payload.approvedBy || null;
  await db.transaction(async (trx) => {
    await trx("purchases").where({ id: purchase.id }).update({
      status: "approved",
      approved_by: approvedBy,
      approved_at: new Date(),
      rejected_by: null,
      rejected_at: null,
      rejection_note: null
    });
    await applyApprovedPurchaseStockDb(trx, purchase, 1);
    await refreshPurchasePriceSnapshotsDb(
      trx,
      purchase.items.map((item) => item.material_id),
      [purchase.outlet_id]
    );
  });
  await writeDbActivityLog({
    actor_user_id: approvedBy,
    outlet_id: purchase.outlet_id,
    source: "admin_web",
    module: "purchase",
    action: "approve",
    entity_type: "purchase",
    entity_id: purchase.id,
    description: "Admin approve pembelian harga pokok produksi",
    metadata_json: { total: purchase.total, item_count: purchase.items.length }
  });
  const rows = await fetchPurchaseRows({ outletId: purchase.outlet_id });
  return rows.find((row) => row.id === purchase.id);
}

async function rejectPurchase(purchaseId, payload = {}) {
  const purchase = await getPurchaseWithItems(purchaseId);
  if ((purchase.status || "pending") !== "pending") throw new Error("Hanya pembelian pending yang bisa di-reject.");
  const rejectionNote = String(payload.rejection_note || payload.rejectionNote || payload.reason || "").trim();
  if (!rejectionNote) throw new Error("Alasan reject pembelian wajib diisi.");
  const rejectedBy = payload.rejected_by || payload.rejectedBy || payload.approved_by || payload.approvedBy || null;
  await db("purchases").where({ id: purchase.id }).update({
    status: "rejected",
    rejection_note: rejectionNote,
    rejected_by: rejectedBy,
    rejected_at: new Date(),
    approved_by: null,
    approved_at: null
  });
  await writeDbActivityLog({
    actor_user_id: rejectedBy,
    outlet_id: purchase.outlet_id,
    source: "admin_web",
    module: "purchase",
    action: "reject",
    entity_type: "purchase",
    entity_id: purchase.id,
    description: "Admin reject pembelian harga pokok produksi",
    metadata_json: { total: purchase.total, reason: rejectionNote }
  });
  const rows = await fetchPurchaseRows({ outletId: purchase.outlet_id });
  return rows.find((row) => row.id === purchase.id);
}

async function createPosDiscount(payload = {}, createdBy = null) {
  const outletId = String(payload.outlet_id || payload.outletId || "").trim();
  const pinResult = await verifyReportPin(payload.report_pin || payload.reportPin || "", createdBy);
  if (!pinResult.valid) {
    throw new Error("PIN laporan tidak valid.");
  }
  const discountPayload = normalizeDbDiscountPayload({
    ...payload,
    outlet_ids: [outletId]
  });
  await assertDbDiscountPayload(discountPayload);

  const discount = {
    id: createRuntimeId("discount"),
    name: discountPayload.name,
    type: discountPayload.type,
    value: discountPayload.value,
    starts_at: discountPayload.starts_at,
    ends_at: discountPayload.ends_at,
    status: discountPayload.status
  };
  await db.transaction(async (trx) => {
    await trx("discounts").insert(discount);
    await trx("discount_outlets").insert(
      discountPayload.outlet_ids.map((id) => ({
        discount_id: discount.id,
        outlet_id: id
      }))
    );
  });
  await writeDbActivityLog({
    actor_user_id: createdBy,
    outlet_id: outletId,
    source: "kasir_app",
    module: "discount",
    action: "create_from_kasir",
    entity_type: "discount",
    entity_id: discount.id,
    description: `Kasir membuat discount ${discount.name}.`,
    metadata_json: {
      outlet_id: outletId,
      type: discount.type,
      value: discount.value,
      status: discount.status
    }
  });
  return (await getDbDiscountRows({ outletId })).find((item) => item.id === discount.id);
}

async function updatePosDiscount(discountId, payload = {}, updatedBy = null) {
  const outletId = String(payload.outlet_id || payload.outletId || "").trim();
  const pinResult = await verifyReportPin(payload.report_pin || payload.reportPin || "", updatedBy);
  if (!pinResult.valid) {
    throw new Error("PIN laporan tidak valid.");
  }
  const existing = await db("discounts").where({ id: discountId }).first();
  if (!existing) {
    throw new Error("Discount tidak ditemukan.");
  }
  const linked = await db("discount_outlets").where({ discount_id: discountId, outlet_id: outletId }).first();
  if (!linked) {
    throw new Error("Discount ini tidak tersedia untuk outlet aktif.");
  }
  const discountPayload = normalizeDbDiscountPayload({ ...payload, outlet_ids: [outletId] }, discountId);
  await assertDbDiscountPayload(discountPayload);

  await db.transaction(async (trx) => {
    await trx("discounts").where({ id: discountId }).update({
      name: discountPayload.name,
      type: discountPayload.type,
      value: discountPayload.value,
      starts_at: discountPayload.starts_at,
      ends_at: discountPayload.ends_at,
      status: discountPayload.status
    });
    await trx("discount_outlets").where({ discount_id: discountId }).delete();
    await trx("discount_outlets").insert(
      discountPayload.outlet_ids.map((id) => ({
        discount_id: discountId,
        outlet_id: id
      }))
    );
  });
  await writeDbActivityLog({
    actor_user_id: updatedBy,
    outlet_id: outletId,
    source: "kasir_app",
    module: "discount",
    action: "update_from_kasir",
    entity_type: "discount",
    entity_id: discountId,
    description: `Kasir memperbarui discount ${discountPayload.name}.`,
    metadata_json: {
      outlet_id: outletId,
      previous: {
        name: existing.name,
        type: existing.type,
        value: Number(existing.value || 0),
        starts_at: dateOnly(existing.starts_at),
        ends_at: dateOnly(existing.ends_at),
        status: existing.status
      },
      next: {
        name: discountPayload.name,
        type: discountPayload.type,
        value: discountPayload.value,
        starts_at: discountPayload.starts_at,
        ends_at: discountPayload.ends_at,
        status: discountPayload.status
      }
    }
  });
  return (await getDbDiscountRows({ outletId })).find((item) => item.id === discountId);
}

async function updateLastLogin(userId) {
  if (env.dataMode === "mock") {
    const user = adminMockApi.getStaticData().users.find((item) => item.id === userId);
    if (user) user.last_login_at = new Date().toISOString();
    return;
  }
  await db("users").where({ id: userId }).update({ last_login_at: new Date() });
}

async function getBootstrap() {
  const [metadata, outlets, tables, roles, users, userOutlets, permissions] = await Promise.all([db("metadata").where({ key: "metadata" }).first(), db("outlets").orderBy("name"), db("dining_tables").orderBy(["outlet_id", "number"]), db("roles").orderBy("name"), db("users").orderBy("name"), db("user_outlets"), db("permissions").orderBy(["group", "key"])]);

  const outletIdsByUser = userOutlets.reduce((result, row) => {
    result[row.user_id] = result[row.user_id] || [];
    result[row.user_id].push(row.outlet_id);
    return result;
  }, {});
  const roleMap = new Map(roles.map((role) => [role.id, normalizeRole(role)]));

  return {
    outlets,
    tables,
    roles: roles.map(normalizeRole),
    users: users.map((user) => {
      const { password_hash: _passwordHash, pin_hash: _pinHash, ...safeUser } = user;
      const userOutletIds = outletIdsByUser[user.id] || [];
      return {
        ...safeUser,
        outlet_ids: userOutletIds,
        outlets: outlets.filter((outlet) => userOutletIds.includes(outlet.id)),
        has_pin: Boolean(user.pin_hash),
        role: roleMap.get(user.role_id)
      };
    }),
    permissions: permissions.map(normalizePermission),
    metadata: parseJson(metadata?.value, {})
  };
}

async function mockGetBootstrap() {
  const roleMap = new Map(mockData.roles.map((role) => [role.id, normalizeRole(role)]));

  return {
    outlets: mockData.outlets,
    tables: mockData.tables || [],
    roles: mockData.roles.map(normalizeRole),
    users: mockData.users.map((user) => {
      const { cashier_pin: _cashierPin, pin_hash: _pinHash, ...safeUser } = user;
      return {
        ...safeUser,
        outlet_ids: user.outlet_ids || [],
        has_pin: Boolean(user.cashier_pin || (user.role_id === "role_cashier" ? "000000" : "")),
        role: roleMap.get(user.role_id)
      };
    }),
    permissions: mockData.permissions.map(normalizePermission),
    metadata: mockData.metadata || {}
  };
}

async function getSettings() {
  const [roles, permissions, printSettings, printTemplates, appSecurity] = await Promise.all([db("roles").orderBy("name"), db("permissions").orderBy(["group", "key"]), db("print_settings").where({ id: "default" }).first(), db("print_templates").orderBy("key"), getDbAppSecurityRaw()]);

  return {
    roles: roles.map(normalizeRole),
    permissions: permissions.map(normalizePermission),
    print_settings: {
      printer_name: printSettings?.printer_name || "Printer Kasir Utama",
      printer_status: printSettings?.printer_status || "active",
      mode: printSettings?.mode || "single_printer",
      templates: printTemplates.map((template) => ({
        ...template,
        enabled: Boolean(template.enabled)
      }))
    },
    app_security: sanitizeAppSecurity(appSecurity)
  };
}

async function mockGetSettings() {
  const templates = mockData.print_templates || [];

  return {
    roles: mockData.roles.map(normalizeRole),
    permissions: mockData.permissions.map(normalizePermission),
    print_settings: {
      printer_name: mockData.print_settings?.printer_name || "Printer Kasir Utama",
      printer_status: mockData.print_settings?.printer_status || "active",
      mode: mockData.print_settings?.mode || "single_printer",
      templates: templates.map((template) => ({
        ...template,
        enabled: Boolean(template.enabled)
      }))
    },
    app_security: sanitizeAppSecurity(mockData.app_security || { report_pin: "000000" })
  };
}

function normalizeDbPrintFooterText(templateKey, value) {
  if (templateKey === "kitchen_order") return "";
  const text = String(value || "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (text.length > 300) {
    const error = new Error("Footer struk maksimal 300 karakter.");
    error.status = 422;
    error.code = "PRINT_FOOTER_TOO_LONG";
    throw error;
  }
  return text;
}

function normalizeDbPrintSettingsPayload(payload = {}, currentSettings = {}, currentTemplates = []) {
  const currentTemplateMap = new Map((currentTemplates || []).map((template) => [template.key, template]));
  const submittedTemplateMap = new Map((payload.templates || []).map((template) => [template.key, template]));
  const templateLabels = {
    customer_order: "Customer Order Copy",
    kitchen_order: "Kitchen Order",
    bill_receipt: "Bill / Receipt"
  };

  const printerName = String(payload.printer_name || currentSettings?.printer_name || "").trim();
  if (!printerName) {
    const error = new Error("Nama printer wajib diisi.");
    error.status = 422;
    error.code = "PRINT_NAME_REQUIRED";
    throw error;
  }

  const printerStatus = payload.printer_status === "inactive" ? "inactive" : "active";
  const mode = String(payload.mode || currentSettings?.mode || "single_printer").trim() || "single_printer";

  return {
    settings: {
      id: "default",
      printer_name: printerName,
      printer_status: printerStatus,
      mode
    },
    templates: Object.keys(templateLabels).map((key) => {
      const submitted = submittedTemplateMap.get(key) || {};
      const current = currentTemplateMap.get(key) || {};
      return {
        key,
        label: submitted.label || current.label || templateLabels[key],
        enabled: submitted.enabled !== undefined ? submitted.enabled !== false : current.enabled !== false,
        footer_text: normalizeDbPrintFooterText(key, submitted.footer_text !== undefined ? submitted.footer_text : current.footer_text)
      };
    })
  };
}

async function updatePrintSettings(payload = {}, actorUserId = null) {
  const [currentSettings, currentTemplates] = await Promise.all([db("print_settings").where({ id: "default" }).first(), db("print_templates")]);
  const next = normalizeDbPrintSettingsPayload(payload, currentSettings, currentTemplates);

  await db.transaction(async (trx) => {
    const settingsExists = await trx("print_settings").where({ id: "default" }).first();
    if (settingsExists) {
      await trx("print_settings").where({ id: "default" }).update(next.settings);
    } else {
      await trx("print_settings").insert(next.settings);
    }

    for (const template of next.templates) {
      const templateExists = await trx("print_templates").where({ key: template.key }).first();
      if (templateExists) {
        await trx("print_templates").where({ key: template.key }).update(template);
      } else {
        await trx("print_templates").insert(template);
      }
    }
  });

  await writeDbActivityLog({
    actor_user_id: actorUserId,
    source: "admin_web",
    module: "settings",
    action: "print/update",
    entity_type: "print_settings",
    entity_id: "print",
    description: "Admin update pengaturan print.",
    metadata_json: {
      printer_name: next.settings.printer_name,
      printer_status: next.settings.printer_status,
      template_count: next.templates.length
    }
  });

  return (await getSettings()).print_settings;
}

async function getMobileCatalog() {
  const [outlets, users, categories, products, productPrices, customers, tables, expenseCategories, materialCategories, rawMaterials, suppliers, paymentMethods, discounts, discountOutlets, productVariants, settings] = await Promise.all([
    db("outlets").where({ status: "active" }).orderBy("name"),
    db("users").where({ status: "active" }).orderBy("name"),
    db("categories").where({ status: "active" }).orderBy("sort_order"),
    db("products").where({ status: "active" }).orderBy("name"),
    db("product_prices").where({ status: "active" }),
    db("customers").where({ status: "active" }).orderBy("name"),
    db("dining_tables").where({ status: "active" }).orderBy(["outlet_id", "number"]),
    db("expense_categories").where({ status: "active" }).orderBy("sort_order"),
    db("raw_material_categories").where({ status: "active" }).orderBy("sort_order"),
    db("raw_materials").where({ status: "active" }).orderBy("name"),
    db("suppliers").where({ status: "active" }).orderBy("name"),
    db("payment_methods").where({ status: "active" }).orderBy("sort_order"),
    db("discounts").where({ status: "active" }).orderBy("starts_at"),
    db("discount_outlets"),
    db("product_variants")
      .where({ status: "active" })
      .orderBy("sort_order")
      .catch(() => []),
    getSettings()
  ]);

  const activeOutletIds = new Set(outlets.map((outlet) => outlet.id));
  const mobileRoleMap = new Map((settings.roles || []).map((role) => [role.id, role]));
  const mobileUsers = users.filter((user) => Boolean(user.pin_hash) && hasApkAccess(mobileRoleMap.get(user.role_id)));
  const activeCategoryIds = new Set(categories.map((category) => category.id));
  const activePriceRows = productPrices.filter((price) => activeOutletIds.has(price.outlet_id) && Number(price.price || 0) > 0);
  const productIdsWithActivePrice = new Set(activePriceRows.map((price) => price.product_id));
  const activeProducts = products.filter((product) => activeCategoryIds.has(product.category_id) && productIdsWithActivePrice.has(product.id));
  const activeProductIds = new Set(activeProducts.map((product) => product.id));
  const materialCategoryById = new Map(materialCategories.map((category) => [category.id, category]));
  const normalizedRawMaterials = rawMaterials.map((material) => {
    const category = materialCategoryById.get(material.category_id);

    return {
      ...material,
      type: material.type || category?.type || "hpp",
      account_code: category?.account_code || material.account_code
    };
  });
  const userOutletRows = await db("user_outlets").whereIn(
    "user_id",
    mobileUsers.map((user) => user.id)
  );
  const outletIdsByUser = userOutletRows.reduce((result, row) => {
    result[row.user_id] = result[row.user_id] || [];
    result[row.user_id].push(row.outlet_id);
    return result;
  }, {});

  return {
    schema_version: "admin-mobile-catalog-v1",
    generated_at: new Date().toISOString(),
    source: "pos-backend-barokah",
    outlets,
    transfer_outlets: outlets,
    cashiers: mobileUsers
      .map((user) => ({
        id: user.id,
        name: user.name,
        username: user.username,
        password: "",
        has_pin: Boolean(user.pin_hash),
        role_id: user.role_id,
        role_name: mobileRoleMap.get(user.role_id)?.name || "",
        permissions: mobileRoleMap.get(user.role_id)?.permissions || {},
        outlet_ids: (outletIdsByUser[user.id] || []).filter((outletId) => activeOutletIds.has(outletId)),
        status: user.status
      }))
      .filter((user) => user.outlet_ids.length),
    categories,
    products: activeProducts.map((product) => ({
      ...product,
      variants: productVariants
        .filter((variant) => variant.product_id === product.id)
        .map((variant) => ({
          id: variant.id,
          product_id: variant.product_id,
          name: variant.name,
          status: variant.status,
          sort_order: Number(variant.sort_order || 0)
        }))
    })),
    product_prices: activePriceRows.filter((price) => activeProductIds.has(price.product_id)),
    customers: customers
      .filter((customer) => activeOutletIds.has(customer.outlet_id))
      .map((customer) => ({
        ...customer,
        points: Number(customer.points || 0)
      })),
    tables: tables.filter((table) => activeOutletIds.has(table.outlet_id)),
    expense_categories: expenseCategories,
    raw_material_categories: materialCategories,
    raw_materials: normalizedRawMaterials,
    suppliers,
    payment_methods: paymentMethods,
    discounts: attachDiscountOutlets(discounts, discountOutlets)
      .filter((discount) => isDiscountActiveForDate(discount))
      .filter((discount) => discount.outlet_ids.some((outletId) => activeOutletIds.has(outletId)))
      .map((discount) => ({
        ...discount,
        outlet_ids: discount.outlet_ids.filter((outletId) => activeOutletIds.has(outletId))
      })),
    print_templates: settings.print_settings.templates,
    print_settings: {
      printer_name: settings.print_settings.printer_name,
      printer_status: settings.print_settings.printer_status,
      mode: settings.print_settings.mode
    },
    app_security: settings.app_security
  };
}

async function mockGetMobileCatalog() {
  const outlets = mockData.outlets.filter((outlet) => outlet.status === "active");
  const activeOutletIds = new Set(outlets.map((outlet) => outlet.id));
  const categories = mockData.categories.filter((category) => category.status === "active").sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  const activeCategoryIds = new Set(categories.map((category) => category.id));
  const activePriceRows = mockData.product_prices.filter((price) => price.status === "active" && activeOutletIds.has(price.outlet_id) && Number(price.price || 0) > 0);
  const productIdsWithActivePrice = new Set(activePriceRows.map((price) => price.product_id));
  const products = mockData.products.filter((product) => product.status === "active" && activeCategoryIds.has(product.category_id) && productIdsWithActivePrice.has(product.id)).sort((a, b) => a.name.localeCompare(b.name));
  const activeProductIds = new Set(products.map((product) => product.id));
  const settings = await mockGetSettings();
  const mobileRoleMap = new Map((settings.roles || []).map((role) => [role.id, role]));

  return {
    schema_version: "admin-mobile-catalog-v1",
    generated_at: new Date().toISOString(),
    source: "pos-backend-barokah",
    data_mode: "mock",
    outlets,
    transfer_outlets: outlets,
    cashiers: mockData.users
      .filter((user) => user.status === "active" && Boolean(user.cashier_pin || (user.role_id === "role_cashier" ? "000000" : "")) && hasApkAccess(mobileRoleMap.get(user.role_id)))
      .map((user) => ({
        id: user.id,
        name: user.name,
        username: user.username,
        password: "",
        has_pin: Boolean(user.cashier_pin || "000000"),
        role_id: user.role_id,
        role_name: mobileRoleMap.get(user.role_id)?.name || "",
        permissions: mobileRoleMap.get(user.role_id)?.permissions || {},
        outlet_ids: (user.outlet_ids || []).filter((outletId) => activeOutletIds.has(outletId)),
        status: user.status
      }))
      .filter((user) => user.outlet_ids.length),
    categories,
    products: products.map((product) => ({
      ...product,
      variants: (mockData.product_variants || [])
        .filter((variant) => variant.product_id === product.id && variant.status === "active")
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.name).localeCompare(String(b.name), "id-ID"))
        .map((variant) => ({
          id: variant.id,
          product_id: variant.product_id,
          name: variant.name,
          status: variant.status,
          sort_order: Number(variant.sort_order || 0)
        }))
    })),
    product_prices: activePriceRows.filter((price) => activeProductIds.has(price.product_id)),
    customers: mockData.customers.filter((customer) => customer.status === "active" && activeOutletIds.has(customer.outlet_id)),
    tables: (mockData.tables || []).filter((table) => table.status === "active" && activeOutletIds.has(table.outlet_id)),
    expense_categories: (mockData.expense_categories || []).filter((category) => category.status === "active").sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
    raw_material_categories: (mockData.raw_material_categories || []).filter((category) => category.status === "active").sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
    payment_methods: (mockData.payment_methods || []).filter((method) => method.status === "active").sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
    discounts: attachDiscountOutlets(mockData.discounts || [], mockData.discount_outlets || [])
      .filter((discount) => isDiscountActiveForDate(discount))
      .filter((discount) => discount.outlet_ids.some((outletId) => activeOutletIds.has(outletId)))
      .map((discount) => ({
        ...discount,
        outlet_ids: discount.outlet_ids.filter((outletId) => activeOutletIds.has(outletId))
      }))
      .sort((a, b) => String(a.starts_at || "").localeCompare(String(b.starts_at || "")) || a.name.localeCompare(b.name)),
    print_templates: settings.print_settings.templates,
    print_settings: {
      printer_name: settings.print_settings.printer_name,
      printer_status: settings.print_settings.printer_status,
      mode: settings.print_settings.mode
    },
    app_security: settings.app_security
  };
}

async function getMasterData({ outletId = "all" } = {}) {
  const [outlets, users, roles, customers, categories, products, productPrices, productVariants, materials, compositions, suppliers, tables, expenseCategories, materialCategories, rawMaterialStocks, units, paymentMethods, discounts, discountOutlets, financialAccounts, financeEntries, financeGroups, userOutlets, expenses, supplierPurchases] = await Promise.all([
    db("outlets"),
    db("users"),
    db("roles"),
    db("customers"),
    db("categories"),
    db("products"),
    db("product_prices"),
    db("product_variants").orderBy("sort_order"),
    db("raw_materials"),
    db("product_compositions"),
    db("suppliers"),
    db("dining_tables"),
    db("expense_categories"),
    db("raw_material_categories"),
    db("raw_material_stocks"),
    db("units").orderBy("sort_order").orderBy("name"),
    db("payment_methods"),
    db("discounts"),
    db("discount_outlets"),
    db("financial_accounts").orderBy("sort_order"),
    db("balance_sheet_entries").orderBy("entry_date", "desc"),
    db("finance_entry_groups").orderBy("created_at", "desc"),
    db("user_outlets"),
    db("expenses")
      .modify((query) => {
        if (outletId && outletId !== "all") query.where("outlet_id", outletId);
      })
      .orderBy("expense_date", "desc")
      .orderBy("id", "desc"),
    fetchPurchaseRows({ outletId })
  ]);
  const outletById = new Map(outlets.map((outlet) => [outlet.id, outlet]));
  const normalizedRoles = roles.map(normalizeRole);
  const roleByIdMap = new Map(normalizedRoles.map((role) => [role.id, role]));
  const userOutletIdsByUserId = userOutlets.reduce((result, item) => {
    const current = result.get(item.user_id) || [];
    current.push(item.outlet_id);
    result.set(item.user_id, current);
    return result;
  }, new Map());
  const userRows = users.map((user) => {
    const outletIds = userOutletIdsByUserId.get(user.id) || [];
    const outletRows = outletIds.map((id) => outletById.get(id)).filter(Boolean);
    return {
      ...sanitizeUserForAdmin(user, outletIds),
      role: roleByIdMap.get(user.role_id) || null,
      outlets: outletRows
    };
  });
  const accountByCode = new Map(financialAccounts.map((account) => [account.code, account]));
  const userById = new Map(users.map((user) => [user.id, user]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const expensesByCategoryName = expenses.reduce((result, expense) => {
    const key = String(expense.category || "")
      .trim()
      .toLowerCase();
    if (!key) return result;
    const current = result.get(key) || [];
    const inputUser = expense.created_by ? userById.get(expense.created_by) : null;
    current.push({
      ...expense,
      outlet: expense.outlet_id ? outletById.get(expense.outlet_id) || null : null,
      created_by_user: inputUser
        ? {
            id: inputUser.id,
            name: inputUser.name,
            username: inputUser.username
          }
        : null
    });
    result.set(key, current);
    return result;
  }, new Map());
  const expenseCategoryRows = expenseCategories.map((category) => {
    const categoryExpenses =
      expensesByCategoryName.get(
        String(category.name || "")
          .trim()
          .toLowerCase()
      ) || [];
    return {
      ...category,
      account: category.account_code ? accountByCode.get(category.account_code) || null : null,
      expenses: categoryExpenses,
      expense_count: categoryExpenses.length,
      expense_total: categoryExpenses.reduce((total, expense) => total + Number(expense.amount || 0), 0)
    };
  });
  const materialCategoryRows = materialCategories.map((category) => {
    const categoryMaterials = materials.filter((material) => material.category_id === category.id).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "id-ID"));
    return {
      ...category,
      account: category.account_code ? accountByCode.get(category.account_code) || null : null,
      materials: categoryMaterials,
      material_count: categoryMaterials.length,
      material_type_label: getMaterialTypeLabel(category.type)
    };
  });
  const paymentMethodRows = paymentMethods.map((method) => ({
    ...method,
    account: method.account_code ? accountByCode.get(method.account_code) || null : null
  }));
  const materialCategoryById = new Map(materialCategoryRows.map((category) => [category.id, category]));
  const rawMaterialById = new Map(materials.map((material) => [material.id, material]));
  const productPricesByProductId = productPrices.reduce((result, price) => {
    const current = result.get(price.product_id) || [];
    current.push({
      ...price,
      outlet: price.outlet_id ? outletById.get(price.outlet_id) || null : null
    });
    result.set(price.product_id, current);
    return result;
  }, new Map());
  const compositionsByProductId = compositions.reduce((result, composition) => {
    const material = rawMaterialById.get(composition.material_id);
    const current = result.get(composition.product_id) || [];
    current.push({
      ...composition,
      quantity: Number(composition.quantity || 0),
      material: material
        ? {
            ...material,
            category: materialCategoryById.get(material.category_id) || null
          }
        : null
    });
    result.set(composition.product_id, current);
    return result;
  }, new Map());
  const variantsByProductId = productVariants.reduce((result, variant) => {
    const current = result.get(variant.product_id) || [];
    current.push(variant);
    result.set(variant.product_id, current);
    return result;
  }, new Map());
  const productRows = products.map((product) => {
    const prices = productPricesByProductId.get(product.id) || [];
    const composition = compositionsByProductId.get(product.id) || [];
    const variants = variantsByProductId.get(product.id) || [];
    const category = product.category_id ? categoryById.get(product.category_id) || null : null;
    return {
      ...product,
      category,
      all_prices: prices,
      prices: outletId === "all" ? prices : prices.filter((price) => price.outlet_id === outletId),
      price_count: prices.filter((price) => price.status !== "inactive" && Number(price.price || 0) > 0).length,
      composition,
      composition_count: composition.length,
      variants,
      variant_count: variants.filter((variant) => variant.status === "active").length
    };
  });
  const categoryRows = categories.map((category) => ({
    ...category,
    product_count: products.filter((product) => product.category_id === category.id).length
  }));
  const productById = new Map(productRows.map((product) => [product.id, product]));
  const compositionRows = compositions.map((composition) => {
    const material = rawMaterialById.get(composition.material_id);
    return {
      ...composition,
      quantity: Number(composition.quantity || 0),
      product: productById.get(composition.product_id) || null,
      material: material
        ? {
            ...material,
            category: materialCategoryById.get(material.category_id) || null
          }
        : null
    };
  });
  const reserveFundRows = financeEntries
    .filter((entry) => {
      const account = accountByCode.get(entry.account_code);
      return account && (String(account.code) === "1431" || /dana cadangan/i.test(String(account.name || "")));
    })
    .filter((entry) => outletId === "all" || entry.outlet_id === outletId)
    .map((entry) => ({
      ...entry,
      group: accountByCode.get(entry.account_code)?.report_group || entry.group,
      movement_type: entry.movement_type || "in",
      account: accountByCode.get(entry.account_code) || null,
      outlet: entry.outlet_id ? outlets.find((outlet) => outlet.id === entry.outlet_id) || null : null
    }));
  const reserveSummaryOutletIds = outletId === "all" ? outlets.map((outlet) => outlet.id) : [outletId];
  const reserveFundSummary = reserveSummaryOutletIds
    .filter((id) => outletById.has(id))
    .map((id) => {
      const rows = reserveFundRows.filter((entry) => entry.outlet_id === id && entry.status !== "inactive");
      const totalIn = rows.filter((entry) => (entry.movement_type || "in") === "in").reduce((total, entry) => total + Number(entry.amount || 0), 0);
      const totalOut = rows.filter((entry) => entry.movement_type === "out").reduce((total, entry) => total + Number(entry.amount || 0), 0);
      return {
        outlet_id: id,
        outlet: outletById.get(id),
        total_in: totalIn,
        total_out: totalOut,
        balance: totalIn - totalOut,
        mutation_count: rows.length
      };
    });
  const financeEntryRows = financeEntries.map((entry) => ({
    ...entry,
    group: accountByCode.get(entry.account_code)?.report_group || entry.group,
    movement_type: entry.movement_type || "in",
    account: accountByCode.get(entry.account_code) || null,
    outlet: entry.outlet_id ? outlets.find((outlet) => outlet.id === entry.outlet_id) || null : null
  }));
  const financeEntryGroupMap = new Map();
  financeGroups.forEach((group) => {
    const account = accountByCode.get(group.account_code) || null;
    const groupId = group.id;
    financeEntryGroupMap.set(groupId, {
      ...group,
      group: account?.report_group || group.group,
      account,
      outlet: group.outlet_id ? outletById.get(group.outlet_id) || null : null,
      total_in: 0,
      total_out: 0,
      balance: 0,
      transaction_count: 0,
      active_transaction_count: 0,
      last_transaction: null,
      transactions: []
    });
  });
  financeEntryRows.forEach((entry) => {
    const groupId =
      entry.finance_group_id ||
      `${String(entry.name || "")
        .trim()
        .toLowerCase()}::${entry.account_code || ""}::${entry.outlet_id || "global"}`;
    const existing = financeEntryGroupMap.get(groupId) || {
      id: entry.finance_group_id || groupId,
      name: entry.name,
      account_code: entry.account_code,
      group: entry.group,
      outlet_id: entry.outlet_id || null,
      note: "",
      status: "active",
      account: entry.account,
      outlet: entry.outlet,
      total_in: 0,
      total_out: 0,
      balance: 0,
      transaction_count: 0,
      active_transaction_count: 0,
      last_transaction: null,
      transactions: []
    };
    existing.transactions.push(entry);
    existing.transaction_count += 1;
    if (entry.status !== "inactive") {
      existing.active_transaction_count += 1;
      if ((entry.movement_type || "in") === "out") {
        existing.total_out += Number(entry.amount || 0);
      } else {
        existing.total_in += Number(entry.amount || 0);
      }
    }
    existing.balance = existing.total_in - existing.total_out;
    if (!existing.last_transaction || String(entry.entry_date || "") > String(existing.last_transaction.entry_date || "")) {
      existing.last_transaction = entry;
    }
    financeEntryGroupMap.set(groupId, existing);
  });
  const financeEntryGroupRows = [...financeEntryGroupMap.values()].filter((group) => outletId === "all" || !group.outlet_id || group.outlet_id === outletId);
  const materialRows = materials.map((material) => {
    const stocks = rawMaterialStocks
      .filter((stock) => stock.material_id === material.id)
      .filter((stock) => outletId === "all" || stock.outlet_id === outletId)
      .map((stock) => ({
        ...stock,
        outlet: outletById.get(stock.outlet_id)
      }));
    const category = materialCategoryById.get(material.category_id);
    return {
      ...material,
      category,
      type: material.type || category?.type || "hpp",
      account_code: category?.account_code || material.account_code || "5002",
      account: accountByCode.get(category?.account_code || material.account_code || "5002") || null,
      stocks,
      total_stock: stocks.reduce((total, stock) => total + Number(stock.quantity || 0), 0),
      stock_value: stocks.reduce((total, stock) => total + Number(stock.stock_value || 0), 0),
      outlet_count: stocks.length
    };
  });
  const supplierRows = suppliers.map((supplier) => summarizeSupplierPurchases(supplier, supplierPurchases));

  return {
    outlets,
    users: userRows,
    roles: normalizedRoles,
    customers,
    categories: categoryRows,
    products: productRows,
    product_prices: productPrices,
    raw_materials: materialRows,
    materials: materialRows,
    product_compositions: compositionRows,
    units: units.map((unit) => ({
      ...unit,
      material_count: materials.filter((material) => material.unit === unit.code).length
    })),
    suppliers: supplierRows,
    tables,
    expense_categories: expenseCategoryRows,
    raw_material_categories: materialCategoryRows,
    payment_methods: paymentMethodRows,
    financial_accounts: financialAccounts,
    finance_entry_groups: financeEntryGroupRows,
    finance_entries: financeEntryRows,
    reserve_funds: reserveFundRows,
    reserve_fund_summary: reserveFundSummary,
    discounts: attachDiscountOutlets(discounts, discountOutlets)
  };
}

async function requireProductCategory(categoryId) {
  const category = await db("categories").where({ id: categoryId }).first();
  if (!category) {
    const error = new Error("Kategori produk tidak ditemukan.");
    error.status = 404;
    error.code = "CATEGORY_NOT_FOUND";
    throw error;
  }
  return category;
}

function normalizeCategoryPayload(payload = {}) {
  const name = String(payload.name || payload.category || "").trim();
  if (!name) {
    const error = new Error("Nama kategori wajib diisi.");
    error.status = 422;
    error.code = "CATEGORY_NAME_REQUIRED";
    throw error;
  }
  return {
    name,
    sort_order: Number(payload.sort_order ?? payload.sortOrder ?? 0) || 0,
    status: payload.status === "inactive" ? "inactive" : "active",
    account_code: payload.account_code || payload.accountCode || null
  };
}

async function categoryWithProductCount(categoryId) {
  const category = await requireProductCategory(categoryId);
  const products = await db("products").where({ category_id: categoryId }).select("id", "name", "sku", "category_id", "status").orderBy("name", "asc");
  return {
    ...category,
    products,
    product_count: products.length
  };
}

async function createCategory(payload = {}) {
  const row = normalizeCategoryPayload(payload);
  const duplicate = await db("categories").whereRaw("LOWER(name) = LOWER(?)", [row.name]).first();
  if (duplicate) {
    const error = new Error("Nama kategori sudah digunakan.");
    error.status = 422;
    error.code = "CATEGORY_NAME_DUPLICATE";
    throw error;
  }
  const id = payload.id || createRuntimeId("category");
  await db("categories").insert({ id, ...row });
  await writeDbActivityLog({
    actor_user_id: payload.created_by || payload.createdBy || null,
    source: "admin_web",
    module: "master_data",
    action: "category/create",
    entity_type: "category",
    entity_id: id,
    description: `Kategori produk ${row.name} dibuat.`,
    metadata_json: { name: row.name, status: row.status }
  });
  return categoryWithProductCount(id);
}

async function getCategoryDetail(id) {
  return categoryWithProductCount(id);
}

async function updateCategory(id, payload = {}) {
  await requireProductCategory(id);
  const row = normalizeCategoryPayload(payload);
  const duplicate = await db("categories").whereRaw("LOWER(name) = LOWER(?)", [row.name]).whereNot({ id }).first();
  if (duplicate) {
    const error = new Error("Nama kategori sudah digunakan.");
    error.status = 422;
    error.code = "CATEGORY_NAME_DUPLICATE";
    throw error;
  }
  await db("categories").where({ id }).update(row);
  await writeDbActivityLog({
    actor_user_id: payload.updated_by || payload.updatedBy || null,
    source: "admin_web",
    module: "master_data",
    action: "category/update",
    entity_type: "category",
    entity_id: id,
    description: `Kategori produk ${row.name} diperbarui.`,
    metadata_json: { name: row.name, status: row.status }
  });
  return categoryWithProductCount(id);
}

async function toggleCategoryStatus(id, actorUserId = null) {
  const category = await requireProductCategory(id);
  const nextStatus = category.status === "inactive" ? "active" : "inactive";
  await db("categories").where({ id }).update({ status: nextStatus });
  await writeDbActivityLog({
    actor_user_id: actorUserId,
    source: "admin_web",
    module: "master_data",
    action: "category/toggle_status",
    entity_type: "category",
    entity_id: id,
    description: `Kategori produk ${category.name} diubah menjadi ${nextStatus}.`,
    metadata_json: {
      previous_status: category.status,
      next_status: nextStatus
    }
  });
  return categoryWithProductCount(id);
}

async function requireProduct(productId) {
  const product = await db("products").where({ id: productId }).first();
  if (!product) {
    const error = new Error("Produk tidak ditemukan.");
    error.status = 404;
    error.code = "PRODUCT_NOT_FOUND";
    throw error;
  }
  return product;
}

function productSkuPrefix(category = {}) {
  const knownPrefixes = {
    makanan: "MKN",
    minuman: "MNM",
    snack: "SNK",
    paket: "PKT"
  };
  const key = String(category.name || "")
    .trim()
    .toLowerCase();
  if (knownPrefixes[key]) return knownPrefixes[key];
  const sanitized = String(category.name || "Produk")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
  return (sanitized || "PRD").slice(0, 3).padEnd(3, "X");
}

async function generateProductSkuDb(categoryId) {
  const category = await requireProductCategory(categoryId);
  const prefix = productSkuPrefix(category);
  const products = await db("products").select("sku");
  const usedNumbers = products
    .map((product) => String(product.sku || "").toUpperCase())
    .map((sku) => sku.match(new RegExp(`^${prefix}-(\\d+)$`))?.[1])
    .filter(Boolean)
    .map(Number);
  const existingSkus = new Set(products.map((product) => String(product.sku || "").toUpperCase()));
  let nextNumber = (usedNumbers.length ? Math.max(...usedNumbers) : 0) + 1;
  let sku = `${prefix}-${String(nextNumber).padStart(3, "0")}`;
  while (existingSkus.has(sku)) {
    nextNumber += 1;
    sku = `${prefix}-${String(nextNumber).padStart(3, "0")}`;
  }
  return sku;
}

function normalizeProductVariantsForDb(productId, variants = []) {
  const cleaned = (Array.isArray(variants) ? variants : [])
    .map((variant, index) => ({
      id: variant.id || createRuntimeId("variant"),
      product_id: productId,
      name: String(variant.name || "").trim(),
      sku: variant.sku || null,
      price_delta: 0,
      sort_order: Number(variant.sort_order ?? variant.sortOrder ?? index + 1) || index + 1,
      status: variant.status === "inactive" ? "inactive" : "active"
    }))
    .filter((variant) => variant.name);
  if (cleaned.length > 20) {
    const error = new Error("Catatan variant maksimal 20 per produk.");
    error.status = 422;
    error.code = "PRODUCT_VARIANT_LIMIT";
    throw error;
  }
  const names = new Set();
  for (const variant of cleaned) {
    const key = variant.name.toLowerCase();
    if (names.has(key)) {
      const error = new Error(`Catatan variant ${variant.name} tidak boleh duplikat.`);
      error.status = 422;
      error.code = "PRODUCT_VARIANT_DUPLICATE";
      throw error;
    }
    names.add(key);
  }
  return cleaned;
}

async function productWithRelations(productId, outletId = "all") {
  const product = await db("products as p").leftJoin("categories as c", "c.id", "p.category_id").where("p.id", productId).select("p.*", db.raw("c.name as category_name"), db.raw("c.sort_order as category_sort_order"), db.raw("c.status as category_status")).first();
  if (!product) {
    const error = new Error("Produk tidak ditemukan.");
    error.status = 404;
    error.code = "PRODUCT_NOT_FOUND";
    throw error;
  }
  const [prices, composition, variants] = await Promise.all([db("product_prices as pp").leftJoin("outlets as o", "o.id", "pp.outlet_id").where("pp.product_id", productId).select("pp.*", db.raw("o.name as outlet_name"), db.raw("o.code as outlet_code"), db.raw("o.status as outlet_status")), db("product_compositions as pc").leftJoin("raw_materials as rm", "rm.id", "pc.material_id").where("pc.product_id", productId).select("pc.*", db.raw("rm.name as material_name"), db.raw("rm.type as material_type"), db.raw("rm.category_id as material_category_id")), db("product_variants").where({ product_id: productId }).orderBy("sort_order")]);
  const allPrices = prices.map((price) => ({
    ...price,
    outlet: price.outlet_id
      ? {
          id: price.outlet_id,
          name: price.outlet_name,
          code: price.outlet_code,
          status: price.outlet_status
        }
      : null
  }));
  return {
    ...product,
    category: product.category_id
      ? {
          id: product.category_id,
          name: product.category_name,
          sort_order: product.category_sort_order,
          status: product.category_status
        }
      : null,
    all_prices: allPrices,
    prices: outletId === "all" ? allPrices : allPrices.filter((price) => price.outlet_id === outletId),
    composition: composition.map((item) => ({
      ...item,
      quantity: Number(item.quantity || 0),
      material: item.material_id
        ? {
            id: item.material_id,
            name: item.material_name,
            type: item.material_type,
            category_id: item.material_category_id,
            unit: item.unit
          }
        : null
    })),
    composition_count: composition.length,
    variants,
    variant_count: variants.filter((variant) => variant.status === "active").length
  };
}

async function normalizeProductPayload(payload = {}, productId = null) {
  const name = String(payload.name || "").trim();
  const categoryId = String(payload.category_id || payload.categoryId || "").trim();
  if (!name || !categoryId) {
    const error = new Error("Nama produk dan kategori wajib diisi.");
    error.status = 422;
    error.code = "PRODUCT_INVALID";
    throw error;
  }
  await requireProductCategory(categoryId);
  const duplicateName = await db("products")
    .whereRaw("LOWER(name) = ?", [name.toLowerCase()])
    .where({ category_id: categoryId })
    .modify((query) => {
      if (productId) query.whereNot({ id: productId });
    })
    .first();
  if (duplicateName) {
    const error = new Error("Produk dengan nama dan kategori ini sudah ada.");
    error.status = 422;
    error.code = "PRODUCT_DUPLICATE";
    throw error;
  }

  const rawPrices = Array.isArray(payload.prices) ? payload.prices : [];
  const outletIds = [...new Set(rawPrices.map((price) => String(price.outlet_id || price.outletId || "").trim()).filter(Boolean))];
  const outlets = outletIds.length ? await db("outlets").whereIn("id", outletIds) : [];
  const outletSet = new Set(outlets.map((outlet) => outlet.id));
  const prices = rawPrices
    .map((price) => ({
      outlet_id: String(price.outlet_id || price.outletId || "").trim(),
      price: Number(price.price || 0),
      status: price.status === "inactive" ? "inactive" : "active"
    }))
    .filter((price) => price.outlet_id && outletSet.has(price.outlet_id) && price.price > 0);

  const rawComposition = Array.isArray(payload.composition) ? payload.composition : [];
  const materialIds = [...new Set(rawComposition.map((item) => String(item.material_id || item.materialId || "").trim()).filter(Boolean))];
  const materials = materialIds.length ? await db("raw_materials").whereIn("id", materialIds).whereNot("status", "inactive") : [];
  const materialMap = new Map(materials.map((material) => [material.id, material]));
  const composition = rawComposition
    .map((item) => {
      const materialId = String(item.material_id || item.materialId || "").trim();
      const material = materialMap.get(materialId);
      const quantity = Number(item.quantity || 0);
      return material && quantity > 0
        ? {
            material_id: materialId,
            quantity,
            unit: item.unit || material.unit || ""
          }
        : null;
    })
    .filter(Boolean);

  return {
    product: {
      category_id: categoryId,
      name,
      status: payload.status === "inactive" ? "inactive" : "active"
    },
    prices,
    composition,
    variants: normalizeProductVariantsForDb(productId || "__new_product__", payload.variants || [])
  };
}

async function getProductDetail(productId) {
  return productWithRelations(productId);
}

async function createProduct(payload = {}) {
  const id = payload.id || createRuntimeId("product");
  const normalized = await normalizeProductPayload(payload, null);
  const sku = payload.sku ? String(payload.sku).trim() : await generateProductSkuDb(normalized.product.category_id);
  const duplicateSku = await db("products").whereRaw("LOWER(sku) = ?", [sku.toLowerCase()]).first();
  if (duplicateSku) {
    const error = new Error("SKU produk sudah digunakan.");
    error.status = 422;
    error.code = "PRODUCT_SKU_DUPLICATE";
    throw error;
  }
  await db.transaction(async (trx) => {
    await trx("products").insert({
      id,
      sku,
      image_url: null,
      image_path: null,
      ...normalized.product
    });
    if (normalized.prices.length)
      await trx("product_prices").insert(
        normalized.prices.map((price) => ({
          id: createRuntimeId("price"),
          product_id: id,
          ...price
        }))
      );
    if (normalized.composition.length)
      await trx("product_compositions").insert(
        normalized.composition.map((item) => ({
          id: createRuntimeId("comp"),
          product_id: id,
          ...item
        }))
      );
    const variants = normalizeProductVariantsForDb(id, payload.variants || []);
    if (variants.length) await trx("product_variants").insert(variants);
  });
  await writeDbActivityLog({
    actor_user_id: payload.created_by || payload.createdBy || null,
    source: "admin_web",
    module: "product",
    action: "product/create",
    entity_type: "product",
    entity_id: id,
    description: `Produk ${normalized.product.name} dibuat.`,
    metadata_json: {
      sku,
      category_id: normalized.product.category_id,
      price_count: normalized.prices.length,
      composition_count: normalized.composition.length,
      variant_count: (payload.variants || []).length,
      status: normalized.product.status
    }
  });
  return productWithRelations(id);
}

async function updateProduct(productId, payload = {}) {
  const current = await requireProduct(productId);
  const normalized = await normalizeProductPayload(payload, productId);
  await db.transaction(async (trx) => {
    await trx("products")
      .where({ id: productId })
      .update({ ...normalized.product, sku: current.sku });
    await trx("product_prices").where({ product_id: productId }).del();
    if (normalized.prices.length)
      await trx("product_prices").insert(
        normalized.prices.map((price) => ({
          id: createRuntimeId("price"),
          product_id: productId,
          ...price
        }))
      );
    await trx("product_compositions").where({ product_id: productId }).del();
    if (normalized.composition.length)
      await trx("product_compositions").insert(
        normalized.composition.map((item) => ({
          id: createRuntimeId("comp"),
          product_id: productId,
          ...item
        }))
      );
    await trx("product_variants").where({ product_id: productId }).del();
    const variants = normalizeProductVariantsForDb(productId, payload.variants || []);
    if (variants.length) await trx("product_variants").insert(variants);
  });
  await writeDbActivityLog({
    actor_user_id: payload.updated_by || payload.updatedBy || null,
    source: "admin_web",
    module: "product",
    action: "product/update",
    entity_type: "product",
    entity_id: productId,
    description: `Produk ${normalized.product.name} diperbarui.`,
    metadata_json: {
      sku: current.sku,
      category_id: normalized.product.category_id,
      price_count: normalized.prices.length,
      composition_count: normalized.composition.length,
      variant_count: (payload.variants || []).length,
      status: normalized.product.status
    }
  });
  return productWithRelations(productId);
}

async function toggleProductStatus(productId, actorUserId = null) {
  const product = await requireProduct(productId);
  const nextStatus = product.status === "active" ? "inactive" : "active";
  await db("products").where({ id: productId }).update({ status: nextStatus });
  await writeDbActivityLog({
    actor_user_id: actorUserId,
    source: "admin_web",
    module: "product",
    action: "product/toggle_status",
    entity_type: "product",
    entity_id: productId,
    description: `Status produk ${product.name} menjadi ${nextStatus}.`,
    metadata_json: {
      sku: product.sku,
      previous_status: product.status,
      next_status: nextStatus
    }
  });
  return productWithRelations(productId);
}

async function normalizeCompositionPayloadDb(payload = {}, compositionId = null) {
  const productId = String(payload.product_id || payload.productId || "").trim();
  const materialId = String(payload.material_id || payload.materialId || "").trim();
  const quantity = Number(payload.quantity || 0);
  const [product, material] = await Promise.all([productId ? db("products").where({ id: productId }).first() : null, materialId ? db("raw_materials").where({ id: materialId }).whereNot("status", "inactive").first() : null]);
  if (!product || !material || quantity <= 0) {
    const error = new Error("Produk, Harga Pokok Produksi, dan qty komposisi wajib valid.");
    error.status = 422;
    error.code = "PRODUCT_COMPOSITION_INVALID";
    throw error;
  }
  const duplicate = await db("product_compositions")
    .where({ product_id: productId, material_id: materialId })
    .modify((query) => {
      if (compositionId) query.whereNot({ id: compositionId });
    })
    .first();
  if (duplicate) {
    const error = new Error("Komposisi produk untuk HPP ini sudah ada.");
    error.status = 422;
    error.code = "PRODUCT_COMPOSITION_DUPLICATE";
    throw error;
  }
  return {
    product_id: productId,
    material_id: materialId,
    quantity,
    unit: payload.unit || material.unit || ""
  };
}

async function createProductComposition(payload = {}) {
  const row = await normalizeCompositionPayloadDb(payload);
  const id = payload.id || createRuntimeId("comp");
  await db("product_compositions").insert({ id, ...row });
  await writeDbActivityLog({
    actor_user_id: payload.created_by || payload.createdBy || null,
    source: "admin_web",
    module: "product_composition",
    action: "product_composition/create",
    entity_type: "product_composition",
    entity_id: id,
    description: "Komposisi produk dibuat.",
    metadata_json: row
  });
  return productWithRelations(row.product_id);
}

async function updateProductComposition(compositionId, payload = {}) {
  const current = await db("product_compositions").where({ id: compositionId }).first();
  if (!current) throw new Error("Komposisi produk tidak ditemukan.");
  const row = await normalizeCompositionPayloadDb(payload, compositionId);
  await db("product_compositions").where({ id: compositionId }).update(row);
  await writeDbActivityLog({
    actor_user_id: payload.updated_by || payload.updatedBy || null,
    source: "admin_web",
    module: "product_composition",
    action: "product_composition/update",
    entity_type: "product_composition",
    entity_id: compositionId,
    description: "Komposisi produk diperbarui.",
    metadata_json: row
  });
  return productWithRelations(row.product_id);
}

async function deleteProductComposition(compositionId) {
  const current = await db("product_compositions").where({ id: compositionId }).first();
  if (!current) throw new Error("Komposisi produk tidak ditemukan.");
  await db("product_compositions").where({ id: compositionId }).del();
  await writeDbActivityLog({
    source: "admin_web",
    module: "product_composition",
    action: "product_composition/delete",
    entity_type: "product_composition",
    entity_id: compositionId,
    description: "Komposisi produk dihapus.",
    metadata_json: current
  });
  return current;
}

async function requireOutlet(outletId) {
  const outlet = await db("outlets").where({ id: outletId }).first();
  if (!outlet) {
    const error = new Error("Outlet tidak ditemukan.");
    error.status = 404;
    error.code = "OUTLET_NOT_FOUND";
    throw error;
  }
  return outlet;
}

function normalizeOutletPayload(payload = {}) {
  const name = String(payload.name || "").trim();
  const code = String(payload.code || "")
    .trim()
    .toUpperCase();
  const address = String(payload.address || "").trim();
  if (!name) {
    const error = new Error("Nama outlet wajib diisi.");
    error.status = 422;
    error.code = "OUTLET_NAME_REQUIRED";
    throw error;
  }
  if (!code) {
    const error = new Error("Kode outlet wajib diisi.");
    error.status = 422;
    error.code = "OUTLET_CODE_REQUIRED";
    throw error;
  }
  return {
    name,
    code,
    address,
    phone: payload.phone || null,
    opened_at: payload.opened_at || payload.openedAt || null,
    status: payload.status === "inactive" ? "inactive" : "active"
  };
}

async function outletWithUsage(outletId) {
  const outlet = await requireOutlet(outletId);
  const [tableCountRow, userCountRow] = await Promise.all([db("dining_tables").where({ outlet_id: outletId }).count({ count: "id" }).first(), db("user_outlets").where({ outlet_id: outletId }).count({ count: "user_id" }).first()]);
  return {
    ...outlet,
    table_count: Number(tableCountRow?.count || 0),
    user_count: Number(userCountRow?.count || 0)
  };
}

async function createOutlet(payload = {}) {
  const row = normalizeOutletPayload(payload);
  const duplicate = await db("outlets").where({ code: row.code }).first();
  if (duplicate) {
    const error = new Error("Kode outlet sudah digunakan.");
    error.status = 422;
    error.code = "OUTLET_CODE_DUPLICATE";
    throw error;
  }
  const id = payload.id || createRuntimeId("outlet");
  await db("outlets").insert({ id, ...row });
  await writeDbActivityLog({
    actor_user_id: payload.created_by || payload.createdBy || null,
    source: "admin_web",
    module: "master_data",
    action: "outlet/create",
    entity_type: "outlet",
    entity_id: id,
    description: `Outlet ${row.name} dibuat.`,
    metadata_json: { code: row.code, status: row.status }
  });
  return outletWithUsage(id);
}

async function getOutletDetail(id) {
  return outletWithUsage(id);
}

async function updateOutlet(id, payload = {}) {
  await requireOutlet(id);
  const row = normalizeOutletPayload(payload);
  const duplicate = await db("outlets").where({ code: row.code }).whereNot({ id }).first();
  if (duplicate) {
    const error = new Error("Kode outlet sudah digunakan.");
    error.status = 422;
    error.code = "OUTLET_CODE_DUPLICATE";
    throw error;
  }
  await db("outlets").where({ id }).update(row);
  await writeDbActivityLog({
    actor_user_id: payload.updated_by || payload.updatedBy || null,
    source: "admin_web",
    module: "master_data",
    action: "outlet/update",
    entity_type: "outlet",
    entity_id: id,
    description: `Outlet ${row.name} diperbarui.`,
    metadata_json: { code: row.code, status: row.status }
  });
  return outletWithUsage(id);
}

async function toggleOutletStatus(id, actorUserId = null) {
  const outlet = await requireOutlet(id);
  const nextStatus = outlet.status === "inactive" ? "active" : "inactive";
  await db("outlets").where({ id }).update({ status: nextStatus });
  await writeDbActivityLog({
    actor_user_id: actorUserId,
    source: "admin_web",
    module: "master_data",
    action: "outlet/toggle_status",
    entity_type: "outlet",
    entity_id: id,
    description: `Outlet ${outlet.name} diubah menjadi ${nextStatus}.`,
    metadata_json: { previous_status: outlet.status, next_status: nextStatus }
  });
  return outletWithUsage(id);
}

async function requireDiningTable(tableId) {
  const table = await db("dining_tables").where({ id: tableId }).first();
  if (!table) {
    const error = new Error("Meja tidak ditemukan.");
    error.status = 404;
    error.code = "TABLE_NOT_FOUND";
    throw error;
  }
  return table;
}

function normalizeDiningTablePayload(payload = {}) {
  const outletId = String(payload.outlet_id || payload.outletId || "").trim();
  const number = String(payload.number || payload.table_number || payload.tableNumber || "").trim();
  const status = payload.status === "inactive" ? "inactive" : "active";
  if (!outletId) {
    const error = new Error("Outlet meja wajib dipilih.");
    error.status = 422;
    error.code = "TABLE_OUTLET_REQUIRED";
    throw error;
  }
  if (!number) {
    const error = new Error("Nomor meja wajib diisi.");
    error.status = 422;
    error.code = "TABLE_NUMBER_REQUIRED";
    throw error;
  }
  return { outlet_id: outletId, number, status };
}

function normalizeTableGenerationPayload(payload = {}) {
  const outletId = String(payload.outlet_id || payload.outletId || "").trim();
  const quantity = Number(payload.quantity);
  const status = payload.status || "active";

  if (!outletId) {
    const error = new Error("Outlet meja wajib dipilih.");
    error.status = 422;
    error.code = "TABLE_OUTLET_REQUIRED";
    throw error;
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    const error = new Error("Jumlah meja wajib bilangan bulat antara 1 sampai 100.");
    error.status = 422;
    error.code = "TABLE_QUANTITY_INVALID";
    throw error;
  }
  if (!["active", "inactive"].includes(status)) {
    const error = new Error("Status meja tidak valid.");
    error.status = 422;
    error.code = "TABLE_STATUS_INVALID";
    throw error;
  }

  return { outlet_id: outletId, quantity, status };
}

async function tableWithOutlet(tableId) {
  const table = await requireDiningTable(tableId);
  const outlet = await db("outlets").where({ id: table.outlet_id }).first();
  return {
    ...table,
    outlet,
    outlet_name: outlet?.name || "-"
  };
}

async function createTable(payload = {}) {
  const row = normalizeDiningTablePayload(payload);
  await requireOutlet(row.outlet_id);
  const duplicate = await db("dining_tables").where({ outlet_id: row.outlet_id, number: row.number }).first();
  if (duplicate) {
    const error = new Error("Nomor meja sudah digunakan di outlet ini.");
    error.status = 422;
    error.code = "TABLE_NUMBER_DUPLICATE";
    throw error;
  }
  const id = payload.id || createRuntimeId("table");
  await db("dining_tables").insert({ id, ...row });
  await writeDbActivityLog({
    actor_user_id: payload.created_by || payload.createdBy || null,
    outlet_id: row.outlet_id,
    source: "admin_web",
    module: "master_data",
    action: "table/create",
    entity_type: "table",
    entity_id: id,
    description: `Meja ${row.number} dibuat.`,
    metadata_json: { outlet_id: row.outlet_id, status: row.status }
  });
  return tableWithOutlet(id);
}

async function generateTables(payload = {}) {
  const generation = normalizeTableGenerationPayload(payload);
  const outlet = await requireOutlet(generation.outlet_id);
  const outlets = await db("outlets").orderBy("opened_at", "asc").orderBy("id", "asc");
  const outletIndex = Math.max(
    0,
    outlets.findIndex((item) => item.id === generation.outlet_id)
  );
  let generated;
  let insertedRows;

  await db.transaction(async (trx) => {
    const existingTables = await trx("dining_tables").where({ outlet_id: generation.outlet_id }).select("number").forUpdate();

    generated = generateTableNumbers({
      existingNumbers: existingTables.map((table) => table.number),
      fallbackPrefix: alphabeticPrefix(outletIndex),
      quantity: generation.quantity
    });
    insertedRows = generated.numbers.map((number) => ({
      id: createRuntimeId("table"),
      outlet_id: generation.outlet_id,
      number,
      status: generation.status
    }));
    await trx("dining_tables").insert(insertedRows);
  });

  await writeDbActivityLog({
    actor_user_id: payload.created_by || payload.createdBy || null,
    outlet_id: generation.outlet_id,
    source: "admin_web",
    module: "master_data",
    action: "table/batch_create",
    entity_type: "table_batch",
    entity_id: insertedRows[0].id,
    description: `${insertedRows.length} meja dibuat (${generated.first_number}–${generated.last_number}).`,
    metadata_json: {
      count: insertedRows.length,
      first_number: generated.first_number,
      last_number: generated.last_number,
      status: generation.status,
      table_ids: insertedRows.map((table) => table.id)
    }
  });

  return {
    count: insertedRows.length,
    first_number: generated.first_number,
    last_number: generated.last_number,
    tables: insertedRows.map((table) => ({
      ...table,
      outlet,
      outlet_name: outlet.name
    }))
  };
}

async function getTableDetail(id) {
  return tableWithOutlet(id);
}

async function updateTable(id, payload = {}) {
  await requireDiningTable(id);
  const row = normalizeDiningTablePayload(payload);
  await requireOutlet(row.outlet_id);
  const duplicate = await db("dining_tables").where({ outlet_id: row.outlet_id, number: row.number }).whereNot({ id }).first();
  if (duplicate) {
    const error = new Error("Nomor meja sudah digunakan di outlet ini.");
    error.status = 422;
    error.code = "TABLE_NUMBER_DUPLICATE";
    throw error;
  }
  await db("dining_tables").where({ id }).update(row);
  await writeDbActivityLog({
    actor_user_id: payload.updated_by || payload.updatedBy || null,
    outlet_id: row.outlet_id,
    source: "admin_web",
    module: "master_data",
    action: "table/update",
    entity_type: "table",
    entity_id: id,
    description: `Meja ${row.number} diperbarui.`,
    metadata_json: { outlet_id: row.outlet_id, status: row.status }
  });
  return tableWithOutlet(id);
}

async function toggleTableStatus(id, actorUserId = null) {
  const table = await requireDiningTable(id);
  const nextStatus = table.status === "inactive" ? "active" : "inactive";
  await db("dining_tables").where({ id }).update({ status: nextStatus });
  await writeDbActivityLog({
    actor_user_id: actorUserId,
    outlet_id: table.outlet_id,
    source: "admin_web",
    module: "master_data",
    action: "table/toggle_status",
    entity_type: "table",
    entity_id: id,
    description: `Meja ${table.number} diubah menjadi ${nextStatus}.`,
    metadata_json: { previous_status: table.status, next_status: nextStatus }
  });
  return tableWithOutlet(id);
}

async function requireSupplier(supplierId) {
  const supplier = await db("suppliers").where({ id: supplierId }).first();
  if (!supplier) {
    const error = new Error("Supplier tidak ditemukan.");
    error.status = 404;
    error.code = "SUPPLIER_NOT_FOUND";
    throw error;
  }
  return supplier;
}

function summarizeSupplierPurchases(supplier, purchases = []) {
  const supplierPurchases = purchases
    .filter((purchase) => (purchase.supplier_id || purchase.supplierId) === supplier.id)
    .map((purchase) => ({
      ...purchase,
      item_count: Number(purchase.item_count ?? purchase.items?.length ?? 0),
      total: Number(purchase.total ?? purchase.grand_total ?? 0)
    }))
    .sort((a, b) => String(b.operational_at || b.purchase_date || "").localeCompare(String(a.operational_at || a.purchase_date || "")));

  return {
    ...supplier,
    purchases: supplierPurchases,
    purchase_count: supplierPurchases.length,
    purchase_total: supplierPurchases.reduce((total, purchase) => total + Number(purchase.total || 0), 0)
  };
}

async function supplierWithPurchases(supplierId, filters = {}) {
  const supplier = await requireSupplier(supplierId);
  const purchases = await fetchPurchaseRows({
    outletId: filters.outletId || "all"
  });
  return summarizeSupplierPurchases(supplier, purchases);
}

function normalizeSupplierPayload(payload = {}) {
  const name = String(payload.name || "").trim();
  const phone = String(payload.phone || "").trim();
  const status = payload.status === "inactive" ? "inactive" : "active";
  if (!name || phone.length < 6) {
    const error = new Error("Nama supplier dan nomor telepon wajib diisi.");
    error.status = 422;
    error.code = "SUPPLIER_INVALID";
    throw error;
  }
  return { name, phone, status };
}

async function createSupplier(payload = {}) {
  const row = normalizeSupplierPayload(payload);
  const duplicate = await db("suppliers").whereRaw("LOWER(name) = ?", [row.name.toLowerCase()]).first();
  if (duplicate) {
    const error = new Error("Nama supplier sudah digunakan.");
    error.status = 422;
    error.code = "SUPPLIER_NAME_DUPLICATE";
    throw error;
  }
  const id = payload.id || createRuntimeId("supplier");
  await db("suppliers").insert({ id, ...row });
  await writeDbActivityLog({
    actor_user_id: payload.created_by || payload.createdBy || null,
    source: "admin_web",
    module: "master_data",
    action: "supplier/create",
    entity_type: "supplier",
    entity_id: id,
    description: `Supplier ${row.name} dibuat.`,
    metadata_json: { phone: row.phone, status: row.status }
  });
  return supplierWithPurchases(id);
}

async function getSupplierDetail(id) {
  return supplierWithPurchases(id);
}

async function updateSupplier(id, payload = {}) {
  await requireSupplier(id);
  const row = normalizeSupplierPayload(payload);
  const duplicate = await db("suppliers").whereRaw("LOWER(name) = ?", [row.name.toLowerCase()]).whereNot({ id }).first();
  if (duplicate) {
    const error = new Error("Nama supplier sudah digunakan.");
    error.status = 422;
    error.code = "SUPPLIER_NAME_DUPLICATE";
    throw error;
  }
  await db("suppliers").where({ id }).update(row);
  await writeDbActivityLog({
    actor_user_id: payload.updated_by || payload.updatedBy || null,
    source: "admin_web",
    module: "master_data",
    action: "supplier/update",
    entity_type: "supplier",
    entity_id: id,
    description: `Supplier ${row.name} diperbarui.`,
    metadata_json: { phone: row.phone, status: row.status }
  });
  return supplierWithPurchases(id);
}

async function toggleSupplierStatus(id, actorUserId = null) {
  const supplier = await requireSupplier(id);
  const nextStatus = supplier.status === "inactive" ? "active" : "inactive";
  await db("suppliers").where({ id }).update({ status: nextStatus });
  await writeDbActivityLog({
    actor_user_id: actorUserId,
    source: "admin_web",
    module: "master_data",
    action: "supplier/toggle_status",
    entity_type: "supplier",
    entity_id: id,
    description: `Status supplier ${supplier.name} menjadi ${nextStatus}.`,
    metadata_json: {
      previous_status: supplier.status,
      next_status: nextStatus
    }
  });
  return supplierWithPurchases(id);
}

async function requirePaymentMethod(methodId) {
  const method = await db("payment_methods").where({ id: methodId }).first();
  if (!method) {
    const error = new Error("Metode pembayaran tidak ditemukan.");
    error.status = 404;
    error.code = "PAYMENT_METHOD_NOT_FOUND";
    throw error;
  }
  return method;
}

async function requireFinancialAccountByCode(accountCode, allowedGroups = []) {
  const code = String(accountCode || "").trim();
  if (!code) {
    const error = new Error("Akun laporan wajib dipilih.");
    error.status = 422;
    error.code = "ACCOUNT_CODE_REQUIRED";
    throw error;
  }
  const account = await db("financial_accounts").where({ code }).first();
  if (!account || (allowedGroups.length && !allowedGroups.includes(account.report_group))) {
    const error = new Error("Akun laporan tidak sesuai group yang dibutuhkan.");
    error.status = 422;
    error.code = "ACCOUNT_GROUP_INVALID";
    throw error;
  }
  return account;
}

function normalizePaymentMethodPayload(payload = {}, fallbackSortOrder = 0) {
  const name = String(payload.name || "").trim();
  const code = String(payload.code || "")
    .trim()
    .toLowerCase();
  const sortOrder = Number(payload.sort_order ?? payload.sortOrder ?? fallbackSortOrder ?? 0);
  const status = payload.status === "inactive" ? "inactive" : "active";
  if (!name) {
    const error = new Error("Nama metode pembayaran wajib diisi.");
    error.status = 422;
    error.code = "PAYMENT_METHOD_NAME_REQUIRED";
    throw error;
  }
  if (!code) {
    const error = new Error("Kode metode pembayaran wajib diisi.");
    error.status = 422;
    error.code = "PAYMENT_METHOD_CODE_REQUIRED";
    throw error;
  }
  return {
    name,
    code,
    account_code: payload.account_code || payload.accountCode || null,
    sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
    status
  };
}

async function paymentMethodWithAccount(methodId) {
  const method = await requirePaymentMethod(methodId);
  const account = method.account_code ? await db("financial_accounts").where({ code: method.account_code }).first() : null;
  return { ...method, account };
}

async function createPaymentMethod(payload = {}) {
  const maxRow = await db("payment_methods").max({ max: "sort_order" }).first();
  const row = normalizePaymentMethodPayload(payload, Number(maxRow?.max || 0) + 1);
  await requireFinancialAccountByCode(row.account_code, ["cash_bank"]);
  const duplicate = await db("payment_methods")
    .where((builder) => builder.where({ code: row.code }).orWhere({ name: row.name }))
    .first();
  if (duplicate) {
    const error = new Error("Nama atau kode metode pembayaran sudah digunakan.");
    error.status = 422;
    error.code = "PAYMENT_METHOD_DUPLICATE";
    throw error;
  }
  const id = payload.id || createRuntimeId("payment_method");
  await db("payment_methods").insert({ id, ...row });
  await writeDbActivityLog({
    actor_user_id: payload.created_by || payload.createdBy || null,
    source: "admin_web",
    module: "master_data",
    action: "payment_method/create",
    entity_type: "payment_method",
    entity_id: id,
    description: `Metode pembayaran ${row.name} dibuat.`,
    metadata_json: {
      code: row.code,
      account_code: row.account_code,
      status: row.status
    }
  });
  return paymentMethodWithAccount(id);
}

async function updatePaymentMethod(id, payload = {}) {
  const current = await requirePaymentMethod(id);
  const row = normalizePaymentMethodPayload(payload, current.sort_order);
  await requireFinancialAccountByCode(row.account_code, ["cash_bank"]);
  const duplicate = await db("payment_methods")
    .where((builder) => builder.where({ code: row.code }).orWhere({ name: row.name }))
    .whereNot({ id })
    .first();
  if (duplicate) {
    const error = new Error("Nama atau kode metode pembayaran sudah digunakan.");
    error.status = 422;
    error.code = "PAYMENT_METHOD_DUPLICATE";
    throw error;
  }
  await db("payment_methods").where({ id }).update(row);
  await writeDbActivityLog({
    actor_user_id: payload.updated_by || payload.updatedBy || null,
    source: "admin_web",
    module: "master_data",
    action: "payment_method/update",
    entity_type: "payment_method",
    entity_id: id,
    description: `Metode pembayaran ${row.name} diperbarui.`,
    metadata_json: {
      code: row.code,
      account_code: row.account_code,
      status: row.status
    }
  });
  return paymentMethodWithAccount(id);
}

async function togglePaymentMethodStatus(id, actorUserId = null) {
  const method = await requirePaymentMethod(id);
  const nextStatus = method.status === "inactive" ? "active" : "inactive";
  await db("payment_methods").where({ id }).update({ status: nextStatus });
  await writeDbActivityLog({
    actor_user_id: actorUserId,
    source: "admin_web",
    module: "master_data",
    action: "payment_method/toggle_status",
    entity_type: "payment_method",
    entity_id: id,
    description: `Status metode pembayaran ${method.name} menjadi ${nextStatus}.`,
    metadata_json: {
      code: method.code,
      previous_status: method.status,
      next_status: nextStatus
    }
  });
  return paymentMethodWithAccount(id);
}

async function requireExpenseCategory(categoryId) {
  const category = await db("expense_categories").where({ id: categoryId }).first();
  if (!category) {
    const error = new Error("Nama pengeluaran operasional tidak ditemukan.");
    error.status = 404;
    error.code = "EXPENSE_CATEGORY_NOT_FOUND";
    throw error;
  }
  return category;
}

function normalizeExpenseCategoryPayload(payload = {}, fallbackSortOrder = 0) {
  const name = String(payload.name || "").trim();
  const accountCode = String(payload.account_code || payload.accountCode || "").trim();
  const sortOrder = Number(payload.sort_order ?? payload.sortOrder ?? fallbackSortOrder ?? 0);
  const status = payload.status === "inactive" ? "inactive" : "active";
  if (!name || !Number.isFinite(sortOrder) || sortOrder <= 0) {
    const error = new Error("Nama pengeluaran operasional dan urutan wajib valid.");
    error.status = 422;
    error.code = "EXPENSE_CATEGORY_INVALID";
    throw error;
  }
  return { name, account_code: accountCode, sort_order: sortOrder, status };
}

async function expenseCategoryWithUsage(categoryId) {
  const category = await requireExpenseCategory(categoryId);
  const [account, expenses] = await Promise.all([
    category.account_code ? db("financial_accounts").where({ code: category.account_code }).first() : null,
    db("expenses")
      .leftJoin("outlets as o", "expenses.outlet_id", "o.id")
      .leftJoin("users as u", "expenses.created_by", "u.id")
      .whereRaw("LOWER(expenses.category) = ?", [String(category.name || "").toLowerCase()])
      .select("expenses.*", "o.name as outlet_name", "u.name as created_by_name")
      .orderBy("expenses.expense_date", "desc")
  ]);
  const rows = expenses.map((expense) => ({
    ...expense,
    outlet: expense.outlet_id ? { id: expense.outlet_id, name: expense.outlet_name } : null,
    created_by_user: expense.created_by ? { id: expense.created_by, name: expense.created_by_name } : null
  }));
  return {
    ...category,
    account: account || null,
    expenses: rows,
    expense_count: rows.length,
    expense_total: rows.reduce((total, expense) => total + Number(expense.amount || 0), 0)
  };
}

async function createExpenseCategory(payload = {}) {
  const maxRow = await db("expense_categories").max({ max: "sort_order" }).first();
  const row = normalizeExpenseCategoryPayload(payload, Number(maxRow?.max || 0) + 1);
  await requireFinancialAccountByCode(row.account_code, ["expense"]);
  const duplicate = await db("expense_categories").whereRaw("LOWER(name) = ?", [row.name.toLowerCase()]).first();
  if (duplicate) {
    const error = new Error("Nama pengeluaran operasional sudah digunakan.");
    error.status = 422;
    error.code = "EXPENSE_CATEGORY_DUPLICATE";
    throw error;
  }
  const id = payload.id || createRuntimeId("expense_cat");
  await db("expense_categories").insert({ id, ...row });
  await writeDbActivityLog({
    actor_user_id: payload.created_by || payload.createdBy || null,
    source: "admin_web",
    module: "master_data",
    action: "expense_category/create",
    entity_type: "expense_category",
    entity_id: id,
    description: `Nama pengeluaran operasional ${row.name} dibuat.`,
    metadata_json: {
      account_code: row.account_code,
      sort_order: row.sort_order,
      status: row.status
    }
  });
  return expenseCategoryWithUsage(id);
}

async function getExpenseCategoryDetail(id) {
  return expenseCategoryWithUsage(id);
}

async function updateExpenseCategory(id, payload = {}) {
  const current = await requireExpenseCategory(id);
  const row = normalizeExpenseCategoryPayload(payload, current.sort_order);
  await requireFinancialAccountByCode(row.account_code, ["expense"]);
  const duplicate = await db("expense_categories").whereRaw("LOWER(name) = ?", [row.name.toLowerCase()]).whereNot({ id }).first();
  if (duplicate) {
    const error = new Error("Nama pengeluaran operasional sudah digunakan.");
    error.status = 422;
    error.code = "EXPENSE_CATEGORY_DUPLICATE";
    throw error;
  }
  await db("expense_categories").where({ id }).update(row);
  await writeDbActivityLog({
    actor_user_id: payload.updated_by || payload.updatedBy || null,
    source: "admin_web",
    module: "master_data",
    action: "expense_category/update",
    entity_type: "expense_category",
    entity_id: id,
    description: `Nama pengeluaran operasional ${row.name} diperbarui.`,
    metadata_json: {
      account_code: row.account_code,
      sort_order: row.sort_order,
      status: row.status
    }
  });
  return expenseCategoryWithUsage(id);
}

async function toggleExpenseCategoryStatus(id, actorUserId = null) {
  const category = await requireExpenseCategory(id);
  const nextStatus = category.status === "inactive" ? "active" : "inactive";
  await db("expense_categories").where({ id }).update({ status: nextStatus });
  await writeDbActivityLog({
    actor_user_id: actorUserId,
    source: "admin_web",
    module: "master_data",
    action: "expense_category/toggle_status",
    entity_type: "expense_category",
    entity_id: id,
    description: `Status nama pengeluaran operasional ${category.name} menjadi ${nextStatus}.`,
    metadata_json: {
      previous_status: category.status,
      next_status: nextStatus
    }
  });
  return expenseCategoryWithUsage(id);
}

async function requireExpense(expenseId) {
  const expense = await db("expenses").where({ id: expenseId }).first();
  if (!expense) {
    const error = new Error("Pengeluaran tidak ditemukan.");
    error.status = 404;
    error.code = "EXPENSE_NOT_FOUND";
    throw error;
  }
  return expense;
}

function normalizeExpenseCorrectionPayload(payload = {}) {
  const amount = Math.round(Number(payload.amount || 0));
  const correctionNote = String(payload.correction_note || payload.correctionNote || "").trim();

  if (!Number.isFinite(amount) || amount <= 0) {
    const error = new Error("Nominal koreksi wajib lebih dari 0.");
    error.status = 422;
    error.code = "EXPENSE_CORRECTION_AMOUNT_INVALID";
    throw error;
  }

  if (!correctionNote) {
    const error = new Error("Catatan koreksi wajib diisi.");
    error.status = 422;
    error.code = "EXPENSE_CORRECTION_NOTE_REQUIRED";
    throw error;
  }

  return { amount, correction_note: correctionNote };
}

function normalizeExpenseRow(row = {}) {
  return {
    ...row,
    status: row.status || "approved",
    outlet: row.outlet_id ? { id: row.outlet_id, name: row.outlet_name || row.outlet_id } : null,
    created_by_user: row.created_by ? { id: row.created_by, name: row.created_by_name || row.created_by } : null,
    corrected_by_user: row.corrected_by
      ? {
          id: row.corrected_by,
          name: row.corrected_by_name || row.corrected_by
        }
      : null,
    approved_by_user: row.approved_by ? { id: row.approved_by, name: row.approved_by_name || row.approved_by } : null,
    rejected_by_user: row.rejected_by ? { id: row.rejected_by, name: row.rejected_by_name || row.rejected_by } : null
  };
}

async function getExpenseDetailRow(expenseId) {
  const row = await db("expenses as e").leftJoin("outlets as outlet", "e.outlet_id", "outlet.id").leftJoin("users as created_user", "e.created_by", "created_user.id").leftJoin("users as corrected_user", "e.corrected_by", "corrected_user.id").leftJoin("users as approved_user", "e.approved_by", "approved_user.id").leftJoin("users as rejected_user", "e.rejected_by", "rejected_user.id").where("e.id", expenseId).select("e.*", db.raw("outlet.name as outlet_name"), db.raw("created_user.name as created_by_name"), db.raw("corrected_user.name as corrected_by_name"), db.raw("approved_user.name as approved_by_name"), db.raw("rejected_user.name as rejected_by_name")).first();
  if (!row) {
    const error = new Error("Pengeluaran tidak ditemukan.");
    error.status = 404;
    error.code = "EXPENSE_NOT_FOUND";
    throw error;
  }
  return normalizeExpenseRow(row);
}

async function correctExpenseAmount(expenseId, payload = {}) {
  const expense = await requireExpense(expenseId);
  const correctionPayload = normalizeExpenseCorrectionPayload(payload);
  const previousAmount = Number(expense.amount || 0);
  const correctedBy = payload.corrected_by || payload.correctedBy || null;

  await db("expenses").where({ id: expense.id }).update({
    previous_amount: previousAmount,
    amount: correctionPayload.amount,
    correction_note: correctionPayload.correction_note,
    corrected_at: new Date(),
    corrected_by: correctedBy,
    updated_by: correctedBy,
    updated_at: new Date()
  });

  await writeDbActivityLog({
    actor_user_id: correctedBy,
    outlet_id: expense.outlet_id,
    source: "admin_web",
    module: "expense",
    action: "expense/update",
    entity_type: "expense",
    entity_id: expense.id,
    description: `Admin koreksi pengeluaran ${expense.category}`,
    metadata_json: {
      previous_amount: previousAmount,
      new_amount: correctionPayload.amount,
      correction_note: correctionPayload.correction_note
    }
  });

  return getExpenseDetailRow(expense.id);
}

async function approveExpense(expenseId, payload = {}) {
  const expense = await requireExpense(expenseId);
  const approvedBy = payload.approved_by || payload.approvedBy || null;
  if ((expense.status || "approved") !== "pending") {
    const error = new Error("Hanya pengeluaran pending yang bisa di-approve.");
    error.status = 422;
    error.code = "EXPENSE_NOT_PENDING";
    throw error;
  }

  await db("expenses").where({ id: expense.id }).update({
    status: "approved",
    approved_at: new Date(),
    approved_by: approvedBy,
    rejected_at: null,
    rejected_by: null,
    rejection_note: null,
    updated_by: approvedBy,
    updated_at: new Date()
  });

  await writeDbActivityLog({
    actor_user_id: approvedBy,
    outlet_id: expense.outlet_id,
    source: "admin_web",
    module: "expense",
    action: "expense/approve",
    entity_type: "expense",
    entity_id: expense.id,
    description: `Admin approve pengeluaran ${expense.category}.`,
    metadata_json: {
      category: expense.category,
      amount: Number(expense.amount || 0),
      expense_date: dateOnly(expense.expense_date)
    }
  });

  return getExpenseDetailRow(expense.id);
}

async function rejectExpense(expenseId, payload = {}) {
  const expense = await requireExpense(expenseId);
  const rejectedBy = payload.rejected_by || payload.rejectedBy || null;
  const rejectionNote = String(payload.reason || payload.rejection_note || payload.rejectionNote || "").trim();
  if ((expense.status || "approved") !== "pending") {
    const error = new Error("Hanya pengeluaran pending yang bisa di-reject.");
    error.status = 422;
    error.code = "EXPENSE_NOT_PENDING";
    throw error;
  }
  if (!rejectionNote) {
    const error = new Error("Alasan reject wajib diisi.");
    error.status = 422;
    error.code = "EXPENSE_REJECTION_NOTE_REQUIRED";
    throw error;
  }

  await db("expenses").where({ id: expense.id }).update({
    status: "rejected",
    rejected_at: new Date(),
    rejected_by: rejectedBy,
    rejection_note: rejectionNote,
    approved_at: null,
    approved_by: null,
    updated_by: rejectedBy,
    updated_at: new Date()
  });

  await writeDbActivityLog({
    actor_user_id: rejectedBy,
    outlet_id: expense.outlet_id,
    source: "admin_web",
    module: "expense",
    action: "expense/reject",
    entity_type: "expense",
    entity_id: expense.id,
    description: `Admin reject pengeluaran ${expense.category}.`,
    metadata_json: {
      category: expense.category,
      amount: Number(expense.amount || 0),
      expense_date: dateOnly(expense.expense_date),
      reason: rejectionNote
    }
  });

  return getExpenseDetailRow(expense.id);
}

function getMaterialTypeLabel(type) {
  return type === "biaya" ? "Biaya Produksi" : "Harga Pokok Penjualan";
}

async function requireMaterialCategory(categoryId) {
  const category = await db("raw_material_categories").where({ id: categoryId }).first();
  if (!category) {
    const error = new Error("Kategori harga pokok produksi tidak ditemukan.");
    error.status = 404;
    error.code = "MATERIAL_CATEGORY_NOT_FOUND";
    throw error;
  }
  return category;
}

function normalizeMaterialCategoryPayload(payload = {}, fallbackSortOrder = 0) {
  const name = String(payload.name || "").trim();
  const type = String(payload.type || "hpp").trim();
  const hasSortOrder = Object.prototype.hasOwnProperty.call(payload, "sort_order") && payload.sort_order !== "" && payload.sort_order !== null;
  const sortOrder = Number(hasSortOrder ? payload.sort_order : fallbackSortOrder);
  const status = payload.status === "inactive" ? "inactive" : "active";
  const accountCode = String(payload.account_code || (type === "biaya" ? "6000" : "5002")).trim();

  if (!name || !Number.isFinite(sortOrder) || sortOrder <= 0) {
    const error = new Error("Nama kategori harga pokok produksi dan urutan wajib valid.");
    error.status = 422;
    error.code = "MATERIAL_CATEGORY_INVALID";
    throw error;
  }
  if (!["hpp", "biaya"].includes(type)) {
    const error = new Error("Type kategori harga pokok produksi harus hpp atau biaya.");
    error.status = 422;
    error.code = "MATERIAL_CATEGORY_TYPE_INVALID";
    throw error;
  }

  return {
    name,
    type,
    account_code: accountCode,
    sort_order: sortOrder,
    status
  };
}

async function materialCategoryWithUsage(categoryId) {
  const category = await requireMaterialCategory(categoryId);
  const [account, materials] = await Promise.all([category.account_code ? db("financial_accounts").where({ code: category.account_code }).first() : null, db("raw_materials").where({ category_id: category.id }).orderBy("name", "asc")]);
  return {
    ...category,
    account: account || null,
    materials,
    material_count: materials.length,
    material_type_label: getMaterialTypeLabel(category.type)
  };
}

async function createMaterialCategory(payload = {}) {
  const maxRow = await db("raw_material_categories").max({ max: "sort_order" }).first();
  const row = normalizeMaterialCategoryPayload(payload, Number(maxRow?.max || 0) + 1);
  await requireFinancialAccountByCode(row.account_code, [row.type === "biaya" ? "expense" : "cogs"]);
  const duplicate = await db("raw_material_categories").where({ type: row.type }).whereRaw("LOWER(name) = ?", [row.name.toLowerCase()]).first();
  if (duplicate) {
    const error = new Error("Nama kategori harga pokok produksi sudah digunakan untuk type ini.");
    error.status = 422;
    error.code = "MATERIAL_CATEGORY_DUPLICATE";
    throw error;
  }
  const id = payload.id || createRuntimeId("raw_mat_cat");
  await db("raw_material_categories").insert({ id, ...row });
  await writeDbActivityLog({
    actor_user_id: payload.created_by || payload.createdBy || null,
    source: "admin_web",
    module: "material_category",
    action: "material_category/create",
    entity_type: "raw_material_category",
    entity_id: id,
    description: `Kategori Harga Pokok Produksi ${row.name} dibuat.`,
    metadata_json: {
      type: row.type,
      account_code: row.account_code,
      status: row.status
    }
  });
  return materialCategoryWithUsage(id);
}

async function getMaterialCategoryDetail(categoryId) {
  return materialCategoryWithUsage(categoryId);
}

async function updateMaterialCategory(categoryId, payload = {}) {
  const current = await requireMaterialCategory(categoryId);
  const row = normalizeMaterialCategoryPayload(payload, current.sort_order);
  await requireFinancialAccountByCode(row.account_code, [row.type === "biaya" ? "expense" : "cogs"]);
  const duplicate = await db("raw_material_categories").where({ type: row.type }).whereRaw("LOWER(name) = ?", [row.name.toLowerCase()]).whereNot({ id: categoryId }).first();
  if (duplicate) {
    const error = new Error("Nama kategori harga pokok produksi sudah digunakan untuk type ini.");
    error.status = 422;
    error.code = "MATERIAL_CATEGORY_DUPLICATE";
    throw error;
  }

  await db.transaction(async (trx) => {
    await trx("raw_material_categories").where({ id: categoryId }).update(row);
    await trx("raw_materials").where({ category_id: categoryId }).update({ type: row.type, account_code: row.account_code });
  });
  await writeDbActivityLog({
    actor_user_id: payload.updated_by || payload.updatedBy || null,
    source: "admin_web",
    module: "material_category",
    action: "material_category/update",
    entity_type: "raw_material_category",
    entity_id: categoryId,
    description: `Kategori Harga Pokok Produksi ${row.name} diperbarui.`,
    metadata_json: {
      type: row.type,
      account_code: row.account_code,
      status: row.status
    }
  });
  return materialCategoryWithUsage(categoryId);
}

async function toggleMaterialCategoryStatus(categoryId, actorUserId = null) {
  const category = await requireMaterialCategory(categoryId);
  const nextStatus = category.status === "active" ? "inactive" : "active";
  await db("raw_material_categories").where({ id: categoryId }).update({ status: nextStatus });
  await writeDbActivityLog({
    actor_user_id: actorUserId,
    source: "admin_web",
    module: "material_category",
    action: "material_category/toggle_status",
    entity_type: "raw_material_category",
    entity_id: categoryId,
    description: `Status kategori Harga Pokok Produksi ${category.name} menjadi ${nextStatus}.`,
    metadata_json: {
      type: category.type,
      previous_status: category.status,
      next_status: nextStatus
    }
  });
  return materialCategoryWithUsage(categoryId);
}

async function requireMaterial(materialId) {
  const material = await db("raw_materials").where({ id: materialId }).first();
  if (!material) {
    const error = new Error("Harga Pokok Produksi tidak ditemukan.");
    error.status = 404;
    error.code = "MATERIAL_NOT_FOUND";
    throw error;
  }
  return material;
}

function normalizeMaterialPayload(payload = {}, fallback = {}) {
  const name = String(payload.name || "").trim();
  const unit = String(payload.unit || "").trim();
  const lowStockThreshold = Number(payload.low_stock_threshold ?? payload.lowStockThreshold ?? fallback.low_stock_threshold ?? 0);
  const type = String(payload.type || fallback.type || "hpp").trim();
  const categoryId = String(payload.category_id || payload.categoryId || fallback.category_id || "").trim();
  const status = payload.status === "inactive" ? "inactive" : "active";

  if (!name || !unit || !Number.isFinite(lowStockThreshold) || lowStockThreshold < 0) {
    const error = new Error("Nama, unit, dan threshold Harga Pokok Produksi wajib valid.");
    error.status = 422;
    error.code = "MATERIAL_INVALID";
    throw error;
  }
  if (!["hpp", "biaya"].includes(type)) {
    const error = new Error("Type Harga Pokok Produksi harus hpp atau biaya.");
    error.status = 422;
    error.code = "MATERIAL_TYPE_INVALID";
    throw error;
  }
  if (!categoryId) {
    const error = new Error("Kategori Harga Pokok Produksi wajib dipilih.");
    error.status = 422;
    error.code = "MATERIAL_CATEGORY_REQUIRED";
    throw error;
  }

  return {
    name,
    unit,
    low_stock_threshold: lowStockThreshold,
    type,
    category_id: categoryId,
    status
  };
}

async function materialWithUsage(materialId, outletId = "all") {
  const material = await requireMaterial(materialId);
  const [category, accountRows, stockRows, compositionCount] = await Promise.all([
    material.category_id ? db("raw_material_categories").where({ id: material.category_id }).first() : null,
    db("financial_accounts"),
    db("raw_material_stocks")
      .where({ material_id: material.id })
      .modify((query) => {
        if (outletId && outletId !== "all") query.where({ outlet_id: outletId });
      }),
    db("product_compositions").where({ material_id: material.id }).count({ count: "id" }).first()
  ]);
  const outletIds = [...new Set(stockRows.map((stock) => stock.outlet_id).filter(Boolean))];
  const outlets = outletIds.length ? await db("outlets").whereIn("id", outletIds) : [];
  const outletById = new Map(outlets.map((outlet) => [outlet.id, outlet]));
  const accountByCode = new Map(accountRows.map((account) => [account.code, account]));
  const accountCode = material.account_code || category?.account_code || (material.type === "biaya" ? "6000" : "5002");
  const stocks = stockRows.map((stock) => ({
    ...stock,
    outlet: outletById.get(stock.outlet_id) || null
  }));

  return {
    ...material,
    category: category || null,
    type: material.type || category?.type || "hpp",
    account_code: accountCode,
    account: accountByCode.get(accountCode) || null,
    stocks,
    total_stock: stocks.reduce((total, stock) => total + Number(stock.quantity || 0), 0),
    stock_value: stocks.reduce((total, stock) => total + Number(stock.stock_value || 0), 0),
    outlet_count: stocks.length,
    composition_count: Number(compositionCount?.count || 0)
  };
}

async function createMaterial(payload = {}) {
  const categoryFallback = payload.type ? await db("raw_material_categories").where({ type: payload.type }).first() : null;
  const row = normalizeMaterialPayload(payload, {
    category_id: categoryFallback?.id || null,
    type: categoryFallback?.type || "hpp"
  });
  const category = await requireMaterialCategory(row.category_id);
  if (category.type !== row.type) {
    const error = new Error("Kategori Harga Pokok Produksi tidak sesuai dengan type yang dipilih.");
    error.status = 422;
    error.code = "MATERIAL_CATEGORY_TYPE_MISMATCH";
    throw error;
  }
  const accountCode = String(category.account_code || (row.type === "biaya" ? "6000" : "5002")).trim();
  await requireFinancialAccountByCode(accountCode, [row.type === "biaya" ? "expense" : "cogs"]);
  const duplicate = await db("raw_materials").whereRaw("LOWER(name) = ?", [row.name.toLowerCase()]).first();
  if (duplicate) {
    const error = new Error("Nama harga pokok produksi sudah digunakan.");
    error.status = 422;
    error.code = "MATERIAL_DUPLICATE";
    throw error;
  }

  const id = payload.id || createRuntimeId("material");
  await db("raw_materials").insert({ id, ...row, account_code: accountCode });
  await writeDbActivityLog({
    actor_user_id: payload.created_by || payload.createdBy || null,
    source: "admin_web",
    module: "material",
    action: "material/create",
    entity_type: "raw_material",
    entity_id: id,
    description: `Harga Pokok Produksi ${row.name} dibuat.`,
    metadata_json: {
      type: row.type,
      category_id: row.category_id,
      account_code: accountCode,
      unit: row.unit,
      status: row.status
    }
  });
  return materialWithUsage(id);
}

async function updateMaterial(materialId, payload = {}) {
  const current = await requireMaterial(materialId);
  const row = normalizeMaterialPayload(payload, current);
  const category = await requireMaterialCategory(row.category_id);
  if (category.type !== row.type) {
    const error = new Error("Kategori Harga Pokok Produksi tidak sesuai dengan type yang dipilih.");
    error.status = 422;
    error.code = "MATERIAL_CATEGORY_TYPE_MISMATCH";
    throw error;
  }
  const accountCode = String(category.account_code || (row.type === "biaya" ? "6000" : "5002")).trim();
  await requireFinancialAccountByCode(accountCode, [row.type === "biaya" ? "expense" : "cogs"]);
  const duplicate = await db("raw_materials").whereRaw("LOWER(name) = ?", [row.name.toLowerCase()]).whereNot({ id: materialId }).first();
  if (duplicate) {
    const error = new Error("Nama harga pokok produksi sudah digunakan.");
    error.status = 422;
    error.code = "MATERIAL_DUPLICATE";
    throw error;
  }

  await db.transaction(async (trx) => {
    await trx("raw_materials")
      .where({ id: materialId })
      .update({ ...row, account_code: accountCode });
    if (row.unit !== current.unit) {
      await trx("raw_material_stocks").where({ material_id: materialId }).update({ unit: row.unit });
      await trx("product_compositions").where({ material_id: materialId }).update({ unit: row.unit });
    }
  });
  await writeDbActivityLog({
    actor_user_id: payload.updated_by || payload.updatedBy || null,
    source: "admin_web",
    module: "material",
    action: "material/update",
    entity_type: "raw_material",
    entity_id: materialId,
    description: `Harga Pokok Produksi ${row.name} diperbarui.`,
    metadata_json: {
      type: row.type,
      category_id: row.category_id,
      account_code: accountCode,
      unit: row.unit,
      status: row.status
    }
  });
  return materialWithUsage(materialId);
}

async function toggleMaterialStatus(materialId, actorUserId = null) {
  const material = await requireMaterial(materialId);
  const nextStatus = material.status === "active" ? "inactive" : "active";
  await db("raw_materials").where({ id: materialId }).update({ status: nextStatus });
  await writeDbActivityLog({
    actor_user_id: actorUserId,
    source: "admin_web",
    module: "material",
    action: "material/toggle_status",
    entity_type: "raw_material",
    entity_id: materialId,
    description: `Status Harga Pokok Produksi ${material.name} menjadi ${nextStatus}.`,
    metadata_json: {
      type: material.type || "hpp",
      previous_status: material.status,
      next_status: nextStatus
    }
  });
  return materialWithUsage(materialId);
}

async function requireUnit(unitId) {
  const unit = await db("units").where({ id: unitId }).first();
  if (!unit) {
    const error = new Error("Unit tidak ditemukan.");
    error.status = 404;
    error.code = "UNIT_NOT_FOUND";
    throw error;
  }
  return unit;
}

function normalizeUnitPayload(payload = {}, fallbackSortOrder = 0) {
  const name = String(payload.name || "").trim();
  const code = String(payload.code || name).trim();
  if (!name || !code) {
    const error = new Error("Nama dan kode unit wajib diisi.");
    error.status = 422;
    error.code = "UNIT_INVALID";
    throw error;
  }
  return {
    name,
    code,
    sort_order: Number(payload.sort_order ?? payload.sortOrder ?? fallbackSortOrder ?? 0) || 0,
    status: payload.status === "inactive" ? "inactive" : "active"
  };
}

async function unitWithUsage(unitId) {
  const unit = await requireUnit(unitId);
  const [{ count }] = await db("raw_materials").where({ unit: unit.code }).count({ count: "id" });
  return { ...unit, material_count: Number(count || 0) };
}

async function createUnit(payload = {}) {
  const maxRow = await db("units").max({ max: "sort_order" }).first();
  const row = normalizeUnitPayload(payload, Number(maxRow?.max || 0) + 1);
  const duplicate = await db("units").whereRaw("LOWER(code) = ?", [row.code.toLowerCase()]).first();
  if (duplicate) {
    const error = new Error("Kode unit sudah digunakan.");
    error.status = 422;
    error.code = "UNIT_CODE_DUPLICATE";
    throw error;
  }
  const id = payload.id || createRuntimeId("unit");
  await db("units").insert({ id, ...row });
  await writeDbActivityLog({
    actor_user_id: payload.created_by || payload.createdBy || null,
    source: "admin_web",
    module: "unit",
    action: "unit/create",
    entity_type: "unit",
    entity_id: id,
    description: `Unit ${row.name} dibuat.`,
    metadata_json: { code: row.code, status: row.status }
  });
  return unitWithUsage(id);
}

async function updateUnit(unitId, payload = {}) {
  const current = await requireUnit(unitId);
  const row = normalizeUnitPayload(payload, current.sort_order || 0);
  const duplicate = await db("units").whereRaw("LOWER(code) = ?", [row.code.toLowerCase()]).whereNot({ id: unitId }).first();
  if (duplicate) {
    const error = new Error("Kode unit sudah digunakan.");
    error.status = 422;
    error.code = "UNIT_CODE_DUPLICATE";
    throw error;
  }
  await db.transaction(async (trx) => {
    await trx("units").where({ id: unitId }).update(row);
    if (current.code !== row.code) {
      await trx("raw_materials").where({ unit: current.code }).update({ unit: row.code });
      await trx("raw_material_stocks").where({ unit: current.code }).update({ unit: row.code });
      await trx("product_compositions").where({ unit: current.code }).update({ unit: row.code });
    }
  });
  await writeDbActivityLog({
    actor_user_id: payload.updated_by || payload.updatedBy || null,
    source: "admin_web",
    module: "unit",
    action: "unit/update",
    entity_type: "unit",
    entity_id: unitId,
    description: `Unit ${row.name} diperbarui.`,
    metadata_json: {
      previous_code: current.code,
      code: row.code,
      status: row.status
    }
  });
  return unitWithUsage(unitId);
}

async function toggleUnitStatus(unitId, actorUserId = null) {
  const unit = await requireUnit(unitId);
  const nextStatus = unit.status === "active" ? "inactive" : "active";
  await db("units").where({ id: unitId }).update({ status: nextStatus });
  await writeDbActivityLog({
    actor_user_id: actorUserId,
    source: "admin_web",
    module: "unit",
    action: "unit/toggle_status",
    entity_type: "unit",
    entity_id: unitId,
    description: `Status unit ${unit.name} menjadi ${nextStatus}.`,
    metadata_json: {
      code: unit.code,
      previous_status: unit.status,
      next_status: nextStatus
    }
  });
  return unitWithUsage(unitId);
}

async function requireFinancialAccount(accountId) {
  const account = await db("financial_accounts").where({ id: accountId }).first();
  if (!account) {
    const error = new Error("Akun laporan tidak ditemukan.");
    error.status = 404;
    error.code = "FINANCIAL_ACCOUNT_NOT_FOUND";
    throw error;
  }
  return account;
}

function normalizeFinancialAccountPayload(payload = {}, fallbackSortOrder = 0) {
  const code = String(payload.code || "").trim();
  const name = String(payload.name || "").trim();
  const reportGroup = String(payload.report_group || payload.reportGroup || "").trim();
  const normalBalance = String(payload.normal_balance || payload.normalBalance || "debit").trim();
  const sortOrder = Number(payload.sort_order ?? payload.sortOrder ?? fallbackSortOrder ?? 0);
  const status = payload.status === "inactive" ? "inactive" : "active";
  if (!code || !name || !financialAccountGroups.has(reportGroup) || !Number.isFinite(sortOrder) || sortOrder <= 0) {
    const error = new Error("Kode, nama, group laporan, dan urutan akun wajib valid.");
    error.status = 422;
    error.code = "FINANCIAL_ACCOUNT_INVALID";
    throw error;
  }
  if (!["debit", "credit"].includes(normalBalance)) {
    const error = new Error("Normal balance akun tidak valid.");
    error.status = 422;
    error.code = "FINANCIAL_ACCOUNT_NORMAL_BALANCE_INVALID";
    throw error;
  }
  return {
    code,
    name,
    report_group: reportGroup,
    normal_balance: normalBalance,
    sort_order: sortOrder,
    status
  };
}

async function createFinancialAccount(payload = {}) {
  const maxRow = await db("financial_accounts").max({ max: "sort_order" }).first();
  const row = normalizeFinancialAccountPayload(payload, Number(maxRow?.max || 0) + 1);
  const duplicate = await db("financial_accounts").where({ code: row.code }).first();
  if (duplicate) {
    const error = new Error("Kode akun sudah digunakan.");
    error.status = 422;
    error.code = "FINANCIAL_ACCOUNT_CODE_DUPLICATE";
    throw error;
  }
  const id = payload.id || createRuntimeId("account");
  await db("financial_accounts").insert({ id, ...row });
  await writeDbActivityLog({
    actor_user_id: payload.created_by || payload.createdBy || null,
    source: "admin_web",
    module: "finance",
    action: "financial_account/create",
    entity_type: "financial_account",
    entity_id: id,
    description: `Akun laporan [${row.code}] ${row.name} dibuat.`,
    metadata_json: {
      code: row.code,
      report_group: row.report_group,
      normal_balance: row.normal_balance
    }
  });
  return requireFinancialAccount(id);
}

async function updateFinancialAccount(id, payload = {}) {
  const current = await requireFinancialAccount(id);
  const row = normalizeFinancialAccountPayload(payload, current.sort_order);
  const duplicate = await db("financial_accounts").where({ code: row.code }).whereNot({ id }).first();
  if (duplicate) {
    const error = new Error("Kode akun sudah digunakan.");
    error.status = 422;
    error.code = "FINANCIAL_ACCOUNT_CODE_DUPLICATE";
    throw error;
  }
  await db("financial_accounts").where({ id }).update(row);
  await writeDbActivityLog({
    actor_user_id: payload.updated_by || payload.updatedBy || null,
    source: "admin_web",
    module: "finance",
    action: "financial_account/update",
    entity_type: "financial_account",
    entity_id: id,
    description: `Akun laporan [${row.code}] ${row.name} diperbarui.`,
    metadata_json: {
      previous_code: current.code,
      code: row.code,
      report_group: row.report_group,
      normal_balance: row.normal_balance,
      status: row.status
    }
  });
  return requireFinancialAccount(id);
}

async function toggleFinancialAccountStatus(id, actorUserId = null) {
  const account = await requireFinancialAccount(id);
  const nextStatus = account.status === "inactive" ? "active" : "inactive";
  await db("financial_accounts").where({ id }).update({ status: nextStatus });
  await writeDbActivityLog({
    actor_user_id: actorUserId,
    source: "admin_web",
    module: "finance",
    action: "financial_account/toggle_status",
    entity_type: "financial_account",
    entity_id: id,
    description: `Status akun laporan [${account.code}] ${account.name} menjadi ${nextStatus}.`,
    metadata_json: {
      code: account.code,
      previous_status: account.status,
      next_status: nextStatus
    }
  });
  return requireFinancialAccount(id);
}

const financeEntryAllowedGroups = new Set(["other_income", "other_expense", "reserve_fund", "other_current_asset", "fixed_asset", "moving_asset", "liability", "equity"]);

function financeEntryGroupKey(row = {}) {
  return `${String(row.name || "")
    .trim()
    .toLowerCase()}::${String(row.account_code || "").trim()}::${row.outlet_id || "global"}`;
}

async function requireOutletIfPresent(outletId) {
  if (!outletId || outletId === "all") return null;
  const outlet = await db("outlets").where({ id: outletId }).first();
  if (!outlet) throw new Error("Outlet tidak ditemukan.");
  return outlet;
}

async function requireFinanceAccountByCode(accountCode) {
  const code = String(accountCode || "").trim();
  const account = code ? await db("financial_accounts").where({ code }).first() : null;
  if (!account) throw new Error("Akun laporan tidak ditemukan.");
  return account;
}

async function financeGroupRows(outletId = "all") {
  const master = await getMasterData({ outletId });
  return master.finance_entry_groups || [];
}

async function financeEntryRows(outletId = "all") {
  const master = await getMasterData({ outletId });
  return master.finance_entries || [];
}

async function reserveFundRows(outletId = "all") {
  const master = await getMasterData({ outletId });
  return master.reserve_funds || [];
}

async function normalizeFinanceEntryGroupPayloadDb(payload = {}, groupId = null) {
  const name = String(payload.name || "").trim();
  const accountCode = String(payload.account_code || payload.accountCode || "").trim();
  const account = await requireFinanceAccountByCode(accountCode);
  const group = account.report_group || String(payload.group || "").trim();
  const outletId = payload.outlet_id && payload.outlet_id !== "all" ? String(payload.outlet_id) : null;
  const note = String(payload.note || "").trim();
  const status = payload.status === "inactive" ? "inactive" : "active";

  if (!name || !financeEntryAllowedGroups.has(group)) throw new Error("Nama pos, akun laporan, dan group Pos Keuangan wajib valid.");
  await requireOutletIfPresent(outletId);
  const duplicate = await db("finance_entry_groups")
    .whereRaw("LOWER(name) = ?", [name.toLowerCase()])
    .where({ account_code: accountCode })
    .modify((query) => (outletId ? query.where({ outlet_id: outletId }) : query.whereNull("outlet_id")))
    .whereNot({ id: groupId || "" })
    .first();
  if (
    duplicate &&
    financeEntryGroupKey(duplicate) ===
      financeEntryGroupKey({
        name,
        account_code: accountCode,
        outlet_id: outletId
      })
  ) {
    throw new Error("Pos Keuangan dengan nama, akun, dan outlet yang sama sudah ada.");
  }
  return {
    name,
    account_code: accountCode,
    group,
    outlet_id: outletId,
    note,
    status
  };
}

async function createFinanceEntryGroup(payload = {}) {
  const row = await normalizeFinanceEntryGroupPayloadDb(payload);
  const id = payload.id || createRuntimeId("finance_group");
  await db("finance_entry_groups").insert({
    id,
    ...row,
    created_at: new Date()
  });
  await writeDbActivityLog({
    actor_user_id: payload.created_by || payload.createdBy || null,
    outlet_id: row.outlet_id,
    module: "finance_group",
    action: "create",
    entity_type: "finance_group",
    entity_id: id,
    description: `Pos Keuangan ${row.name} dibuat.`,
    metadata_json: {
      account_code: row.account_code,
      group: row.group,
      outlet_id: row.outlet_id
    }
  });
  return (await financeGroupRows(row.outlet_id || "all")).find((item) => item.id === id);
}

async function updateFinanceEntryGroup(groupId, payload = {}) {
  const current = await db("finance_entry_groups").where({ id: groupId }).first();
  if (!current) throw new Error("Pos Keuangan tidak ditemukan.");
  const row = await normalizeFinanceEntryGroupPayloadDb(payload, groupId);
  await db.transaction(async (trx) => {
    await trx("finance_entry_groups")
      .where({ id: groupId })
      .update({ ...row, updated_at: new Date() });
    await trx("balance_sheet_entries").where({ finance_group_id: groupId }).update({
      name: row.name,
      account_code: row.account_code,
      group: row.group,
      outlet_id: row.outlet_id
    });
  });
  await writeDbActivityLog({
    actor_user_id: payload.updated_by || payload.updatedBy || null,
    outlet_id: row.outlet_id,
    module: "finance_group",
    action: "update",
    entity_type: "finance_group",
    entity_id: groupId,
    description: `Pos Keuangan ${row.name} dikoreksi.`,
    metadata_json: { previous: current, next: row }
  });
  return (await financeGroupRows(row.outlet_id || "all")).find((item) => item.id === groupId);
}

async function toggleFinanceEntryGroupStatus(groupId, actorUserId = null) {
  const current = await db("finance_entry_groups").where({ id: groupId }).first();
  if (!current) throw new Error("Pos Keuangan tidak ditemukan.");
  const status = current.status === "active" ? "inactive" : "active";
  await db("finance_entry_groups").where({ id: groupId }).update({ status, updated_at: new Date() });
  await writeDbActivityLog({
    actor_user_id: actorUserId,
    outlet_id: current.outlet_id,
    module: "finance_group",
    action: "toggle_status",
    entity_type: "finance_group",
    entity_id: groupId,
    description: `Status Pos Keuangan ${current.name} menjadi ${status}.`,
    metadata_json: { previous_status: current.status, status }
  });
  return (await financeGroupRows(current.outlet_id || "all")).find((item) => item.id === groupId);
}

async function findOrCreateFinanceEntryGroupDb(entryPayload, actorUserId = null) {
  if (entryPayload.finance_group_id) {
    const group = await db("finance_entry_groups").where({ id: entryPayload.finance_group_id }).first();
    if (!group) throw new Error("Pos Keuangan tidak ditemukan.");
    if (group.status === "inactive") throw new Error("Pos Keuangan inactive tidak bisa dipakai untuk transaksi baru.");
    return group;
  }
  const groupPayload = await normalizeFinanceEntryGroupPayloadDb(entryPayload);
  const existing = await db("finance_entry_groups")
    .whereRaw("LOWER(name) = ?", [groupPayload.name.toLowerCase()])
    .where({ account_code: groupPayload.account_code })
    .modify((query) => (groupPayload.outlet_id ? query.where({ outlet_id: groupPayload.outlet_id }) : query.whereNull("outlet_id")))
    .first();
  if (existing) return existing;
  const created = await createFinanceEntryGroup({
    ...groupPayload,
    created_by: actorUserId
  });
  return db("finance_entry_groups").where({ id: created.id }).first();
}

async function normalizeFinanceEntryPayloadDb(payload = {}, entryId = null) {
  const existing = entryId ? await db("balance_sheet_entries").where({ id: entryId }).first() : null;
  const financeGroupId = String(payload.finance_group_id || payload.financeGroupId || existing?.finance_group_id || "").trim();
  const financeGroup = financeGroupId ? await db("finance_entry_groups").where({ id: financeGroupId }).first() : null;
  if (financeGroupId && !financeGroup) throw new Error("Pos Keuangan tidak ditemukan.");
  const requestedGroup = String(payload.group || financeGroup?.group || existing?.group || "").trim();
  const accountCode = String(financeGroup?.account_code || payload.account_code || payload.accountCode || existing?.account_code || (requestedGroup === "reserve_fund" ? "1431" : "")).trim();
  const account = await requireFinanceAccountByCode(accountCode);
  const group = account.report_group || requestedGroup;
  const name = String(financeGroup?.name || payload.name || existing?.name || "").trim();
  const amount = Math.round(Number(payload.amount ?? existing?.amount ?? 0));
  const entryDate = dateOnly(payload.entry_date || payload.entryDate || existing?.entry_date || new Date());
  const outletId = financeGroup ? financeGroup.outlet_id || null : payload.outlet_id && payload.outlet_id !== "all" ? String(payload.outlet_id) : existing?.outlet_id || null;
  const movementType = String(payload.movement_type || payload.movementType || existing?.movement_type || "in").trim();
  const note = String(payload.note ?? existing?.note ?? "").trim();
  const status = payload.status === "inactive" ? "inactive" : "active";
  if (!name || !financeEntryAllowedGroups.has(group)) throw new Error("Nama, group, dan akun transaksi keuangan wajib valid.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Nominal transaksi keuangan wajib lebih dari 0.");
  if (!["in", "out"].includes(movementType)) throw new Error("Arah saldo transaksi keuangan tidak valid.");
  await requireOutletIfPresent(outletId);
  return {
    finance_group_id: financeGroup?.id || financeGroupId || null,
    account_code: accountCode,
    name,
    group,
    movement_type: movementType,
    amount,
    entry_date: entryDate,
    outlet_id: outletId,
    note,
    status
  };
}

async function createFinanceEntry(payload = {}) {
  const actorUserId = payload.created_by || payload.createdBy || null;
  const normalized = await normalizeFinanceEntryPayloadDb(payload);
  const group = await findOrCreateFinanceEntryGroupDb(normalized, actorUserId);
  const row = {
    id: payload.id || createRuntimeId("finance_entry"),
    ...normalized,
    finance_group_id: group.id
  };
  await db("balance_sheet_entries").insert(row);
  await writeDbActivityLog({
    actor_user_id: actorUserId,
    outlet_id: row.outlet_id,
    module: "finance_transaction",
    action: "create",
    entity_type: "finance_transaction",
    entity_id: row.id,
    description: `Transaksi keuangan ${row.name} dibuat.`,
    metadata_json: {
      finance_group_id: row.finance_group_id,
      account_code: row.account_code,
      movement_type: row.movement_type,
      amount: row.amount,
      entry_date: row.entry_date
    }
  });
  return (await financeEntryRows(row.outlet_id || "all")).find((item) => item.id === row.id);
}

async function updateFinanceEntry(entryId, payload = {}) {
  const current = await db("balance_sheet_entries").where({ id: entryId }).first();
  if (!current) throw new Error("Transaksi keuangan tidak ditemukan.");
  const normalized = await normalizeFinanceEntryPayloadDb(payload, entryId);
  const group = await findOrCreateFinanceEntryGroupDb(normalized, payload.updated_by || payload.updatedBy || null);
  const row = { ...normalized, finance_group_id: group.id };
  await db("balance_sheet_entries").where({ id: entryId }).update(row);
  await writeDbActivityLog({
    actor_user_id: payload.updated_by || payload.updatedBy || null,
    outlet_id: row.outlet_id,
    module: "finance_transaction",
    action: "update",
    entity_type: "finance_transaction",
    entity_id: entryId,
    description: `Transaksi keuangan ${row.name} dikoreksi.`,
    metadata_json: { previous: current, next: row }
  });
  return (await financeEntryRows(row.outlet_id || "all")).find((item) => item.id === entryId);
}

async function toggleFinanceEntryStatus(entryId, actorUserId = null) {
  const current = await db("balance_sheet_entries").where({ id: entryId }).first();
  if (!current) throw new Error("Transaksi keuangan tidak ditemukan.");
  const status = current.status === "active" ? "inactive" : "active";
  await db("balance_sheet_entries").where({ id: entryId }).update({ status });
  await writeDbActivityLog({
    actor_user_id: actorUserId,
    outlet_id: current.outlet_id,
    module: "finance_transaction",
    action: "toggle_status",
    entity_type: "finance_transaction",
    entity_id: entryId,
    description: `Status transaksi keuangan ${current.name} menjadi ${status}.`,
    metadata_json: {
      finance_group_id: current.finance_group_id,
      previous_status: current.status,
      status
    }
  });
  return (await financeEntryRows(current.outlet_id || "all")).find((item) => item.id === entryId);
}

async function createReserveFund(payload = {}) {
  const entry = await createFinanceEntry({
    ...payload,
    group: "reserve_fund",
    account_code: payload.account_code || payload.accountCode || "1431"
  });
  return (await reserveFundRows(entry.outlet_id || "all")).find((item) => item.id === entry.id) || entry;
}

async function updateReserveFund(entryId, payload = {}) {
  const entry = await updateFinanceEntry(entryId, {
    ...payload,
    group: "reserve_fund",
    account_code: payload.account_code || payload.accountCode || "1431"
  });
  return (await reserveFundRows(entry.outlet_id || "all")).find((item) => item.id === entry.id) || entry;
}

async function toggleReserveFundStatus(entryId, actorUserId = null) {
  const entry = await toggleFinanceEntryStatus(entryId, actorUserId);
  return (await reserveFundRows(entry.outlet_id || "all")).find((item) => item.id === entry.id) || entry;
}

async function mockGetMasterData() {
  const financialAccounts = mockData.financial_accounts || [];
  const accountByCode = new Map(financialAccounts.map((account) => [account.code, account]));
  const attachAccount = (row) => ({
    ...row,
    account: row.account_code ? accountByCode.get(row.account_code) || null : null
  });
  const financeEntries = (mockData.balance_sheet_entries || []).map((entry) => ({
    ...entry,
    group: accountByCode.get(entry.account_code)?.report_group || entry.group,
    account: entry.account_code ? accountByCode.get(entry.account_code) || null : null
  }));
  const outletById = new Map((mockData.outlets || []).map((outlet) => [outlet.id, outlet]));
  const financeEntryGroupMap = new Map();
  financeEntries.forEach((entry) => {
    const groupId =
      entry.finance_group_id ||
      `${String(entry.name || "")
        .trim()
        .toLowerCase()}::${entry.account_code || ""}::${entry.outlet_id || "global"}`;
    const existing = financeEntryGroupMap.get(groupId) || {
      id: entry.finance_group_id || groupId,
      name: entry.name,
      account_code: entry.account_code,
      group: entry.group,
      outlet_id: entry.outlet_id || null,
      note: "",
      status: "active",
      account: entry.account,
      outlet: entry.outlet_id ? outletById.get(entry.outlet_id) || null : null,
      total_in: 0,
      total_out: 0,
      balance: 0,
      transaction_count: 0,
      active_transaction_count: 0,
      last_transaction: null,
      transactions: []
    };
    existing.transactions.push(entry);
    existing.transaction_count += 1;
    if (entry.status !== "inactive") {
      existing.active_transaction_count += 1;
      if ((entry.movement_type || "in") === "out") existing.total_out += Number(entry.amount || 0);
      else existing.total_in += Number(entry.amount || 0);
    }
    existing.balance = existing.total_in - existing.total_out;
    if (!existing.last_transaction || String(entry.entry_date || "") > String(existing.last_transaction.entry_date || "")) {
      existing.last_transaction = entry;
    }
    financeEntryGroupMap.set(groupId, existing);
  });
  const isReserveFundEntry = (entry) => {
    const account = accountByCode.get(entry.account_code);
    return Boolean(account && (String(account.code) === "1431" || /dana cadangan/i.test(String(account.name || ""))));
  };

  return {
    outlets: mockData.outlets,
    users: mockData.users.map((user) => sanitizeUserForAdmin(user, user.outlet_ids || [], { mockFallback: true })),
    roles: mockData.roles.map(normalizeRole),
    customers: mockData.customers,
    categories: mockData.categories,
    products: mockData.products,
    product_prices: mockData.product_prices,
    raw_materials: (mockData.raw_materials || []).map(attachAccount),
    materials: (mockData.raw_materials || []).map(attachAccount),
    product_compositions: mockData.product_compositions,
    suppliers: mockData.suppliers,
    tables: mockData.tables || [],
    expense_categories: (mockData.expense_categories || []).map(attachAccount),
    raw_material_categories: (mockData.raw_material_categories || []).map(attachAccount),
    payment_methods: (mockData.payment_methods || []).map(attachAccount),
    financial_accounts: financialAccounts,
    finance_entry_groups: [...financeEntryGroupMap.values()],
    finance_entries: financeEntries,
    reserve_funds: financeEntries.filter(isReserveFundEntry),
    reserve_fund_summary: [],
    discounts: attachDiscountOutlets(mockData.discounts || [], mockData.discount_outlets || [])
  };
}

async function getInventory({ outletId = "all" } = {}) {
  const [stocks, purchases, transfers, opnames, transactions, transactionItems, compositions, materials, outlets, refunds, suppliers, users] = await Promise.all([db("raw_material_stocks"), fetchPurchaseRows({ outletId }), fetchTransferRows({ outletId }), db("stock_opnames"), db("transactions"), db("transaction_items"), db("product_compositions"), db("raw_materials"), db("outlets"), db("transaction_refunds").catch(() => []), db("suppliers"), db("users").select("id", "name", "username")]);
  const outletById = new Map(outlets.map((outlet) => [outlet.id, outlet]));
  const activeMaterials = materials.filter((material) => material.status !== "inactive");
  const activeOutlets = outlets.filter((outlet) => outlet.status !== "inactive");
  const visibleOutlets = outletId === "all" ? activeOutlets : activeOutlets.filter((outlet) => outlet.id === outletId);
  const stockByOutletAndMaterial = new Map(stocks.map((stock) => [`${stock.outlet_id}::${stock.material_id}`, stock]));

  function stockStatus(quantity, material) {
    const currentQuantity = Number(quantity || 0);
    const threshold = Number(material?.low_stock_threshold || 0);
    if (currentQuantity <= 0) return "out_of_stock";
    if (threshold > 0 && currentQuantity <= threshold) return "low_stock";
    return "normal";
  }

  function buildStockRow(outlet, material) {
    const stock = stockByOutletAndMaterial.get(`${outlet.id}::${material.id}`) || {};
    const quantity = Number(stock.quantity || 0);
    const lastPurchasePrice = Number(stock.last_purchase_price ?? material.last_purchase_price ?? 0);
    return {
      id: stock.id || `stock_${outlet.id}_${material.id}`,
      outlet_id: outlet.id,
      material_id: material.id,
      quantity,
      unit: stock.unit || material.unit || "",
      last_purchase_price: lastPurchasePrice,
      last_purchase_date: stock.last_purchase_date || material.last_purchase_date || null,
      stock_value: stock.stock_value == null ? Math.round(quantity * lastPurchasePrice) : Number(stock.stock_value || 0),
      status: stockStatus(quantity, material),
      outlet,
      material
    };
  }

  const allStockRows = activeOutlets.flatMap((outlet) => activeMaterials.map((material) => buildStockRow(outlet, material)));
  const visibleStockRows = visibleOutlets.flatMap((outlet) => activeMaterials.map((material) => buildStockRow(outlet, material)));

  return {
    stocks: visibleStockRows,
    all_stocks: allStockRows,
    materials: activeMaterials,
    outlets: activeOutlets,
    users,
    suppliers: suppliers.filter((supplier) => supplier.status !== "inactive"),
    purchases,
    transfers,
    opnames,
    stock_movements: buildStockMovementRows({
      transactions,
      transactionItems,
      compositions,
      materials,
      refunds,
      outletId
    })
  };
}

async function mockGetInventory() {
  return {
    stocks: mockData.raw_material_stocks,
    purchases: mockData.purchases,
    transfers: mockData.stock_transfers,
    opnames: mockData.stock_opnames,
    stock_movements: buildStockMovementRows({
      transactions: mockData.transactions || [],
      transactionItems: mockData.transaction_items || [],
      compositions: mockData.product_compositions || [],
      materials: mockData.raw_materials || [],
      refunds: mockData.transaction_refunds || []
    })
  };
}

async function getReports({ outletId = "all", from, to } = {}) {
  const defaultRange = getDefaultReportRange();
  const dateFrom = from || defaultRange.from;
  const dateTo = to || defaultRange.to;
  const transactionDateExpression = await reportDateExpression("t", "transactions", "transaction_date");
  const expenseDateExpression = await reportDateExpression("e", "expenses", "expense_date");

  const [transactions, refunds, users, expenses, purchases, snapshots] = await Promise.all([
    db("transactions as t")
      .leftJoin("outlets as outlet", "t.outlet_id", "outlet.id")
      .select("t.*", db.raw("outlet.name as outlet_name"), db.raw("outlet.code as outlet_code"))
      .modify((query) => {
        if (outletId && outletId !== "all") query.where("t.outlet_id", outletId);
        applyDateRangeExpression(query, transactionDateExpression, dateFrom, dateTo);
      })
      .orderByRaw(`${transactionDateExpression} desc`)
      .orderBy("t.id", "desc"),
    db("transaction_refunds").catch(() => []),
    db("users").select("id", "name"),
    db("expenses as e")
      .leftJoin("outlets as outlet", "e.outlet_id", "outlet.id")
      .leftJoin("users as created_user", "e.created_by", "created_user.id")
      .leftJoin("users as corrected_user", "e.corrected_by", "corrected_user.id")
      .leftJoin("users as approved_user", "e.approved_by", "approved_user.id")
      .leftJoin("users as rejected_user", "e.rejected_by", "rejected_user.id")
      .select("e.*", db.raw("outlet.name as outlet_name"), db.raw("created_user.name as created_by_name"), db.raw("corrected_user.name as corrected_by_name"), db.raw("approved_user.name as approved_by_name"), db.raw("rejected_user.name as rejected_by_name"))
      .modify((query) => {
        if (outletId && outletId !== "all") query.where("e.outlet_id", outletId);
        applyDateRangeExpression(query, expenseDateExpression, dateFrom, dateTo);
      })
      .orderByRaw(`${expenseDateExpression} desc`)
      .orderBy("e.id", "desc"),
    fetchPurchaseRows({ outletId, from: dateFrom, to: dateTo }),
    db("report_snapshots")
  ]);
  const transactionIds = transactions.map((transaction) => transaction.id);
  const [transactionItems, payments] = transactionIds.length ? await Promise.all([db("transaction_items").whereIn("transaction_id", transactionIds), db("payments").whereIn("transaction_id", transactionIds)]) : [[], []];
  const paymentsByTransaction = payments.reduce((result, payment) => {
    result[payment.transaction_id] = result[payment.transaction_id] || [];
    result[payment.transaction_id].push(payment);
    return result;
  }, {});
  const userById = new Map(users.map((user) => [user.id, user]));
  const normalizedTransactions = transactions.map((transaction) => ({
    ...transaction,
    outlet: transaction.outlet_id
      ? {
          id: transaction.outlet_id,
          name: transaction.outlet_name || transaction.outlet_id,
          code: transaction.outlet_code || undefined
        }
      : null,
    items: transactionItems.filter((item) => item.transaction_id === transaction.id),
    payment: paymentsByTransaction[transaction.id]?.[0] || null,
    payments: paymentsByTransaction[transaction.id] || [],
    refund: (() => {
      const refund = refunds.find((item) => item.transaction_id === transaction.id);
      return refund
        ? {
            ...refund,
            refunded_by_user: userById.get(refund.refunded_by) || null
          }
        : null;
    })(),
    cancelled_by_user: transaction.cancelled_by ? userById.get(transaction.cancelled_by) || null : null,
    updated_by_user: transaction.updated_by ? userById.get(transaction.updated_by) || null : null
  }));
  const normalizedExpenses = expenses.map(normalizeExpenseRow);
  const paidTransactions = normalizedTransactions.filter((transaction) => (transaction.status || "paid") === "paid");
  const approvedExpenses = normalizedExpenses.filter((expense) => (expense.status || "approved") === "approved");
  const approvedPurchases = purchases.filter((purchase) => (purchase.status || "pending") === "approved");
  const accountingProfitLoss = buildSimpleAccountingProfitLoss({
    rows: paidTransactions,
    approvedPurchases,
    approvedExpenses,
    from: dateFrom,
    to: dateTo,
    outletId
  });
  const accountingBalanceSheet = await buildBalanceSheetReportDb({
    outletId,
    netIncome: accountingProfitLoss.summary.net_income,
    date: dateTo
  });
  const revenue = Number(accountingProfitLoss.summary.income || 0);
  const cogsEstimate = Number(accountingProfitLoss.summary.cogs || 0);
  const expensesTotal = Number(accountingProfitLoss.summary.expense || 0);

  return {
    transactions: normalizedTransactions,
    expenses: normalizedExpenses,
    purchases,
    sales_by_day: buildDailySales(paidTransactions, dateFrom, dateTo),
    expenses_by_day: buildDailyExpenses(approvedExpenses, dateFrom, dateTo),
    profit_loss: {
      revenue,
      cogs_estimate: cogsEstimate,
      expenses: expensesTotal,
      gross_profit: revenue - cogsEstimate,
      net_profit: revenue - cogsEstimate - expensesTotal
    },
    balance_sheet: {
      assets: accountingBalanceSheet.summary.assets,
      liabilities: accountingBalanceSheet.summary.liabilities,
      equity: accountingBalanceSheet.summary.equity
    },
    accounting_profit_loss: accountingProfitLoss,
    accounting_balance_sheet: accountingBalanceSheet,
    report_snapshots: Object.fromEntries(snapshots.map((row) => [row.key, parseJson(row.payload, {})]))
  };
}

async function mockGetReports() {
  return {
    transactions: mockData.transactions.map((transaction) => ({
      ...transaction,
      items: mockData.transaction_items.filter((item) => item.transaction_id === transaction.id),
      payment: mockData.payments.find((payment) => payment.transaction_id === transaction.id) || null
    })),
    expenses: mockData.expenses,
    purchases: mockData.purchases,
    report_snapshots: mockData.report_snapshots || {}
  };
}

function getDefaultReportRange() {
  const today = new Date();
  return {
    from: dateOnly(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: dateOnly(today)
  };
}

const accountDetailSourceLabels = {
  sales: "Penjualan",
  discount: "Diskon",
  purchase_hpp: "Pembelian HPP",
  purchase_biaya: "Pembelian Biaya Produksi",
  expense: "Pengeluaran",
  finance_entry: "Entry Keuangan",
  payment: "Payment",
  inventory: "Stok Inventory",
  purchase_bon: "Bon Pembelian"
};

function applyDateRange(query, column, from, to) {
  if (from) query.whereRaw("date(??) >= ?", [column, from]);
  if (to) query.whereRaw("date(??) <= ?", [column, to]);
  return query;
}

function applyOutletFilter(query, column, outletId, { includeGlobal = false } = {}) {
  if (!outletId || outletId === "all") return query;
  if (includeGlobal) {
    query.where((builder) => builder.where(column, outletId).orWhereNull(column));
  } else {
    query.where(column, outletId);
  }
  return query;
}

function findPrimaryAccount(accounts = [], reportGroup, pattern = null) {
  return (
    accounts
      .filter((account) => account.report_group === reportGroup && account.status !== "inactive")
      .filter((account) => !pattern || pattern.test(String(account.name || "")))
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))[0] || null
  );
}

function toAccountDetailOutlet(row) {
  if (!row?.outlet_id) return null;
  return {
    id: row.outlet_id,
    name: row.outlet_name || "-"
  };
}

function accountDetailRow({ amount, date, description, outlet, reference, sourceType, status = "active" }) {
  const signedAmount = Math.round(Number(amount || 0));
  return {
    id: `${sourceType}_${reference || date}_${Math.abs(signedAmount)}`,
    date: dateOnly(date),
    source_type: sourceType,
    source_label: accountDetailSourceLabels[sourceType] || sourceType,
    reference: reference || "-",
    outlet,
    outlet_id: outlet?.id || null,
    outlet_name: outlet?.name || "-",
    description: description || "-",
    amount: Math.abs(signedAmount),
    signed_amount: signedAmount,
    status
  };
}

function buildAccountDetailResponse({ accountCode, account, from, outletId, report, rows, to }) {
  const safeAccount = account || {
    code: accountCode,
    name: "Akun belum terdaftar",
    report_group: null
  };
  const sortedRows = [...rows].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.reference || "").localeCompare(String(b.reference || "")));
  const summaryBySource = new Map();
  sortedRows.forEach((row) => {
    const current = summaryBySource.get(row.source_type) || {
      source_type: row.source_type,
      source_label: row.source_label,
      count: 0,
      total: 0
    };
    current.count += 1;
    current.total += Number(row.signed_amount || 0);
    summaryBySource.set(row.source_type, current);
  });

  return {
    report,
    account: safeAccount,
    account_code: accountCode,
    from,
    to,
    outlet_id: outletId,
    total: sortedRows.reduce((total, row) => total + Number(row.signed_amount || 0), 0),
    summary: [...summaryBySource.values()],
    rows: sortedRows
  };
}

async function getReportAccountDetail({ report = "profit_loss", accountCode, outletId = "all", from, to } = {}) {
  const defaultRange = getDefaultReportRange();
  const dateFrom = from || defaultRange.from;
  const dateTo = to || defaultRange.to;
  const code = String(accountCode || "").trim();
  if (!code) throw new Error("Kode akun wajib dikirim.");

  const [accounts, paymentMethods, expenseCategories] = await Promise.all([db("financial_accounts").orderBy("sort_order"), db("payment_methods").catch(() => []), db("expense_categories").catch(() => [])]);
  const account = accounts.find((item) => String(item.code) === code) || null;
  const accountByCode = new Map(accounts.map((item) => [String(item.code), item]));
  const incomeAccount = findPrimaryAccount(accounts, "income");
  const discountAccount = findPrimaryAccount(accounts, "income", /diskon/i);
  const cogsAccount = findPrimaryAccount(accounts, "cogs");
  const expenseAccount = findPrimaryAccount(accounts, "expense");
  const cashAccount = findPrimaryAccount(accounts, "cash_bank");
  const inventoryAccount = findPrimaryAccount(accounts, "inventory");
  const liabilityAccount = findPrimaryAccount(accounts, "liability");
  const rows = [];

  if (report === "profit_loss") {
    if (incomeAccount?.code && String(incomeAccount.code) === code) {
      const query = db("transactions as t").leftJoin("outlets as o", "o.id", "t.outlet_id").select("t.*", "o.name as outlet_name").where("t.status", "paid");
      applyOutletFilter(query, "t.outlet_id", outletId);
      applyDateRange(query, "t.transaction_date", dateFrom, dateTo);
      const transactions = await query;
      transactions.forEach((transaction) => {
        rows.push(
          accountDetailRow({
            amount: Number(transaction.total || 0) + Number(transaction.discount || 0),
            date: transaction.transaction_date,
            description: `Penjualan ${transaction.order_number}`,
            outlet: toAccountDetailOutlet(transaction),
            reference: transaction.order_number,
            sourceType: "sales",
            status: transaction.status
          })
        );
      });
    }

    if (discountAccount?.code && String(discountAccount.code) === code) {
      const query = db("transactions as t").leftJoin("outlets as o", "o.id", "t.outlet_id").select("t.*", "o.name as outlet_name").where("t.status", "paid").where("t.discount", ">", 0);
      applyOutletFilter(query, "t.outlet_id", outletId);
      applyDateRange(query, "t.transaction_date", dateFrom, dateTo);
      const transactions = await query;
      transactions.forEach((transaction) => {
        rows.push(
          accountDetailRow({
            amount: -Number(transaction.discount || 0),
            date: transaction.transaction_date,
            description: `Diskon ${transaction.order_number}`,
            outlet: toAccountDetailOutlet(transaction),
            reference: transaction.order_number,
            sourceType: "discount",
            status: transaction.status
          })
        );
      });
    }

    const purchaseQuery = db("purchase_items as pi").join("purchases as p", "p.id", "pi.purchase_id").leftJoin("raw_materials as rm", "rm.id", "pi.material_id").leftJoin("raw_material_categories as rmc", "rmc.id", "rm.category_id").leftJoin("outlets as o", "o.id", "p.outlet_id").select("pi.*", "p.id as purchase_id", "p.batch_id", "p.purchase_date", "p.status as purchase_status", "p.outlet_id", "o.name as outlet_name", "rm.name as material_name", "rm.type as material_type", "rm.account_code as material_account_code", "rmc.account_code as category_account_code").where("p.status", "approved");
    applyOutletFilter(purchaseQuery, "p.outlet_id", outletId);
    applyDateRange(purchaseQuery, "p.purchase_date", dateFrom, dateTo);
    const purchaseItems = await purchaseQuery;
    purchaseItems.forEach((item) => {
      const isBiaya = item.material_type === "biaya";
      const fallbackAccount = isBiaya ? expenseAccount : cogsAccount;
      const itemAccountCode = item.category_account_code || item.material_account_code || fallbackAccount?.code;
      if (!itemAccountCode || String(itemAccountCode) !== code) return;
      rows.push(
        accountDetailRow({
          amount: Number(item.subtotal || 0),
          date: item.purchase_date,
          description: `${isBiaya ? "Pembelian Biaya Produksi" : "Pembelian HPP"} - ${item.material_name || item.material_id}`,
          outlet: toAccountDetailOutlet(item),
          reference: item.batch_id || item.purchase_id,
          sourceType: isBiaya ? "purchase_biaya" : "purchase_hpp",
          status: item.purchase_status
        })
      );
    });

    const expenseCategoryByName = new Map(expenseCategories.map((category) => [String(category.name || "").toLowerCase(), category]));
    const expenseQuery = db("expenses as e").leftJoin("outlets as o", "o.id", "e.outlet_id").select("e.*", "o.name as outlet_name");
    applyOutletFilter(expenseQuery, "e.outlet_id", outletId);
    applyDateRange(expenseQuery, "e.expense_date", dateFrom, dateTo);
    expenseQuery.where("e.status", "approved");
    const expenses = await expenseQuery;
    expenses.forEach((expense) => {
      const category = expenseCategoryByName.get(String(expense.category || "").toLowerCase());
      if (!category?.account_code || String(category.account_code) !== code) return;
      rows.push(
        accountDetailRow({
          amount: Number(expense.amount || 0),
          date: expense.expense_date,
          description: expense.description || expense.category || "Pengeluaran",
          outlet: toAccountDetailOutlet(expense),
          reference: expense.id,
          sourceType: "expense",
          status: expense.status || "active"
        })
      );
    });
  }

  if (report === "balance_sheet") {
    const paymentMethodByCode = new Map(paymentMethods.map((method) => [String(method.code), method]));
    const paymentQuery = db("transactions as t").leftJoin("payments as p", "p.transaction_id", "t.id").leftJoin("outlets as o", "o.id", "t.outlet_id").select("t.*", "p.method as payment_method", "o.name as outlet_name").where("t.status", "paid");
    applyOutletFilter(paymentQuery, "t.outlet_id", outletId);
    applyDateRange(paymentQuery, "t.transaction_date", null, dateTo);
    const transactions = await paymentQuery;
    transactions.forEach((transaction) => {
      const method = paymentMethodByCode.get(String(transaction.payment_method || "cash"));
      const paymentAccount = accountByCode.get(String(method?.account_code)) || cashAccount;
      if (!paymentAccount?.code || String(paymentAccount.code) !== code) return;
      rows.push(
        accountDetailRow({
          amount: Number(transaction.total || 0),
          date: transaction.transaction_date,
          description: `Payment ${method?.name || transaction.payment_method || "Cash"} - ${transaction.order_number}`,
          outlet: toAccountDetailOutlet(transaction),
          reference: transaction.order_number,
          sourceType: "payment",
          status: transaction.status
        })
      );
    });

    if (inventoryAccount?.code && String(inventoryAccount.code) === code) {
      const stockQuery = db("raw_material_stocks as rms").leftJoin("raw_materials as rm", "rm.id", "rms.material_id").leftJoin("outlets as o", "o.id", "rms.outlet_id").select("rms.*", "rm.name as material_name", "rm.unit as material_unit", "o.name as outlet_name");
      applyOutletFilter(stockQuery, "rms.outlet_id", outletId);
      const stocks = await stockQuery;
      stocks.forEach((stock) => {
        rows.push(
          accountDetailRow({
            amount: Number(stock.stock_value || 0) || Number(stock.quantity || 0) * Number(stock.last_purchase_price || 0),
            date: dateTo,
            description: `${stock.material_name || stock.material_id} - ${stock.quantity} ${stock.unit || stock.material_unit || ""}`,
            outlet: toAccountDetailOutlet(stock),
            reference: stock.id,
            sourceType: "inventory",
            status: "active"
          })
        );
      });
    }

    if (liabilityAccount?.code && String(liabilityAccount.code) === code) {
      const bonQuery = db("purchases as p").leftJoin("suppliers as s", "s.id", "p.supplier_id").leftJoin("outlets as o", "o.id", "p.outlet_id").select("p.*", "s.name as supplier_name", "o.name as outlet_name").where("p.status", "approved").where("p.payment_type", "bon");
      applyOutletFilter(bonQuery, "p.outlet_id", outletId);
      applyDateRange(bonQuery, "p.purchase_date", null, dateTo);
      const bonPurchases = await bonQuery;
      bonPurchases.forEach((purchase) => {
        rows.push(
          accountDetailRow({
            amount: Number(purchase.total || 0),
            date: purchase.purchase_date,
            description: `Bon pembelian ${purchase.supplier_name || "tanpa supplier"}`,
            outlet: toAccountDetailOutlet(purchase),
            reference: purchase.batch_id || purchase.id,
            sourceType: "purchase_bon",
            status: purchase.status
          })
        );
      });
    }
  }

  const financeGroups = report === "balance_sheet" ? ["other_current_asset", "reserve_fund", "fixed_asset", "moving_asset", "liability", "equity"] : ["other_income", "other_expense"];
  const financeQuery = db("balance_sheet_entries as bse").leftJoin("financial_accounts as fa", "fa.code", "bse.account_code").leftJoin("outlets as o", "o.id", "bse.outlet_id").select("bse.*", "fa.report_group as account_report_group", "o.name as outlet_name").where("bse.account_code", code).whereNot("bse.status", "inactive");
  applyOutletFilter(financeQuery, "bse.outlet_id", outletId, {
    includeGlobal: true
  });
  applyDateRange(financeQuery, "bse.entry_date", report === "balance_sheet" ? null : dateFrom, dateTo);
  const financeEntries = await financeQuery;
  financeEntries
    .filter((entry) => financeGroups.includes(entry.account_report_group || entry.group))
    .forEach((entry) => {
      const amount = (entry.movement_type || "in") === "out" ? -Number(entry.amount || 0) : Number(entry.amount || 0);
      rows.push(
        accountDetailRow({
          amount,
          date: entry.entry_date,
          description: entry.note || entry.name || "Entry Keuangan",
          outlet: toAccountDetailOutlet(entry),
          reference: entry.id,
          sourceType: "finance_entry",
          status: entry.status
        })
      );
    });

  return buildAccountDetailResponse({
    accountCode: code,
    account,
    from: report === "balance_sheet" ? null : dateFrom,
    outletId,
    report,
    rows,
    to: dateTo
  });
}

function isDateInRange(value, from, to) {
  const date = dateOnly(value);
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function buildMaterialPriceComparisons(rows = [], { from, to } = {}) {
  const grouped = new Map();

  rows.forEach((row, itemIndex) => {
    const key = `${row.outlet_id}_${row.material_id}`;
    const items = grouped.get(key) || [];
    items.push({
      ...row,
      item_index: itemIndex,
      purchase_date: dateOnly(row.purchase_date),
      unit_price: Number(row.unit_price || 0)
    });
    grouped.set(key, items);
  });

  return Array.from(grouped.entries())
    .map(([key, items]) => {
      const sortedItems = items.sort((a, b) => {
        const dateCompare = String(b.purchase_date || "").localeCompare(String(a.purchase_date || ""));
        if (dateCompare !== 0) return dateCompare;
        return b.item_index - a.item_index;
      });
      const latestIndex = sortedItems.findIndex((item) => isDateInRange(item.purchase_date, from, to));
      if (latestIndex < 0) return null;
      const latest = sortedItems[latestIndex];
      const previous = sortedItems[latestIndex + 1];
      const difference = previous ? latest.unit_price - previous.unit_price : 0;
      const changePercent = previous?.unit_price ? (difference / previous.unit_price) * 100 : 0;
      const trend = previous ? (difference > 0 ? "naik" : difference < 0 ? "turun" : "tetap") : "baru";

      return {
        id: key,
        material_id: latest.material_id,
        material: {
          id: latest.material_id,
          name: latest.material_name,
          unit: latest.material_unit
        },
        material_name: latest.material_name,
        outlet_id: latest.outlet_id,
        outlet: {
          id: latest.outlet_id,
          name: latest.outlet_name
        },
        outlet_name: latest.outlet_name,
        supplier_id: latest.supplier_id || null,
        supplier: latest.supplier_id
          ? {
              id: latest.supplier_id,
              name: latest.supplier_name
            }
          : null,
        supplier_name: latest.supplier_name || "-",
        latest_purchase_id: latest.purchase_id,
        latest_purchase_date: latest.purchase_date,
        latest_price: latest.unit_price,
        previous_purchase_date: previous?.purchase_date || null,
        previous_price: previous?.unit_price || 0,
        difference,
        change_percent: changePercent,
        trend
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const diffCompare = Math.abs(b.difference || 0) - Math.abs(a.difference || 0);
      if (diffCompare !== 0) return diffCompare;
      return String(b.latest_purchase_date || "").localeCompare(String(a.latest_purchase_date || ""));
    });
}

function buildStockMovementRows({ transactions = [], transactionItems = [], compositions = [], materials = [], refunds = [], outletId = "all" } = {}) {
  const materialById = new Map(materials.map((material) => [material.id, material]));
  const itemsByTransaction = transactionItems.reduce((result, item) => {
    result.set(item.transaction_id, [...(result.get(item.transaction_id) || []), item]);
    return result;
  }, new Map());
  const compositionsByProduct = compositions.reduce((result, composition) => {
    result.set(composition.product_id, [...(result.get(composition.product_id) || []), composition]);
    return result;
  }, new Map());

  const getQuantities = (transaction) => {
    const totals = new Map();
    (itemsByTransaction.get(transaction.id) || []).forEach((item) => {
      (compositionsByProduct.get(item.product_id) || []).forEach((composition) => {
        const material = materialById.get(composition.material_id);
        if (!material || material.status === "inactive") return;
        const quantity = Number(item.quantity || 0) * Number(composition.quantity || 0);
        totals.set(composition.material_id, roundQuantity((totals.get(composition.material_id) || 0) + quantity));
      });
    });
    return totals;
  };

  const includeOutlet = (row) => !outletId || outletId === "all" || row.outlet_id === outletId;
  const movements = [];

  transactions
    .filter(includeOutlet)
    .filter((transaction) => ["paid", "refunded"].includes(transaction.status) && (transaction.stock_deducted === true || transaction.stock_deducted === 1))
    .forEach((transaction) => {
      getQuantities(transaction).forEach((quantity, materialId) => {
        if (!quantity) return;
        const material = materialById.get(materialId);
        movements.push({
          id: `sales_${transaction.id}_${materialId}`,
          outlet_id: transaction.outlet_id,
          material_id: materialId,
          movement_date: transaction.transaction_date,
          type: "sales",
          description: `Penjualan ${transaction.order_number}`,
          reference_number: transaction.order_number,
          transaction_id: transaction.id,
          quantity: -roundQuantity(quantity),
          unit: material?.unit || ""
        });
      });
    });

  refunds
    .filter(includeOutlet)
    .filter((refund) => refund.status !== "cancelled")
    .forEach((refund) => {
      const transaction = transactions.find((item) => item.id === refund.transaction_id);
      if (!transaction || !(transaction.stock_deducted === true || transaction.stock_deducted === 1)) return;

      getQuantities(transaction).forEach((quantity, materialId) => {
        if (!quantity) return;
        const material = materialById.get(materialId);
        movements.push({
          id: `refund_${refund.id}_${materialId}`,
          outlet_id: refund.outlet_id || transaction.outlet_id,
          material_id: materialId,
          movement_date: refund.refunded_at,
          type: "refund",
          description: `Refund ${transaction.order_number}${refund.reason ? ` - ${refund.reason}` : ""}`,
          reference_number: transaction.order_number,
          transaction_id: transaction.id,
          refund_id: refund.id,
          quantity: roundQuantity(quantity),
          unit: material?.unit || ""
        });
      });
    });

  return movements.sort((a, b) => new Date(b.movement_date) - new Date(a.movement_date));
}

async function getMaterialPriceComparisonRows({ outletId = "all", from, to } = {}) {
  const query = db("purchase_items as pi").join("purchases as p", "pi.purchase_id", "p.id").join("raw_materials as m", "pi.material_id", "m.id").join("outlets as o", "p.outlet_id", "o.id").leftJoin("suppliers as s", "p.supplier_id", "s.id").where("p.status", "approved").whereNot("m.status", "inactive").select("pi.material_id", "pi.unit_price", "p.id as purchase_id", "p.outlet_id", "p.supplier_id", "p.purchase_date", "m.name as material_name", "m.unit as material_unit", "o.name as outlet_name", "s.name as supplier_name");

  if (outletId && outletId !== "all") query.where("p.outlet_id", outletId);

  return buildMaterialPriceComparisons(await query, { from, to });
}

function buildPurchaseComparisonSummary(rows = []) {
  const byOutlet = Array.from(
    rows
      .reduce((result, row) => {
        const current = result.get(row.outlet_id) || {
          outlet_id: row.outlet_id,
          outlet_name: row.outlet_name,
          item_count: 0,
          total: 0
        };
        current.item_count += 1;
        current.total += Number(row.subtotal || 0);
        result.set(row.outlet_id, current);
        return result;
      }, new Map())
      .values()
  ).sort((a, b) => Number(b.total || 0) - Number(a.total || 0));

  const byMaterial = Array.from(
    rows
      .reduce((result, row) => {
        const current = result.get(row.material_id) || {
          material_id: row.material_id,
          material_name: row.material_name,
          type: row.material_type,
          unit: row.unit,
          item_count: 0,
          total_quantity: 0,
          total: 0
        };
        current.item_count += 1;
        current.total_quantity += Number(row.quantity || 0);
        current.total += Number(row.subtotal || 0);
        current.average_unit_price = current.total_quantity ? current.total / current.total_quantity : 0;
        result.set(row.material_id, current);
        return result;
      }, new Map())
      .values()
  ).sort((a, b) => Number(b.total || 0) - Number(a.total || 0));

  return {
    total_items: rows.length,
    total_amount: rows.reduce((total, row) => total + Number(row.subtotal || 0), 0),
    by_outlet: byOutlet,
    by_material: byMaterial
  };
}

function buildPurchaseComparisonMatrix(rows = [], outletOptions = [], materialOptions = [], selectedMaterialIds = []) {
  const selectedMaterialSet = new Set(selectedMaterialIds);
  const materialIdsWithRows = new Set(rows.map((row) => row.material_id));
  const matrixMaterials = materialOptions.filter((material) => materialIdsWithRows.has(material.id) || selectedMaterialSet.has(material.id)).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "id-ID"));

  return matrixMaterials
    .map((material) => {
      const cells = outletOptions.map((outlet) => {
        const details = rows.filter((row) => row.material_id === material.id && row.outlet_id === outlet.id).sort((a, b) => String(b.purchase_date || "").localeCompare(String(a.purchase_date || "")));
        const latest = details[0] || null;
        return {
          outlet_id: outlet.id,
          outlet_name: outlet.name,
          latest_price: Number(latest?.unit_price || 0),
          latest_purchase_date: latest?.purchase_date || null,
          quantity_total: details.reduce((total, row) => total + Number(row.quantity || 0), 0),
          total: details.reduce((total, row) => total + Number(row.subtotal || 0), 0),
          item_count: details.length,
          supplier_name: latest?.supplier_name || "-",
          details
        };
      });
      const cellsWithData = cells.filter((cell) => cell.item_count > 0);
      const benchmarkPrice = cellsWithData.length ? Math.min(...cellsWithData.map((cell) => Number(cell.latest_price || 0))) : 0;
      const benchmarkCount = cellsWithData.filter((cell) => Math.abs(Number(cell.latest_price || 0) - benchmarkPrice) < 0.0001).length;
      const pricedCells = cells.map((cell) => {
        if (!cell.item_count) {
          return {
            ...cell,
            benchmark_price: benchmarkPrice,
            difference: 0,
            change_percent: 0,
            status: "belum_ada_data"
          };
        }
        const difference = Number(cell.latest_price || 0) - benchmarkPrice;
        return {
          ...cell,
          benchmark_price: benchmarkPrice,
          difference,
          change_percent: benchmarkPrice ? (difference / benchmarkPrice) * 100 : 0,
          status: difference > 0 ? "lebih_mahal" : benchmarkCount > 1 && cellsWithData.length > 1 ? "sama" : "termurah"
        };
      });
      const maxDifference = cellsWithData.length > 1 ? Math.max(...pricedCells.map((cell) => Number(cell.difference || 0))) : 0;

      return {
        id: material.id,
        material_id: material.id,
        material_name: material.name,
        material_type: material.type || "hpp",
        category_name: material.category_name || "-",
        unit: material.unit || "",
        max_difference: maxDifference,
        outlet_cells: pricedCells
      };
    })
    .sort((a, b) => {
      const differenceCompare = Number(b.max_difference || 0) - Number(a.max_difference || 0);
      if (differenceCompare !== 0) return differenceCompare;
      return String(a.material_name || "").localeCompare(String(b.material_name || ""), "id-ID");
    });
}

function buildReportDateRange(from, to) {
  const today = new Date();
  const defaultFrom = dateOnly(new Date(today.getFullYear(), today.getMonth(), 1));
  const dateFrom = from || defaultFrom;
  const dateTo = to || dateOnly(today);
  const cursor = new Date(`${dateFrom}T00:00:00`);
  const end = new Date(`${dateTo}T00:00:00`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime()) || cursor > end) return [];

  const dates = [];
  while (cursor <= end) {
    dates.push(dateOnly(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function buildSalesOutletComparison({ transactions = [], outlets = [], outletOptions = [], paymentMethods = [], from, to } = {}) {
  const dates = buildReportDateRange(from, to);
  const paymentMethodMap = new Map((paymentMethods || []).map((method) => [method.code, method]));
  const outletMapById = new Map((outletOptions || []).map((outlet) => [outlet.id, outlet]));

  const rows = transactions
    .filter((transaction) => transaction.status === "paid")
    .map((transaction) => {
      const outlet = transaction.outlet || outletMapById.get(transaction.outlet_id) || null;
      const payments = normalizeDbPaymentRows(transaction.payments || transaction.payment || []);
      const payment = payments[0] || transaction.payment || null;
      const paymentMethod = payment?.method || transaction.payment_method || "unknown";
      const paymentMethodMaster = paymentMethodMap.get(paymentMethod);
      const paidAmount = payments.length
        ? payments.reduce((total, item) => total + Number(item.amount || 0), 0)
        : Number(transaction.payment?.amount ?? transaction.paid_amount ?? transaction.paidAmount ?? transaction.total ?? 0);
      const changeAmount = payments.length
        ? payments.reduce((total, item) => total + Number(item.change_amount || 0), 0)
        : Number(transaction.payment?.change_amount ?? transaction.change_amount ?? transaction.changeAmount ?? 0);
      const paymentLabel = payments.length
        ? payments.map((item) => paymentMethodMap.get(item.method)?.name || String(item.method || "-").toUpperCase()).join(" + ")
        : paymentMethodMaster?.name || String(paymentMethod || "-").toUpperCase();

      return {
        id: transaction.id,
        order_number: transaction.order_number,
        transaction_date: transaction.transaction_date,
        date: dateOnly(transaction.transaction_date),
        outlet_id: transaction.outlet_id,
        outlet,
        outlet_name: outlet?.name || transaction.outlet_name || "-",
        customer_id: transaction.customer_id || null,
        customer: transaction.customer || null,
        customer_name: transaction.customer?.name || transaction.customer_name || "Umum",
        payment_method: paymentMethod,
        payment_label: paymentLabel,
        payment: payment || {
          method: paymentMethod,
          amount: paidAmount,
          change_amount: changeAmount
        },
        payments,
        subtotal: Number(transaction.subtotal || 0),
        discount: Number(transaction.discount || 0),
        total: Number(transaction.total || 0),
        paid_amount: paidAmount,
        change_amount: changeAmount,
        status: transaction.status
      };
    })
    .filter((row) => dates.includes(row.date));

  const groupedRows = rows.reduce((result, row) => {
    const key = `${row.outlet_id}:${row.date}`;
    const current = result.get(key) || [];
    current.push(row);
    result.set(key, current);
    return result;
  }, new Map());

  const matrixRows = outlets.map((outlet) => {
    const dateCells = dates.map((date) => {
      const details = groupedRows.get(`${outlet.id}:${date}`) || [];
      const total = details.reduce((sum, row) => sum + Number(row.total || 0), 0);
      const discountTotal = details.reduce((sum, row) => sum + Number(row.discount || 0), 0);
      return {
        id: `${outlet.id}_${date}`,
        date,
        outlet_id: outlet.id,
        outlet_name: outlet.name,
        total,
        transaction_count: details.length,
        average_transaction: details.length ? Math.round(total / details.length) : 0,
        discount_total: discountTotal,
        rows: details.sort((a, b) => String(a.transaction_date || "").localeCompare(String(b.transaction_date || "")))
      };
    });
    const periodTotal = dateCells.reduce((sum, cell) => sum + Number(cell.total || 0), 0);
    const transactionCount = dateCells.reduce((sum, cell) => sum + Number(cell.transaction_count || 0), 0);

    return {
      id: outlet.id,
      outlet_id: outlet.id,
      outlet_name: outlet.name,
      outlet,
      date_cells: dateCells,
      period_total: periodTotal,
      transaction_count: transactionCount,
      average_transaction: transactionCount ? Math.round(periodTotal / transactionCount) : 0,
      discount_total: dateCells.reduce((sum, cell) => sum + Number(cell.discount_total || 0), 0)
    };
  });

  const totalsByDate = dates.map((date) => {
    const details = rows.filter((row) => row.date === date);
    const total = details.reduce((sum, row) => sum + Number(row.total || 0), 0);
    const discountTotal = details.reduce((sum, row) => sum + Number(row.discount || 0), 0);
    return {
      date,
      total,
      transaction_count: details.length,
      average_transaction: details.length ? Math.round(total / details.length) : 0,
      discount_total: discountTotal
    };
  });

  return {
    outlet_options: outletOptions,
    outlets,
    dates,
    matrix_rows: matrixRows,
    rows: rows.sort((a, b) => String(b.transaction_date || "").localeCompare(String(a.transaction_date || ""))),
    totals_by_date: totalsByDate,
    summary: {
      total: rows.reduce((sum, row) => sum + Number(row.total || 0), 0),
      transaction_count: rows.length,
      discount_total: rows.reduce((sum, row) => sum + Number(row.discount || 0), 0)
    }
  };
}

async function getDashboardMaterialPurchaseComparisons({ from, to, outletIds = "", materialIds = "" } = {}) {
  const outletIdList = parsePosQueryList(outletIds);
  const materialIdList = parsePosQueryList(materialIds);

  const outletQuery = db("outlets").whereNot("status", "inactive").orderBy("name");
  const materialQuery = db("raw_materials as m").leftJoin("raw_material_categories as c", "m.category_id", "c.id").whereNot("m.status", "inactive").select("m.id", "m.name", "m.type", "m.unit", "m.category_id", "c.name as category_name", "c.type as category_type").orderBy("m.name");

  const rowQuery = db("purchase_items as pi")
    .join("purchases as p", "pi.purchase_id", "p.id")
    .join("raw_materials as m", "pi.material_id", "m.id")
    .join("outlets as o", "p.outlet_id", "o.id")
    .leftJoin("raw_material_categories as c", "m.category_id", "c.id")
    .leftJoin("suppliers as s", "p.supplier_id", "s.id")
    .where("p.status", "approved")
    .whereNot("m.status", "inactive")
    .modify((query) => {
      if (from) query.where("p.purchase_date", ">=", from);
      if (to) query.where("p.purchase_date", "<=", to);
      if (outletIdList.length) query.whereIn("p.outlet_id", outletIdList);
      if (materialIdList.length) query.whereIn("pi.material_id", materialIdList);
    })
    .select("pi.id as item_id", "pi.purchase_id", "pi.material_id", "pi.quantity", "pi.unit", "pi.unit_price", "pi.subtotal", "p.outlet_id", "p.supplier_id", "p.purchase_date", "m.name as material_name", "m.type as material_type", "m.unit as material_unit", "m.category_id", "c.name as category_name", "c.type as category_type", "o.name as outlet_name", "s.name as supplier_name")
    .orderBy("p.purchase_date", "desc")
    .orderBy("o.name")
    .orderBy("m.name");

  const [outlets, materials, purchaseRows] = await Promise.all([outletQuery, materialQuery, rowQuery]);
  const selectedOutlets = outletIdList.length ? outlets.filter((outlet) => outletIdList.includes(outlet.id)) : outlets;
  const normalizedMaterials = materials.map((material) => ({
    id: material.id,
    name: material.name,
    type: material.type || material.category_type || "hpp",
    unit: material.unit,
    category_id: material.category_id,
    category_name: material.category_name || "-"
  }));
  const rows = purchaseRows.map((row) => {
    const quantity = Number(row.quantity || 0);
    const unitPrice = Number(row.unit_price || 0);
    const subtotal = Number(row.subtotal ?? quantity * unitPrice);
    const materialType = row.material_type || row.category_type || "hpp";

    return {
      id: row.item_id || `${row.purchase_id}_${row.material_id}`,
      purchase_id: row.purchase_id,
      purchase_date: dateOnly(row.purchase_date),
      outlet_id: row.outlet_id,
      outlet: {
        id: row.outlet_id,
        name: row.outlet_name
      },
      outlet_name: row.outlet_name || "-",
      material_id: row.material_id,
      material: {
        id: row.material_id,
        name: row.material_name,
        type: materialType,
        unit: row.material_unit
      },
      material_name: row.material_name || "-",
      material_type: materialType,
      category_id: row.category_id || null,
      category_name: row.category_name || "-",
      quantity,
      unit: row.unit || row.material_unit || "",
      unit_price: unitPrice,
      subtotal,
      supplier_id: row.supplier_id || null,
      supplier: row.supplier_id
        ? {
            id: row.supplier_id,
            name: row.supplier_name
          }
        : null,
      supplier_name: row.supplier_name || "-"
    };
  });

  return {
    outlets,
    matrix_outlets: selectedOutlets,
    materials: normalizedMaterials,
    rows,
    matrix_rows: buildPurchaseComparisonMatrix(rows, selectedOutlets, normalizedMaterials, materialIdList),
    summary: buildPurchaseComparisonSummary(rows)
  };
}

async function getSalesOutletComparison({ from, to, outletIds = "" } = {}) {
  const outletIdList = parsePosQueryList(outletIds);
  const dates = buildReportDateRange(from, to);
  const dateFrom = dates[0];
  const dateTo = dates[dates.length - 1];
  const nextDate = dateTo ? dateOnly(new Date(new Date(`${dateTo}T00:00:00`).getTime() + 24 * 60 * 60 * 1000)) : null;

  const [outletOptions, paymentMethods] = await Promise.all([db("outlets").whereNot("status", "inactive").orderBy("name"), db("payment_methods").orderBy("sort_order").orderBy("name")]);
  const selectedOutlets = outletIdList.length ? outletOptions.filter((outlet) => outletIdList.includes(outlet.id)) : outletOptions;
  const selectedOutletIds = selectedOutlets.map((outlet) => outlet.id);

  if (!selectedOutletIds.length) {
    return buildSalesOutletComparison({
      transactions: [],
      outlets: [],
      outletOptions,
      paymentMethods,
      from,
      to
    });
  }

  const transactionRows = await db("transactions as t")
    .leftJoin("outlets as o", "t.outlet_id", "o.id")
    .leftJoin("customers as c", "t.customer_id", "c.id")
    .where("t.status", "paid")
    .whereIn("t.outlet_id", selectedOutletIds)
    .modify((query) => {
      if (dateFrom) query.where("t.transaction_date", ">=", dateFrom);
      if (nextDate) query.where("t.transaction_date", "<", nextDate);
    })
    .select("t.id", "t.order_number", "t.transaction_date", "t.outlet_id", "t.customer_id", "t.subtotal", "t.discount", "t.total", "t.status", "o.name as outlet_name", "c.name as customer_name")
    .orderBy("t.transaction_date", "desc");

  const transactionIds = transactionRows.map((row) => row.id);
  const payments = transactionIds.length ? await db("payments").whereIn("transaction_id", transactionIds).orderBy("paid_at").orderBy("id") : [];
  const paymentsByTransaction = payments.reduce((result, payment) => {
    result[payment.transaction_id] = result[payment.transaction_id] || [];
    result[payment.transaction_id].push(payment);
    return result;
  }, {});

  const transactions = transactionRows.map((row) => {
    const payments = normalizeDbPaymentRows(paymentsByTransaction[row.id] || []);
    const payment = payments[0] || null;
    const paidAmount = payments.length ? payments.reduce((total, item) => total + Number(item.amount || 0), 0) : Number(row.total || 0);
    const changeAmount = payments.reduce((total, item) => total + Number(item.change_amount || 0), 0);
    return {
      id: row.id,
      order_number: row.order_number,
      transaction_date: row.transaction_date,
      outlet_id: row.outlet_id,
      outlet: {
        id: row.outlet_id,
        name: row.outlet_name
      },
      customer_id: row.customer_id,
      customer_name: row.customer_name || "Umum",
      subtotal: Number(row.subtotal || 0),
      discount: Number(row.discount || 0),
      total: Number(row.total || 0),
      status: row.status,
      payment_method: payment?.method || "unknown",
      paid_amount: paidAmount,
      change_amount: changeAmount,
      payment: payment || {
        method: "unknown",
        amount: paidAmount,
        change_amount: changeAmount
      },
      payments
    };
  });

  return buildSalesOutletComparison({
    transactions,
    outlets: selectedOutlets,
    outletOptions,
    paymentMethods,
    from,
    to
  });
}

function buildSalesByCategoryRows(itemRows = []) {
  const totals = new Map();

  itemRows.forEach((item) => {
    const categoryId = item.item_category_id || item.product_category_id || "uncategorized";
    const categoryName = item.item_category_name || item.item_category_lookup_name || item.product_category_name || "Tanpa Kategori";
    const current = totals.get(categoryId) || {
      category_id: categoryId,
      category_name: categoryName,
      quantity: 0,
      transaction_ids: new Set(),
      total: 0
    };

    current.category_name = current.category_name || categoryName;
    current.quantity += Number(item.quantity || 0);
    current.total += Number(item.subtotal || 0);
    current.transaction_ids.add(item.transaction_id);
    totals.set(categoryId, current);
  });

  const grandTotal = [...totals.values()].reduce((total, row) => total + row.total, 0);

  return [...totals.values()]
    .map((row) => ({
      category_id: row.category_id,
      category_name: row.category_name || "Tanpa Kategori",
      quantity: roundQuantity(row.quantity),
      transaction_count: row.transaction_ids.size,
      total: Math.round(row.total),
      percentage: grandTotal ? Number(((row.total / grandTotal) * 100).toFixed(2)) : 0
    }))
    .sort((a, b) => b.total - a.total || a.category_name.localeCompare(b.category_name));
}

async function getSalesByCategoryRows(transactions = []) {
  const transactionIds = transactions.map((transaction) => transaction.id).filter(Boolean);
  if (!transactionIds.length) return [];

  const [hasItemCategoryId, hasItemCategoryName] = await Promise.all([db.schema.hasColumn("transaction_items", "category_id"), db.schema.hasColumn("transaction_items", "category_name")]);

  const query = db("transaction_items as ti").leftJoin("products as p", "ti.product_id", "p.id").leftJoin("categories as pc", "p.category_id", "pc.id").whereIn("ti.transaction_id", transactionIds);

  if (hasItemCategoryId) {
    query.leftJoin("categories as ic", "ti.category_id", "ic.id");
  }

  const selectColumns = ["ti.transaction_id", "ti.quantity", "ti.subtotal", "p.category_id as product_category_id", "pc.name as product_category_name"];

  if (hasItemCategoryId) {
    selectColumns.push("ti.category_id as item_category_id", "ic.name as item_category_lookup_name");
  }
  if (hasItemCategoryName) {
    selectColumns.push("ti.category_name as item_category_name");
  }

  const itemRows = await query.select(selectColumns);
  return buildSalesByCategoryRows(itemRows);
}

async function getDashboardTopProducts(transactions = []) {
  const transactionIds = transactions.map((transaction) => transaction.id).filter(Boolean);
  if (!transactionIds.length) return [];

  const rows = await db("transaction_items as ti")
    .leftJoin("products as p", "ti.product_id", "p.id")
    .whereIn("ti.transaction_id", transactionIds)
    .groupBy("ti.product_id", "p.name")
    .select("ti.product_id", db.raw("COALESCE(p.name, ti.product_id) as product_name"), db.raw("SUM(ti.quantity) as quantity"), db.raw("SUM(ti.subtotal) as total"), db.raw("COUNT(DISTINCT ti.transaction_id) as transaction_count"))
    .orderBy("quantity", "desc")
    .orderBy("total", "desc")
    .limit(6);

  return rows.map((row) => ({
    product_id: row.product_id,
    product_name: row.product_name || "Produk",
    product: {
      id: row.product_id,
      name: row.product_name || "Produk"
    },
    quantity: roundQuantity(row.quantity),
    total: Math.round(Number(row.total || 0)),
    transaction_count: Number(row.transaction_count || 0)
  }));
}

function dashboardLowStockRow(stock = {}) {
  const quantity = Number(stock.quantity || 0);
  const threshold = Number(stock.low_stock_threshold || 0);

  return {
    id: stock.id,
    outlet_id: stock.outlet_id,
    outlet_name: stock.outlet_name || "-",
    outlet: {
      id: stock.outlet_id,
      name: stock.outlet_name || "-"
    },
    material_id: stock.material_id,
    material_name: stock.material_name || "Tanpa nama",
    material: {
      id: stock.material_id,
      name: stock.material_name || "Tanpa nama",
      unit: stock.material_unit || stock.unit || "",
      low_stock_threshold: threshold
    },
    quantity,
    unit: stock.unit || stock.material_unit || "",
    low_stock_threshold: threshold,
    status: quantity <= 0 ? "out_of_stock" : "low_stock"
  };
}

async function getDashboard({ outletId = "all", from, to } = {}) {
  const [allTransactions, purchases, expenses, stocks, materialPriceComparisons, outlets] = await Promise.all([
    db("transactions")
      .where({ status: "paid" })
      .modify((query) => {
        applyDateRangeExpression(query, "transaction_date", from, to);
      }),
    db("purchases")
      .where({ status: "approved" })
      .modify((query) => {
        if (outletId && outletId !== "all") query.where("outlet_id", outletId);
        applyDateRangeExpression(query, "purchase_date", from, to);
      }),
    db("expenses")
      .where("status", "approved")
      .modify((query) => {
        if (outletId && outletId !== "all") query.where("outlet_id", outletId);
        applyDateRangeExpression(query, "expense_date", from, to);
      }),
    db("raw_material_stocks as rms")
      .leftJoin("raw_materials as rm", "rms.material_id", "rm.id")
      .leftJoin("outlets as o", "rms.outlet_id", "o.id")
      .select("rms.*", "rm.low_stock_threshold", db.raw("rm.name as material_name"), db.raw("rm.unit as material_unit"), db.raw("o.name as outlet_name"))
      .modify((query) => {
        if (outletId && outletId !== "all") query.where("rms.outlet_id", outletId);
      }),
    getMaterialPriceComparisonRows({ outletId, from, to }),
    db("outlets").whereNot("status", "inactive").orderBy("name")
  ]);

  const transactions = allTransactions.filter((transaction) => !outletId || outletId === "all" || transaction.outlet_id === outletId);
  const revenue = transactions.reduce((total, transaction) => total + Number(transaction.total || 0), 0);
  const purchaseTotal = purchases.reduce((total, purchase) => total + Number(purchase.total || 0), 0);
  const expenseTotal = expenses.reduce((total, expense) => total + Number(expense.amount || 0), 0);
  const lowStocks = stocks.filter((stock) => Number(stock.quantity || 0) <= Number(stock.low_stock_threshold || 0));
  const [salesByCategory, topProducts] = await Promise.all([getSalesByCategoryRows(transactions), getDashboardTopProducts(transactions)]);
  const salesByOutlet = buildDashboardSalesByOutlet({
    outlets,
    transactions: allTransactions
  });

  return {
    metrics: {
      revenue,
      transactions: transactions.length,
      purchases: purchaseTotal,
      expenses: expenseTotal,
      gross_profit_estimate: revenue - purchaseTotal - expenseTotal,
      transaction_count: transactions.length,
      purchase_total: purchaseTotal,
      expense_total: expenseTotal,
      low_stock_count: lowStocks.length
    },
    material_price_comparisons: materialPriceComparisons,
    daily_sales: buildDailySales(transactions, from, to),
    top_products: topProducts,
    sales_by_category: salesByCategory,
    sales_by_outlet: salesByOutlet,
    low_stocks: lowStocks.map(dashboardLowStockRow)
  };
}

async function mockGetDashboard() {
  const transactions = mockData.transactions.filter((transaction) => transaction.status === "paid");
  const purchases = mockData.purchases.filter((purchase) => purchase.status === "approved");
  const lowStocks = mockData.raw_material_stocks.filter((stock) => {
    const material = mockData.raw_materials.find((item) => item.id === stock.material_id);
    return Number(stock.quantity || 0) <= Number(material?.low_stock_threshold || 0);
  });

  return {
    metrics: {
      revenue: transactions.reduce((total, transaction) => total + Number(transaction.total || 0), 0),
      transaction_count: transactions.length,
      purchase_total: purchases.reduce((total, purchase) => total + Number(purchase.total || 0), 0),
      expense_total: mockData.expenses.reduce((total, expense) => total + Number(expense.amount || 0), 0),
      low_stock_count: lowStocks.length
    }
  };
}

function parsePosQueryList(value) {
  if (Array.isArray(value)) return value.flatMap((item) => parsePosQueryList(item));
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function getPosMaterialStocks({ outletIds = "", materialIds = "" } = {}) {
  const outletIdList = parsePosQueryList(outletIds);
  if (!outletIdList.length) return [];

  const materialIdList = parsePosQueryList(materialIds);
  const materialQuery = db("raw_materials").whereNot("status", "inactive").orderBy("name");
  if (materialIdList.length) materialQuery.whereIn("id", materialIdList);

  const stockQuery = db("raw_material_stocks").whereIn("outlet_id", outletIdList);
  if (materialIdList.length) stockQuery.whereIn("material_id", materialIdList);

  const purchaseItemQuery = db("purchase_items as pi").join("purchases as p", "pi.purchase_id", "p.id").select("pi.material_id", "p.outlet_id", "p.purchase_date", "pi.unit_price").where("p.status", "approved").whereIn("p.outlet_id", outletIdList);
  if (materialIdList.length) purchaseItemQuery.whereIn("pi.material_id", materialIdList);

  const [materials, stocks, purchaseItems] = await Promise.all([materialQuery, stockQuery, purchaseItemQuery]);

  const stockByKey = new Map(stocks.map((stock) => [`${stock.outlet_id}:${stock.material_id}`, stock]));
  const latestByKey = new Map();
  purchaseItems
    .sort((a, b) => String(b.purchase_date || "").localeCompare(String(a.purchase_date || "")))
    .forEach((item) => {
      const key = `${item.outlet_id}:${item.material_id}`;
      if (!latestByKey.has(key)) latestByKey.set(key, item);
    });

  return outletIdList.flatMap((outletId) =>
    materials.map((material) => {
      const key = `${outletId}:${material.id}`;
      const stock = stockByKey.get(key);
      const latest = latestByKey.get(key);
      return {
        material_id: material.id,
        outlet_id: outletId,
        quantity: Number(stock?.quantity || 0),
        unit: stock?.unit || material.unit || "",
        last_purchase_price: Number(latest?.unit_price || stock?.last_purchase_price || material.last_purchase_price || 0),
        last_purchase_date: latest?.purchase_date || stock?.last_purchase_date || material.last_purchase_date || null
      };
    })
  );
}

function transactionVersionValue(transaction = {}) {
  const value = transaction.updated_at || transaction.transaction_date;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || "") : date.toISOString();
}

function nextTransactionUpdatedAt(transaction = {}) {
  const now = new Date();
  const previous = new Date(transaction.updated_at || transaction.transaction_date || 0);
  if (!Number.isNaN(previous.getTime()) && Math.floor(now.getTime() / 1000) <= Math.floor(previous.getTime() / 1000)) {
    return new Date((Math.floor(previous.getTime() / 1000) + 1) * 1000);
  }
  return now;
}

function transactionItemSnapshot(item = {}) {
  return {
    id: item.id,
    product_id: item.product_id,
    quantity: Number(item.quantity || 0),
    unit_price: Number(item.unit_price || 0),
    subtotal: Number(item.subtotal || 0),
    metadata_json: parseJson(item.metadata_json, {})
  };
}

function normalizeManualDiscountCorrectionPayload(payload = {}, transaction = {}) {
  const hasType = Object.prototype.hasOwnProperty.call(payload, "discount_type") || Object.prototype.hasOwnProperty.call(payload, "discountType");
  const hasValue = Object.prototype.hasOwnProperty.call(payload, "discount_value") || Object.prototype.hasOwnProperty.call(payload, "discountValue");
  if (!hasType && !hasValue) {
    return {
      type: transaction.discount_type || null,
      value: Number(transaction.discount_value || 0),
      name: transaction.discount_name || (Number(transaction.discount || 0) > 0 ? "Diskon Manual" : null),
      id: transaction.discount_id || null,
      fallbackDiscount: Number(transaction.discount || 0)
    };
  }
  const rawType = String(payload.discount_type ?? payload.discountType ?? "").trim().toLowerCase();
  const type = rawType === "percent" || rawType === "nominal" ? rawType : null;
  if (!type) {
    return { type: null, value: 0, name: null, id: null, fallbackDiscount: 0 };
  }
  const rawValue = Math.max(0, Number(payload.discount_value ?? payload.discountValue ?? 0));
  const value = type === "percent" ? Math.min(100, Math.round(rawValue)) : Math.round(rawValue);
  if (value <= 0) return { type: null, value: 0, name: null, id: null, fallbackDiscount: 0 };
  return { type, value, name: "Diskon Manual", id: null, fallbackDiscount: 0 };
}

async function getAdminTransactionById(transactionId) {
  const transaction = await db("transactions as transaction").leftJoin("outlets as outlet", "outlet.id", "transaction.outlet_id").select("transaction.*", db.raw("outlet.name as outlet_name"), db.raw("outlet.code as outlet_code")).where("transaction.id", transactionId).first();
  if (!transaction) return null;
  const [items, payment, refund, users] = await Promise.all([
    db("transaction_items as item").leftJoin("products as product", "product.id", "item.product_id").leftJoin("categories as category", "category.id", "product.category_id").select("item.*", db.raw("product.name as product_name"), db.raw("product.category_id as category_id"), db.raw("category.name as category_name")).where("item.transaction_id", transactionId),
    db("payments").where({ transaction_id: transactionId }).first(),
    db("transaction_refunds")
      .where({ transaction_id: transactionId })
      .first()
      .catch(() => null),
    db("users").whereIn("id", [transaction.cashier_id, transaction.cancelled_by, transaction.updated_by].filter(Boolean)).select("id", "name")
  ]);
  const userById = new Map(users.map((user) => [user.id, user]));
  return {
    ...transaction,
    outlet: {
      id: transaction.outlet_id,
      name: transaction.outlet_name,
      code: transaction.outlet_code
    },
    cashier: userById.get(transaction.cashier_id) || null,
    updated_by_user: userById.get(transaction.updated_by) || null,
    cancelled_by_user: userById.get(transaction.cancelled_by) || null,
    payment: payment || null,
    refund: refund || null,
    items
  };
}

async function correctTransactionItems(transactionId, payload = {}, actorUserId = null) {
  const reason = String(payload.reason || "").trim();
  if (!reason) throw new Error("Alasan koreksi transaksi wajib diisi.");
  if (!Array.isArray(payload.items) || !payload.items.length) {
    throw new Error("Minimal satu item transaksi wajib dipertahankan. Gunakan Cancel untuk membatalkan seluruh transaksi.");
  }
  const expectedStatus = String(payload.expected_status || payload.expectedStatus || "").trim();
  const expectedUpdatedAt = payload.expected_updated_at || payload.expectedUpdatedAt;
  if (!expectedStatus || !expectedUpdatedAt) throw new Error("Versi transaksi wajib dikirim ulang sebelum koreksi.");

  await db.transaction(async (trx) => {
    const transaction = await trx("transactions").where({ id: transactionId }).forUpdate().first();
    if (!transaction) throw new Error("Transaksi tidak ditemukan.");
    if (!["paid", "refunded", "cancelled"].includes(transaction.status)) {
      throw new Error("Status transaksi tidak mendukung koreksi item.");
    }
    if (transaction.status !== expectedStatus || transactionVersionValue(transaction) !== transactionVersionValue({ updated_at: expectedUpdatedAt })) {
      const error = new Error("Transaksi sudah berubah. Muat ulang data sebelum mengoreksi kembali.");
      error.status = 409;
      error.code = "TRANSACTION_VERSION_CONFLICT";
      throw error;
    }

    const oldItems = await trx("transaction_items").where({ transaction_id: transaction.id }).forUpdate();
    const oldItemById = new Map(oldItems.map((item) => [item.id, item]));
    const requestedExistingIds = payload.items.map((item) => item.id).filter(Boolean);
    if (new Set(requestedExistingIds).size !== requestedExistingIds.length) throw new Error("Baris item transaksi tidak boleh duplikat.");
    if (requestedExistingIds.some((id) => !oldItemById.has(id))) throw new Error("Item lama tidak berasal dari transaksi ini.");

    const newPayloadRows = payload.items.filter((item) => !item.id);
    const newProductIds = [...new Set(newPayloadRows.map((item) => String(item.product_id || item.productId || "").trim()).filter(Boolean))];
    const [products, prices, variants] = await Promise.all([newProductIds.length ? trx("products").whereIn("id", newProductIds).where({ status: "active" }) : [], newProductIds.length ? trx("product_prices").whereIn("product_id", newProductIds).where({ outlet_id: transaction.outlet_id, status: "active" }).where("price", ">", 0) : [], newProductIds.length ? trx("product_variants").whereIn("product_id", newProductIds).where({ status: "active" }) : []]);
    const productById = new Map(products.map((product) => [product.id, product]));
    const priceByProductId = new Map(prices.map((price) => [price.product_id, Number(price.price || 0)]));
    const variantById = new Map(variants.map((variant) => [variant.id, variant]));

    const desiredItems = payload.items.map((row, index) => {
      const quantity = Math.max(0, Math.round(Number(row.quantity || 0)));
      if (quantity <= 0) throw new Error(`Qty item baris ${index + 1} wajib lebih dari nol.`);
      if (row.id) {
        const existing = oldItemById.get(row.id);
        return {
          ...existing,
          quantity,
          subtotal: quantity * Number(existing.unit_price || 0),
          is_new: false
        };
      }
      const productId = String(row.product_id || row.productId || "").trim();
      const product = productById.get(productId);
      const unitPrice = priceByProductId.get(productId);
      if (!product || !unitPrice) throw new Error(`Produk baru baris ${index + 1} tidak aktif atau belum memiliki harga outlet.`);
      const variantIds = [...new Set((row.variant_ids || row.variantIds || []).map((id) => String(id)).filter(Boolean))];
      const selectedVariants = variantIds.map((variantId) => {
        const variant = variantById.get(variantId);
        if (!variant || variant.product_id !== productId) throw new Error("Varian produk baru tidak aktif atau tidak valid.");
        return {
          id: variant.id,
          product_id: variant.product_id,
          name: variant.name
        };
      });
      return {
        id: createRuntimeId("trx_item"),
        transaction_id: transaction.id,
        product_id: productId,
        quantity,
        unit_price: unitPrice,
        subtotal: quantity * unitPrice,
        metadata_json: { selected_variants: selectedVariants },
        is_new: true
      };
    });

    const discountCorrection = normalizeManualDiscountCorrectionPayload(payload, transaction);
    const totals = calculateTransactionCorrectionTotals({
      items: desiredItems,
      discountType: discountCorrection.type,
      discountValue: discountCorrection.value,
      fallbackDiscount: discountCorrection.fallbackDiscount,
      tax: transaction.tax
    });
    const payment = await trx("payments").where({ transaction_id: transaction.id }).forUpdate().first();
    if (!payment) throw new Error("Data pembayaran transaksi tidak ditemukan.");
    const isPaid = transaction.status === "paid";
    const paymentAfter = isPaid
      ? calculatePaymentCorrection({
          method: payment.method,
          previousAmount: payment.amount,
          submittedAmount: payload.paid_amount ?? payload.paidAmount,
          total: totals.total
        })
      : {
          amount: Number(payment.amount || 0),
          change_amount: Number(payment.change_amount || 0)
        };

    const productIds = [...new Set([...oldItems, ...desiredItems].map((item) => item.product_id))];
    const compositions = productIds.length ? await trx("product_compositions").whereIn("product_id", productIds) : [];
    const materialDeltas = isPaid ? calculateMaterialDeltas(oldItems, desiredItems, compositions) : [];
    const materialIds = materialDeltas.map((row) => row.material_id);
    const materials = materialIds.length ? await trx("raw_materials").whereIn("id", materialIds) : [];
    const materialById = new Map(materials.map((material) => [material.id, material]));
    const stockChanges = [];
    for (const delta of materialDeltas) {
      const material = materialById.get(delta.material_id);
      const stock = await trx("raw_material_stocks")
        .where({
          outlet_id: transaction.outlet_id,
          material_id: delta.material_id
        })
        .forUpdate()
        .first();
      const previousQuantity = Number(stock?.quantity || 0);
      const nextQuantity = roundQuantity(previousQuantity - delta.deduction_delta);
      if (stock) {
        const lastPrice = Number(stock.last_purchase_price || material?.last_purchase_price || 0);
        await trx("raw_material_stocks")
          .where({ id: stock.id })
          .update({
            quantity: nextQuantity,
            unit: material?.unit || stock.unit,
            stock_value: Math.round(nextQuantity * lastPrice)
          });
      } else {
        const lastPrice = Number(material?.last_purchase_price || 0);
        await trx("raw_material_stocks").insert({
          id: createRuntimeId("stock"),
          outlet_id: transaction.outlet_id,
          material_id: delta.material_id,
          quantity: nextQuantity,
          unit: material?.unit || "",
          last_purchase_price: lastPrice,
          last_purchase_date: material?.last_purchase_date || null,
          stock_value: Math.round(nextQuantity * lastPrice)
        });
      }
      stockChanges.push({
        ...delta,
        previous_stock: previousQuantity,
        next_stock: nextQuantity
      });
    }

    let pointChange = null;
    if (isPaid && transaction.customer_id) {
      const customer = await trx("customers").where({ id: transaction.customer_id }).forUpdate().first();
      if (customer) {
        pointChange = calculatePointCorrection({
          total: totals.total,
          previousEarned: transaction.customer_points_earned,
          currentBalance: customer.points
        });
        await trx("customers").where({ id: customer.id }).update({ points: pointChange.next_balance });
      }
    }

    const desiredExistingIds = desiredItems.filter((item) => !item.is_new).map((item) => item.id);
    await trx("transaction_items")
      .where({ transaction_id: transaction.id })
      .modify((query) => {
        if (desiredExistingIds.length) query.whereNotIn("id", desiredExistingIds);
      })
      .delete();
    for (const item of desiredItems.filter((row) => !row.is_new)) {
      await trx("transaction_items").where({ id: item.id }).update({ quantity: item.quantity, subtotal: item.subtotal });
    }
    const newItems = desiredItems.filter((row) => row.is_new);
    if (newItems.length) {
      await trx("transaction_items").insert(
        newItems.map((item) => ({
          id: item.id,
          transaction_id: item.transaction_id,
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          subtotal: item.subtotal,
          metadata_json: item.metadata_json
        }))
      );
    }

    const updatedAt = nextTransactionUpdatedAt(transaction);
    const transactionUpdate = {
      ...totals,
      discount_id: discountCorrection.id,
      discount_type: totals.discount > 0 ? discountCorrection.type : null,
      discount_value: totals.discount > 0 ? discountCorrection.value : 0,
      discount_name: totals.discount > 0 ? discountCorrection.name : null,
      updated_by: actorUserId,
      updated_at: updatedAt,
      correction_reason: reason
    };
    if (pointChange) {
      transactionUpdate.customer_points_earned = pointChange.earned;
      transactionUpdate.customer_points_after = Number(transaction.customer_points_before || 0) + pointChange.earned;
    }
    await trx("transactions").where({ id: transaction.id }).update(transactionUpdate);
    if (isPaid) await trx("payments").where({ id: payment.id }).update(paymentAfter);

    await trx("activity_logs").insert({
      id: createRuntimeId("activity"),
      actor_user_id: actorUserId,
      outlet_id: transaction.outlet_id,
      source: "admin_web",
      module: "transaction",
      action: "update_items",
      entity_type: "transaction",
      entity_id: transaction.id,
      description: `Item transaksi ${transaction.order_number} dikoreksi.`,
      metadata_json: {
        reason,
        status: transaction.status,
        before: {
          items: oldItems.map(transactionItemSnapshot),
          subtotal: Number(transaction.subtotal || 0),
          discount: Number(transaction.discount || 0),
          discount_id: transaction.discount_id || null,
          discount_type: transaction.discount_type || null,
          discount_value: Number(transaction.discount_value || 0),
          discount_name: transaction.discount_name || null,
          tax: Number(transaction.tax || 0),
          total: Number(transaction.total || 0),
          payment: {
            amount: Number(payment.amount || 0),
            change_amount: Number(payment.change_amount || 0)
          },
          customer_points_earned: Number(transaction.customer_points_earned || 0)
        },
        after: {
          items: desiredItems.map(transactionItemSnapshot),
          ...totals,
          discount_id: transactionUpdate.discount_id,
          discount_type: transactionUpdate.discount_type,
          discount_value: transactionUpdate.discount_value,
          discount_name: transactionUpdate.discount_name,
          payment: paymentAfter,
          customer_points_earned: pointChange?.earned ?? Number(transaction.customer_points_earned || 0)
        },
        stock_changes: stockChanges,
        point_change: pointChange
      },
      created_at: updatedAt
    });
  });

  return getAdminTransactionById(transactionId);
}

async function refundTransaction(transactionId, payload = {}, refundedBy = null) {
  const reason = String(payload.reason || "").trim();
  if (!reason) {
    throw new Error("Alasan refund wajib diisi.");
  }

  return db.transaction(async (trx) => {
    const transaction = await trx("transactions").where({ id: transactionId }).first();
    if (!transaction) {
      throw new Error("Transaksi tidak ditemukan.");
    }
    if (transaction.status !== "paid") {
      throw new Error("Hanya transaksi paid yang bisa di-refund.");
    }

    const existingRefund = await trx("transaction_refunds").where({ transaction_id: transactionId }).whereNot({ status: "cancelled" }).first();
    if (existingRefund) {
      throw new Error("Transaksi ini sudah pernah di-refund.");
    }

    const payment = await trx("payments").where({ transaction_id: transactionId }).first();
    const refund = {
      id: createRuntimeId("refund"),
      transaction_id: transaction.id,
      outlet_id: transaction.outlet_id,
      refund_amount: Number(transaction.total || 0),
      payment_method: payment?.method || "unknown",
      reason,
      refunded_by: refundedBy || payload.refunded_by || null,
      refunded_at: new Date(),
      status: "active"
    };

    const shouldRestoreStock = transaction.stock_deducted === true || transaction.stock_deducted === 1;
    const stockAlreadyRestored = transaction.stock_refunded === true || transaction.stock_refunded === 1;
    const restoredStock = [];

    if (shouldRestoreStock && !stockAlreadyRestored) {
      const items = await trx("transaction_items").where({
        transaction_id: transaction.id
      });
      const productIds = [...new Set(items.map((item) => item.product_id))];
      const compositions = productIds.length ? await trx("product_compositions").whereIn("product_id", productIds) : [];
      const materialIds = [...new Set(compositions.map((item) => item.material_id))];
      const materials = materialIds.length ? await trx("raw_materials").whereIn("id", materialIds) : [];
      const materialById = new Map(materials.map((material) => [material.id, material]));
      const returnTotals = new Map();

      items.forEach((item) => {
        compositions
          .filter((composition) => composition.product_id === item.product_id)
          .forEach((composition) => {
            const quantity = Number(item.quantity || 0) * Number(composition.quantity || 0);
            returnTotals.set(composition.material_id, roundQuantity((returnTotals.get(composition.material_id) || 0) + quantity));
          });
      });

      for (const [materialId, quantity] of returnTotals.entries()) {
        if (!quantity) continue;
        const material = materialById.get(materialId);
        const stock = await trx("raw_material_stocks").where({ outlet_id: transaction.outlet_id, material_id: materialId }).first();

        if (stock) {
          const nextQuantity = roundQuantity(Number(stock.quantity || 0) + quantity);
          await trx("raw_material_stocks")
            .where({ id: stock.id })
            .update({
              quantity: nextQuantity,
              unit: material?.unit || stock.unit,
              stock_value: Math.round(nextQuantity * Number(stock.last_purchase_price || 0))
            });
        } else {
          await trx("raw_material_stocks").insert({
            id: createRuntimeId("stock"),
            outlet_id: transaction.outlet_id,
            material_id: materialId,
            quantity,
            unit: material?.unit || "",
            last_purchase_price: Number(material?.last_purchase_price || 0),
            last_purchase_date: material?.last_purchase_date || null,
            stock_value: Math.round(quantity * Number(material?.last_purchase_price || 0))
          });
        }

        restoredStock.push({ material_id: materialId, quantity });
      }
    }

    await trx("transaction_refunds").insert(refund);
    await trx("transactions")
      .where({ id: transaction.id })
      .update({
        status: "refunded",
        stock_refunded: shouldRestoreStock ? true : transaction.stock_refunded || false,
        stock_refunded_at: shouldRestoreStock ? new Date() : transaction.stock_refunded_at || null
      });
    await trx("activity_logs").insert({
      id: createRuntimeId("activity"),
      actor_user_id: refund.refunded_by,
      outlet_id: transaction.outlet_id,
      source: "admin_web",
      module: "transaction",
      action: "refund",
      entity_type: "transaction",
      entity_id: transaction.id,
      description: `Refund transaksi ${transaction.order_number}.`,
      metadata_json: {
        refund_id: refund.id,
        refund_amount: refund.refund_amount,
        payment_method: refund.payment_method,
        reason,
        restored_stock: restoredStock
      },
      created_at: new Date()
    });

    return {
      ...transaction,
      status: "refunded",
      refund
    };
  });
}

async function restoreTransactionStock(trx, transaction, restoredFlagColumn = "stock_refunded") {
  const shouldRestoreStock = transaction.stock_deducted === true || transaction.stock_deducted === 1;
  const stockAlreadyRestored = transaction[restoredFlagColumn] === true || transaction[restoredFlagColumn] === 1;
  const restoredStock = [];

  if (!shouldRestoreStock || stockAlreadyRestored) {
    return { restoredStock, shouldRestoreStock };
  }

  const items = await trx("transaction_items").where({
    transaction_id: transaction.id
  });
  const productIds = [...new Set(items.map((item) => item.product_id))];
  const compositions = productIds.length ? await trx("product_compositions").whereIn("product_id", productIds) : [];
  const materialIds = [...new Set(compositions.map((item) => item.material_id))];
  const materials = materialIds.length ? await trx("raw_materials").whereIn("id", materialIds) : [];
  const materialById = new Map(materials.map((material) => [material.id, material]));
  const returnTotals = new Map();

  items.forEach((item) => {
    compositions
      .filter((composition) => composition.product_id === item.product_id)
      .forEach((composition) => {
        const quantity = Number(item.quantity || 0) * Number(composition.quantity || 0);
        returnTotals.set(composition.material_id, roundQuantity((returnTotals.get(composition.material_id) || 0) + quantity));
      });
  });

  for (const [materialId, quantity] of returnTotals.entries()) {
    if (!quantity) continue;
    const material = materialById.get(materialId);
    const stock = await trx("raw_material_stocks").where({ outlet_id: transaction.outlet_id, material_id: materialId }).first();

    if (stock) {
      const nextQuantity = roundQuantity(Number(stock.quantity || 0) + quantity);
      await trx("raw_material_stocks")
        .where({ id: stock.id })
        .update({
          quantity: nextQuantity,
          unit: material?.unit || stock.unit,
          stock_value: Math.round(nextQuantity * Number(stock.last_purchase_price || 0))
        });
    } else {
      await trx("raw_material_stocks").insert({
        id: createRuntimeId("stock"),
        outlet_id: transaction.outlet_id,
        material_id: materialId,
        quantity,
        unit: material?.unit || "",
        last_purchase_price: Number(material?.last_purchase_price || 0),
        last_purchase_date: material?.last_purchase_date || null,
        stock_value: Math.round(quantity * Number(material?.last_purchase_price || 0))
      });
    }

    restoredStock.push({ material_id: materialId, quantity });
  }

  return { restoredStock, shouldRestoreStock };
}

async function cancelTransaction(transactionId, payload = {}, cancelledBy = null) {
  const reason = String(payload.reason || "").trim();
  if (!reason) {
    throw new Error("Alasan cancel wajib diisi.");
  }

  return db.transaction(async (trx) => {
    const transaction = await trx("transactions").where({ id: transactionId }).first();
    if (!transaction) {
      throw new Error("Transaksi tidak ditemukan.");
    }
    if (transaction.status !== "paid") {
      throw new Error("Hanya transaksi paid yang bisa di-cancel.");
    }

    const { restoredStock, shouldRestoreStock } = await restoreTransactionStock(trx, transaction, "stock_cancelled");
    const cancelledAt = new Date();
    await trx("transactions")
      .where({ id: transaction.id })
      .update({
        status: "cancelled",
        cancel_reason: reason,
        cancelled_by: cancelledBy || payload.cancelled_by || null,
        cancelled_at: cancelledAt,
        stock_cancelled: shouldRestoreStock ? true : transaction.stock_cancelled || false,
        stock_cancelled_at: shouldRestoreStock ? cancelledAt : transaction.stock_cancelled_at || null
      });

    await trx("activity_logs").insert({
      id: createRuntimeId("activity"),
      actor_user_id: cancelledBy || payload.cancelled_by || null,
      outlet_id: transaction.outlet_id,
      source: "admin_web",
      module: "transaction",
      action: "cancel",
      entity_type: "transaction",
      entity_id: transaction.id,
      description: `Cancel transaksi ${transaction.order_number}.`,
      metadata_json: {
        reason,
        total: Number(transaction.total || 0),
        restored_stock: restoredStock
      },
      created_at: cancelledAt
    });

    const updated = await trx("transactions").where({ id: transaction.id }).first();
    return updated;
  });
}

async function uploadProductImage(productId, file) {
  const product = await db("products").where({ id: productId }).first();
  if (!product) {
    if (file?.path) deleteLocalProductImage(file.path);
    throw new Error("Produk tidak ditemukan.");
  }

  if (product.image_path) {
    deleteLocalProductImage(product.image_path);
  }

  const imageUrl = productImageUrlFromFile(file);
  const imagePath = path.relative(process.cwd(), file.path);
  await db("products").where({ id: productId }).update({
    image_url: imageUrl,
    image_path: imagePath
  });

  return db("products").where({ id: productId }).first();
}

async function deleteProductImage(productId) {
  const product = await db("products").where({ id: productId }).first();
  if (!product) throw new Error("Produk tidak ditemukan.");

  if (product.image_path) {
    deleteLocalProductImage(product.image_path);
  }

  await db("products").where({ id: productId }).update({
    image_url: null,
    image_path: null
  });

  return db("products").where({ id: productId }).first();
}

function pick(mysqlFn, mockFn) {
  return (...args) => (env.dataMode === "mock" ? mockFn(...args) : mysqlFn(...args));
}

function mysqlImplementationMissing(featureName) {
  const error = new Error(`${featureName} belum tersedia untuk DATA_MODE=mysql. Jalur demo JSON diputus.`);
  error.status = 501;
  error.code = "MYSQL_IMPLEMENTATION_MISSING";
  return error;
}

function includesText(source, keyword = "") {
  const needle = String(keyword || "")
    .trim()
    .toLowerCase();
  if (!needle) return true;
  return String(source || "")
    .toLowerCase()
    .includes(needle);
}

function serializeTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function normalizeActivityLog(row = {}) {
  const actor = row.actor_user_id
    ? {
        id: row.actor_user_id,
        name: row.actor_name || null,
        username: row.actor_username || null,
        role_id: row.actor_role_id || row.actor_role || null
      }
    : null;
  const outlet = row.outlet_id
    ? {
        id: row.outlet_id,
        name: row.outlet_name || null,
        code: row.outlet_code || null
      }
    : null;
  return {
    id: row.id,
    actor_user_id: row.actor_user_id || null,
    actor_role: row.actor_role || row.actor_role_id || null,
    outlet_id: row.outlet_id || null,
    source: row.source,
    event_type: row.event_type || "business",
    outcome: row.outcome || "succeeded",
    module: row.module,
    action: row.action,
    entity_type: row.entity_type || null,
    entity_id: row.entity_id || null,
    description: row.description || null,
    metadata_json: parseJson(row.metadata_json, row.metadata_json || {}),
    ip_address: row.ip_address || null,
    device_id: row.device_id || null,
    app_version: row.app_version || null,
    client_event_id: row.client_event_id || null,
    correlation_id: row.correlation_id || null,
    occurred_at: serializeTimestamp(row.occurred_at || row.created_at),
    received_at: serializeTimestamp(row.received_at || row.created_at),
    created_at: serializeTimestamp(row.created_at),
    actor,
    outlet
  };
}

async function getActivityLogs({ from, to, outletId = "all", source = "all", eventType = "all", outcome = "all", module = "all", action = "all", actorId = "all", keyword = "", page = 1, pageSize = 50, paginated = false } = {}) {
  const usePagination = paginated === true || paginated === "true" || paginated === "1";
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(200, Math.max(1, Number(pageSize) || 50));
  const applyFilters = (query) =>
    query.modify((builder) => {
      const timeColumn = "activity_logs.occurred_at";
      if (from) builder.where(timeColumn, ">=", new Date(`${dateOnly(from)}T00:00:00`));
      if (to) builder.where(timeColumn, "<=", new Date(`${dateOnly(to)}T23:59:59`));
      if (outletId && outletId !== "all") builder.where("activity_logs.outlet_id", outletId);
      if (source && source !== "all") builder.where("activity_logs.source", source);
      if (eventType && eventType !== "all") builder.where("activity_logs.event_type", eventType);
      if (outcome && outcome !== "all") builder.where("activity_logs.outcome", outcome);
      if (module && module !== "all") builder.where("activity_logs.module", module);
      if (action && action !== "all") builder.where("activity_logs.action", action);
      if (actorId && actorId !== "all") builder.where("activity_logs.actor_user_id", actorId);
      const needle = String(keyword || "").trim();
      if (needle) {
        builder.where((nested) => {
          ["activity_logs.id", "activity_logs.description", "activity_logs.source", "activity_logs.module", "activity_logs.action", "activity_logs.entity_type", "activity_logs.entity_id", "users.name", "outlets.name"].forEach((column) => nested.orWhere(column, "like", `%${needle}%`));
        });
      }
    });

  const baseQuery = () => applyFilters(db("activity_logs").leftJoin("users", "activity_logs.actor_user_id", "users.id").leftJoin("outlets", "activity_logs.outlet_id", "outlets.id"));

  const rowsQuery = baseQuery()
    .select("activity_logs.*", "users.name as actor_name", "users.username as actor_username", "users.role_id as actor_role_id", "outlets.name as outlet_name", "outlets.code as outlet_code")
    .orderBy("activity_logs.occurred_at", "desc")
    .limit(usePagination ? safePageSize : 1000);
  if (usePagination) rowsQuery.offset((safePage - 1) * safePageSize);
  const rows = await rowsQuery;
  const normalizedRows = rows.map(normalizeActivityLog);

  if (!usePagination) return normalizedRows;
  const [{ total }] = await baseQuery().countDistinct({
    total: "activity_logs.id"
  });
  return {
    rows: normalizedRows,
    pagination: {
      page: safePage,
      page_size: safePageSize,
      total: Number(total || 0),
      total_pages: Math.ceil(Number(total || 0) / safePageSize)
    }
  };
}

async function createActivityLog(payload = {}) {
  const row = await writeDbActivityLog(payload);
  if (!row) return null;
  const [log] = await getActivityLogs({ keyword: row.id });
  return log || normalizeActivityLog(row);
}

async function createActivityLogs(payloads = []) {
  const rows = [];
  for (const payload of Array.isArray(payloads) ? payloads : []) {
    const row = await createActivityLog(payload);
    if (row) rows.push(row);
  }
  return {
    synced: rows.length,
    accepted_event_ids: rows.map((row) => row.client_event_id).filter(Boolean),
    logs: rows
  };
}

const mockOnly = (featureName, mockFn) =>
  pick(() => {
    throw mysqlImplementationMissing(featureName);
  }, mockFn);

async function withActivityActor(actorId, action) {
  if (env.dataMode === "mock") {
    return adminMockApi.withActivityActor(actorId, action);
  }
  return action();
}

function callMockAdmin(methodName, ...args) {
  if (env.dataMode !== "mock") {
    throw mysqlImplementationMissing(methodName);
  }
  const method = adminMockApi[methodName];
  if (typeof method !== "function") {
    const error = new Error(`Mock method ${methodName} tidak ditemukan.`);
    error.status = 500;
    error.code = "MOCK_METHOD_MISSING";
    throw error;
  }
  return method.apply(adminMockApi, args);
}

const adminImportApi = new Proxy(
  {
    getImportData: () => callMockAdmin("getStaticData")
  },
  {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args) => callMockAdmin(prop, ...args);
    }
  }
);

function filterMobileCatalogBySession(catalog, session) {
  const allowedOutletIds = new Set(session?.outlet_ids || []);
  const rolePermissions = session?.role?.permissions || {};
  const canView = (key) => Array.isArray(rolePermissions[key]) && rolePermissions[key].includes("view");
  const salesAccess = canView("apk.sales");
  const historyAccess = canView("apk.history");
  const purchaseAccess = canView("apk.purchases");
  const transferAccess = canView("apk.transfers");
  const opnameAccess = canView("apk.opnames");
  const expenseAccess = canView("apk.expenses");
  const reportAccess = canView("apk.reports");
  const printAccess = canView("apk.printing");

  const outlets = (catalog.outlets || []).filter((outlet) => allowedOutletIds.has(outlet.id));
  const outletIds = new Set(outlets.map((outlet) => outlet.id));
  const productPrices = (catalog.product_prices || []).filter((price) => outletIds.has(price.outlet_id));
  const productIds = new Set(productPrices.map((price) => price.product_id));
  const products = (catalog.products || []).filter((product) => productIds.has(product.id));
  const categoryIds = new Set(products.map((product) => product.category_id));

  return {
    ...catalog,
    outlets,
    transfer_outlets: transferAccess ? catalog.transfer_outlets || catalog.outlets || [] : [],
    cashiers: (catalog.cashiers || [])
      .map((cashier) => ({
        ...cashier,
        outlet_ids: (cashier.outlet_ids || []).filter((outletId) => outletIds.has(outletId))
      }))
      .filter((cashier) => cashier.outlet_ids.length),
    categories: salesAccess || printAccess ? (catalog.categories || []).filter((category) => categoryIds.has(category.id)) : [],
    products: salesAccess || printAccess ? products : [],
    product_prices: salesAccess || printAccess ? productPrices : [],
    customers: salesAccess ? (catalog.customers || []).filter((customer) => outletIds.has(customer.outlet_id)) : [],
    tables: salesAccess ? (catalog.tables || []).filter((table) => outletIds.has(table.outlet_id)) : [],
    expense_categories: expenseAccess ? catalog.expense_categories || [] : [],
    raw_materials: purchaseAccess || transferAccess || opnameAccess ? catalog.raw_materials || [] : [],
    raw_material_categories: purchaseAccess || transferAccess || opnameAccess ? catalog.raw_material_categories || [] : [],
    suppliers: purchaseAccess ? catalog.suppliers || [] : [],
    payment_methods: salesAccess || historyAccess || purchaseAccess || expenseAccess || reportAccess ? catalog.payment_methods || [] : [],
    discounts: (salesAccess ? catalog.discounts || [] : [])
      .map((discount) => ({
        ...discount,
        outlet_ids: (discount.outlet_ids || []).filter((outletId) => outletIds.has(outletId))
      }))
      .filter((discount) => discount.outlet_ids.length)
  };
}

async function getMobileCatalogForSession(session) {
  const catalog = env.dataMode === "mock" ? await adminMockApi.getMobileCatalogSnapshot() : await getMobileCatalog();
  return filterMobileCatalogBySession(catalog, session);
}

async function ensurePosProductFavoritesTable() {
  const exists = await db.schema.hasTable("pos_product_favorites");
  if (exists) return;
  await db.schema.createTable("pos_product_favorites", (table) => {
    table.string("user_id").notNullable();
    table.string("outlet_id").notNullable();
    table.string("product_id").notNullable();
    table.timestamp("created_at").defaultTo(db.fn.now());
    table.primary(["user_id", "outlet_id", "product_id"]);
  });
}

async function productIsAvailableForOutlet(productId, outletId) {
  const product = await db("products").where({ id: productId, status: "active" }).first();
  if (!product) return false;
  const price = await db("product_prices").where({ product_id: productId, outlet_id: outletId, status: "active" }).where("price", ">", 0).first();
  return Boolean(price);
}

async function getPosProductFavorites({ outletId } = {}, userId) {
  await ensurePosProductFavoritesTable();
  const rows = await db("pos_product_favorites").where({ user_id: userId, outlet_id: outletId }).orderBy("created_at", "asc");
  const productIds = [];
  for (const row of rows) {
    if (await productIsAvailableForOutlet(row.product_id, outletId)) {
      productIds.push(row.product_id);
    }
  }
  return { outlet_id: outletId, product_ids: [...new Set(productIds)] };
}

async function updatePosProductFavorites(payload = {}, userId) {
  await ensurePosProductFavoritesTable();
  const outletId = payload.outlet_id || payload.outletId;
  const submittedIds = [...new Set((payload.product_ids || payload.productIds || []).map((id) => String(id)))];
  const outlet = await db("outlets").where({ id: outletId, status: "active" }).first();
  if (!outlet) throw new Error("Outlet tidak valid.");

  const userOutlet = await db("user_outlets").where({ user_id: userId, outlet_id: outletId }).first();
  if (!userOutlet) throw new Error("Outlet tidak tersedia untuk user ini.");

  const validProductIds = [];
  for (const productId of submittedIds) {
    if (!(await productIsAvailableForOutlet(productId, outletId))) {
      throw new Error("Produk favorit harus aktif dan tersedia di outlet ini.");
    }
    validProductIds.push(productId);
  }

  await db.transaction(async (trx) => {
    await trx("pos_product_favorites").where({ user_id: userId, outlet_id: outletId }).delete();
    if (validProductIds.length) {
      await trx("pos_product_favorites").insert(
        validProductIds.map((productId) => ({
          user_id: userId,
          outlet_id: outletId,
          product_id: productId,
          created_at: new Date()
        }))
      );
    }
    await trx("activity_logs").insert({
      id: createRuntimeId("activity"),
      actor_user_id: userId,
      outlet_id: outletId,
      source: "kasir_app",
      module: "product_favorite",
      action: "update",
      entity_type: "product_favorite",
      entity_id: outletId,
      description: "Kasir memperbarui favorit produk.",
      metadata_json: { count: validProductIds.length },
      created_at: new Date()
    });
  });

  return { outlet_id: outletId, product_ids: validProductIds };
}

async function createUser(payload = {}, actorUserId = null) {
  const userPayload = normalizeUserAdminPayload(payload, { isCreate: true });
  const selectedRole = await roleById(userPayload.role_id);
  if (!selectedRole) throw new Error("Role tidak ditemukan.");
  const apkEnabled = hasApkAccess(selectedRole);
  if (apkEnabled && !/^\d{6}$/.test(userPayload.cashier_pin)) {
    throw new Error("PIN APK wajib diisi 6 digit.");
  }
  await assertUniqueDbUser(userPayload);

  const bcrypt = require("bcryptjs");
  const userId = createRuntimeId("user");
  await db.transaction(async (trx) => {
    await trx("users").insert({
      id: userId,
      name: userPayload.name,
      username: userPayload.username,
      email: userPayload.email,
      password_hash: bcrypt.hashSync(payload.password || "admin123", 10),
      pin_hash: apkEnabled ? bcrypt.hashSync(userPayload.cashier_pin, 10) : null,
      role_id: userPayload.role_id,
      status: userPayload.status
    });
    await replaceUserOutlets(trx, userId, userPayload.outlet_ids);
  });

  await writeDbActivityLog({
    actor_user_id: actorUserId,
    module: "user",
    action: "create",
    entity_type: "user",
    entity_id: userId,
    description: `User ${userPayload.name} dibuat.`,
    metadata_json: {
      role_id: userPayload.role_id,
      outlet_ids: userPayload.outlet_ids,
      status: userPayload.status
    }
  });

  return dbUserRowForAdmin(userId);
}

async function updateUser(userId, payload = {}, actorUserId = null) {
  const current = await dbUserRowForAdmin(userId);
  const userPayload = normalizeUserAdminPayload(payload, {
    currentUser: current
  });
  const selectedRole = await roleById(userPayload.role_id);
  if (!selectedRole) throw new Error("Role tidak ditemukan.");
  const apkEnabled = hasApkAccess(selectedRole);
  if (apkEnabled && !userPayload.cashier_pin && !current.has_pin) {
    throw new Error("PIN APK wajib diisi 6 digit.");
  }
  await assertUniqueDbUser({ ...userPayload, userId });

  const bcrypt = require("bcryptjs");
  const updatePayload = {
    name: userPayload.name,
    username: userPayload.username,
    email: userPayload.email,
    role_id: userPayload.role_id,
    status: userPayload.status
  };
  if (apkEnabled && userPayload.cashier_pin) {
    updatePayload.pin_hash = bcrypt.hashSync(userPayload.cashier_pin, 10);
  }
  if (!apkEnabled) {
    updatePayload.pin_hash = null;
  }

  await db.transaction(async (trx) => {
    await trx("users").where({ id: userId }).update(updatePayload);
    await replaceUserOutlets(trx, userId, userPayload.outlet_ids);
  });

  await writeDbActivityLog({
    actor_user_id: actorUserId,
    module: "user",
    action: "update",
    entity_type: "user",
    entity_id: userId,
    description: `User ${userPayload.name} diperbarui.`,
    metadata_json: {
      role_id: userPayload.role_id,
      outlet_ids: userPayload.outlet_ids,
      status: userPayload.status
    }
  });

  return dbUserRowForAdmin(userId);
}

async function updateProfile(userId, payload = {}, actorUserId = null) {
  const profilePayload = normalizeProfileAdminPayload(payload);
  await assertUniqueDbUser({ ...profilePayload, userId });

  await db("users").where({ id: userId }).update({
    name: profilePayload.name,
    username: profilePayload.username,
    email: profilePayload.email
  });

  await writeDbActivityLog({
    actor_user_id: actorUserId || userId,
    module: "profile",
    action: "update",
    entity_type: "user",
    entity_id: userId,
    description: `Profil ${profilePayload.name} diperbarui.`
  });

  return dbUserRowForAdmin(userId);
}

async function changeProfilePassword(userId, payload = {}, actorUserId = null) {
  const user = await db("users").where({ id: userId }).first();
  if (!user) throw new Error("User tidak ditemukan.");

  const currentPassword = String(payload.current_password || "");
  const newPassword = String(payload.new_password || "");
  const confirmPassword = String(payload.confirm_password || "");
  if (!currentPassword) throw new Error("Password lama wajib diisi.");
  if (newPassword.length < 6) throw new Error("Password baru minimal 6 karakter.");
  if (newPassword !== confirmPassword) throw new Error("Konfirmasi password tidak sama.");

  const bcrypt = require("bcryptjs");
  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) throw new Error("Password lama tidak sesuai.");

  await db("users")
    .where({ id: userId })
    .update({
      password_hash: bcrypt.hashSync(newPassword, 10),
      password_changed_at: new Date()
    });

  await writeDbActivityLog({
    actor_user_id: actorUserId || userId,
    module: "profile",
    action: "change_password",
    entity_type: "user",
    entity_id: userId,
    description: `Password profil ${user.name} diganti.`
  });

  return dbUserRowForAdmin(userId);
}

async function toggleUserStatus(userId, actorUserId = null) {
  const user = await db("users").where({ id: userId }).first();
  if (!user) throw new Error("User tidak ditemukan.");
  const status = user.status === "active" ? "inactive" : "active";
  await db("users").where({ id: userId }).update({ status });
  await writeDbActivityLog({
    actor_user_id: actorUserId,
    module: "user",
    action: "toggle_status",
    entity_type: "user",
    entity_id: userId,
    description: `Status user ${user.name} menjadi ${status}.`,
    metadata_json: { status }
  });
  return dbUserRowForAdmin(userId);
}

async function resetUserPassword(userId, actorUserId = null) {
  const user = await db("users").where({ id: userId }).first();
  if (!user) throw new Error("User tidak ditemukan.");
  const temporaryPassword = createTemporaryPassword();
  const bcrypt = require("bcryptjs");
  await db("users")
    .where({ id: userId })
    .update({
      password_hash: bcrypt.hashSync(temporaryPassword, 10),
      password_reset_at: new Date()
    });
  await writeDbActivityLog({
    actor_user_id: actorUserId,
    module: "user",
    action: "reset_password",
    entity_type: "user",
    entity_id: userId,
    description: `Password user ${user.name} direset.`
  });
  return {
    user: await dbUserRowForAdmin(userId),
    temporary_password: temporaryPassword
  };
}

const protectedRoleIds = new Set(["role_owner", "role_admin", "role_cashier"]);

function normalizeRoleAdminPayload(payload = {}) {
  const name = String(payload.name || "").trim();
  const description = String(payload.description || "").trim();
  if (name.length < 2) throw new Error("Nama role minimal 2 karakter.");
  if (name.length > 80) throw new Error("Nama role maksimal 80 karakter.");
  if (description.length > 500) throw new Error("Deskripsi role maksimal 500 karakter.");
  return { name, description: description || null };
}

async function assertUniqueDbRole(name, roleId = null) {
  const duplicate = await db("roles")
    .whereRaw("LOWER(name) = LOWER(?)", [name])
    .modify((query) => {
      if (roleId) query.whereNot({ id: roleId });
    })
    .first();
  if (duplicate) throw new Error("Nama role sudah digunakan.");
}

async function createRole(payload = {}, actorUserId = null) {
  const rolePayload = normalizeRoleAdminPayload(payload);
  await assertUniqueDbRole(rolePayload.name);
  const roleId = createRuntimeId("role");
  await db("roles").insert({
    id: roleId,
    name: rolePayload.name,
    description: rolePayload.description,
    permissions: JSON.stringify({})
  });
  await writeDbActivityLog({
    actor_user_id: actorUserId,
    module: "permission",
    action: "create_role",
    entity_type: "role",
    entity_id: roleId,
    description: `Role ${rolePayload.name} dibuat.`,
    metadata_json: { name: rolePayload.name }
  });
  return normalizeRole(await db("roles").where({ id: roleId }).first());
}

async function updateRole(roleId, payload = {}, actorUserId = null) {
  const current = await db("roles").where({ id: roleId }).first();
  if (!current) throw new Error("Role tidak ditemukan.");
  if (roleId === "role_owner") throw new Error("Role Owner dikunci agar akses penuh tetap aman.");
  const rolePayload = normalizeRoleAdminPayload(payload);
  await assertUniqueDbRole(rolePayload.name, roleId);
  await db("roles").where({ id: roleId }).update(rolePayload);
  await writeDbActivityLog({
    actor_user_id: actorUserId,
    module: "permission",
    action: "update_role",
    entity_type: "role",
    entity_id: roleId,
    description: `Role ${rolePayload.name} diperbarui.`,
    metadata_json: {
      before: { name: current.name, description: current.description },
      after: rolePayload
    }
  });
  return normalizeRole(await db("roles").where({ id: roleId }).first());
}

async function deleteRole(roleId, actorUserId = null) {
  const role = await db("roles").where({ id: roleId }).first();
  if (!role) throw new Error("Role tidak ditemukan.");
  if (protectedRoleIds.has(roleId)) throw new Error("Role bawaan tidak dapat dihapus.");
  const assignedUsers = Number((await db("users").where({ role_id: roleId }).count({ count: "*" }).first())?.count || 0);
  if (assignedUsers > 0) {
    const error = new Error(`Role masih digunakan oleh ${assignedUsers} user.`);
    error.status = 409;
    error.code = "ROLE_IN_USE";
    throw error;
  }
  await db("roles").where({ id: roleId }).delete();
  await writeDbActivityLog({
    actor_user_id: actorUserId,
    module: "permission",
    action: "delete_role",
    entity_type: "role",
    entity_id: roleId,
    description: `Role ${role.name} dihapus.`,
    metadata_json: {
      name: role.name,
      permissions: parseJson(role.permissions, {})
    }
  });
  return { id: roleId, deleted: true };
}

async function updateRolePermissions(roleId, permissions = {}, actorUserId = null) {
  const role = await db("roles").where({ id: roleId }).first();
  if (!role) throw new Error("Role tidak ditemukan.");
  if (role.id === "role_owner") throw new Error("Permission Owner dikunci agar akses penuh tetap aman.");

  const permissionRows = await db("permissions");
  const allowedByKey = new Map(permissionRows.map((permission) => [permission.key, parseJson(permission.actions, [])]));
  const nextPermissions = Object.entries(permissions || {}).reduce((result, [permissionKey, actions]) => {
    const allowedActions = allowedByKey.get(permissionKey);
    if (!allowedActions) return result;
    const filtered = (Array.isArray(actions) ? actions : []).filter((action) => allowedActions.includes(action));
    if (permissionKey.startsWith("apk.") && filtered.length && !filtered.includes("view") && allowedActions.includes("view")) {
      filtered.unshift("view");
    }
    result[permissionKey] = filtered;
    return result;
  }, {});

  await db("roles")
    .where({ id: roleId })
    .update({ permissions: JSON.stringify(nextPermissions) });
  await writeDbActivityLog({
    actor_user_id: actorUserId,
    module: "permission",
    action: "update_permissions",
    entity_type: "role",
    entity_id: roleId,
    description: `Permission role ${role.name} diperbarui.`,
    metadata_json: { permission_count: Object.keys(nextPermissions).length }
  });

  return normalizeRole(await db("roles").where({ id: roleId }).first());
}

async function createRecord(entity) {
  throw mysqlImplementationMissing(`createRecord:${entity}`);
}

// ─── FITUR LAPORAN HARIAN KASIR & APPROVAL ────────────────────────────────
async function getDailyReports(filters = {}) {
  let query = db("daily_reports");
  
  if (filters.outletId && filters.outletId !== "all") {
    query = query.where({ outlet_id: filters.outletId });
  }
  if (filters.status) {
    query = query.where({ status: filters.status });
  }
  if (filters.from) {
    query = query.where("report_date", ">=", dateOnly(filters.from));
  }
  if (filters.to) {
    query = query.where("report_date", "<=", dateOnly(filters.to));
  }
  
  query = query.orderBy("report_date", "desc");
  const reports = await query;
  return reports.map((row) => ({
    ...row,
    details_json: typeof row.details_json === "string" ? JSON.parse(row.details_json) : row.details_json
  }));
}

async function createDailyReport(payload = {}, createdBy = null) {
  const id = createRuntimeId("drep");
  const now = new Date();
  
  const reportDate = dateOnly(payload.reportDate || payload.report_date || now);
  const outletId = String(payload.outletId || payload.outlet_id || "").trim();
  const cashierId = createdBy || String(payload.cashierId || payload.cashier_id || "").trim();
  
  if (!outletId) throw new Error("Outlet wajib diisi.");
  if (!cashierId) throw new Error("Kasir wajib diisi.");

  const row = {
    id,
    outlet_id: outletId,
    report_date: reportDate,
    cashier_id: cashierId,
    cash_income: Math.max(0, Number(payload.cashIncome || payload.cash_income || 0)),
    transfer_income: Math.max(0, Number(payload.transferIncome || payload.transfer_income || 0)),
    qris_income: Math.max(0, Number(payload.qrisIncome || payload.qris_income || 0)),
    total_income: Math.max(0, Number(payload.totalIncome || payload.total_income || 0)),
    total_expense: Math.max(0, Number(payload.totalExpense || payload.total_expense || 0)),
    return_cash_amount: Math.max(0, Number(payload.returnCashAmount || payload.return_cash_amount || 0)),
    return_cash_date: payload.returnCashDate || payload.return_cash_date ? dateOnly(payload.returnCashDate || payload.return_cash_date) : null,
    gross_profit: Number(payload.grossProfit || payload.gross_profit || 0),
    drawer_money: Number(payload.drawerMoney || payload.drawer_money || 0),
    status: "pending",
    details_json: JSON.stringify(payload.details || payload.details_json || []),
    created_at: now,
    updated_at: now
  };
  
  await db("daily_reports").insert(row);
  
  await writeDbActivityLog({
    actor_user_id: cashierId,
    outlet_id: outletId,
    module: "daily_report",
    action: "create",
    entity_type: "daily_report",
    entity_id: id,
    description: `Kasir men-submit laporan harian tanggal ${row.report_date}.`,
    metadata_json: {
      total_income: row.total_income,
      total_expense: row.total_expense,
      return_cash_amount: row.return_cash_amount
    }
  });

  return {
    ...row,
    details_json: JSON.parse(row.details_json)
  };
}

async function approveDailyReport(id, approvedBy = null) {
  const report = await db("daily_reports").where({ id }).first();
  if (!report) throw new Error("Laporan harian tidak ditemukan.");
  if (report.status !== "pending") throw new Error("Hanya laporan pending yang bisa di-approve.");
  
  const now = new Date();
  const details = typeof report.details_json === "string" ? JSON.parse(report.details_json) : report.details_json || [];
  
  await db.transaction(async (trx) => {
    // 1. Update status laporan harian
    await trx("daily_reports")
      .where({ id })
      .update({
        status: "approved",
        approved_by: approvedBy,
        approved_at: now,
        updated_at: now
      });
      
    // 2. Loop detail pengeluaran & masukkan ke purchases/expenses
    const hppItems = details.filter(item => item.isHpp && item.rawMaterial);
    const regularExpenses = details.filter(item => !item.isHpp && item.expenseCategory);
    
    // a. Proses HPP sebagai Single Purchase
    if (hppItems.length > 0) {
      const purchaseItemsPayload = hppItems.map(item => ({
        material_id: item.rawMaterial.id,
        material_name: item.rawMaterial.name,
        unit: item.rawMaterial.unit,
        quantity: Number(item.quantity || 0),
        unit_price: Number(item.price || 0),
        subtotal: Number(item.price || 0) * Number(item.quantity || 0)
      }));
      
      const purchaseTotal = purchaseItemsPayload.reduce((sum, item) => sum + item.subtotal, 0);
      
      const purchaseRow = {
        id: createRuntimeId("purchase"),
        outlet_id: report.outlet_id,
        supplier_id: null,
        supplier_name: "Pembelian Langsung (Harian Kasir)",
        payment_type: "cash",
        purchase_date: serializeMysqlDateTime(report.report_date),
        subtotal: purchaseTotal,
        discount: 0,
        tax: 0,
        total: purchaseTotal,
        status: "approved",
        note: `Pembelian HPP dari Laporan Harian ${report.id}`,
        created_by: report.cashier_id,
        approved_by: approvedBy,
        approved_at: now,
        created_at: now,
        updated_at: now
      };
      
      await trx("purchases").insert(purchaseRow);
      await trx("purchase_items").insert(
        purchaseItemsPayload.map(item => ({
          id: createRuntimeId("purchase_item"),
          purchase_id: purchaseRow.id,
          ...item
        }))
      );
      
      // Update stok bahan baku di database
      await applyApprovedPurchaseStockDb(trx, { ...purchaseRow, items: purchaseItemsPayload }, 1);
      await refreshPurchasePriceSnapshotsDb(
        trx,
        purchaseItemsPayload.map(item => item.material_id),
        [purchaseRow.outlet_id]
      );
    }
    
    // b. Proses Biaya Lain-lain (Expenses)
    for (const item of regularExpenses) {
      const expenseRow = {
        id: createRuntimeId("expense"),
        outlet_id: report.outlet_id,
        category: item.expenseCategory.name,
        amount: Number(item.amount || 0),
        note: item.note || "Biaya dari Laporan Harian Kasir",
        expense_date: serializeMysqlDateTime(report.report_date),
        status: "approved",
        created_by: report.cashier_id,
        approved_by: approvedBy,
        approved_at: now,
        created_at: now,
        updated_at: now
      };
      await trx("expenses").insert(expenseRow);
    }
  });
  
  await writeDbActivityLog({
    actor_user_id: approvedBy,
    outlet_id: report.outlet_id,
    module: "daily_report",
    action: "approve",
    entity_type: "daily_report",
    entity_id: id,
    description: `Admin menyetujui laporan harian kasir tanggal ${report.report_date}.`,
    metadata_json: {
      approved_by: approvedBy
    }
  });
  
  return {
    ...report,
    status: "approved",
    approved_by: approvedBy,
    approved_at: now
  };
}

async function rejectDailyReport(id, rejectedBy = null) {
  const report = await db("daily_reports").where({ id }).first();
  if (!report) throw new Error("Laporan harian tidak ditemukan.");
  if (report.status !== "pending") throw new Error("Hanya laporan pending yang bisa di-reject.");
  
  const now = new Date();
  
  await db("daily_reports")
    .where({ id })
    .update({
      status: "rejected",
      approved_by: rejectedBy,
      approved_at: now,
      updated_at: now
    });
    
  await writeDbActivityLog({
    actor_user_id: rejectedBy,
    outlet_id: report.outlet_id,
    module: "daily_report",
    action: "reject",
    entity_type: "daily_report",
    entity_id: id,
    description: `Admin menolak laporan harian kasir tanggal ${report.report_date}.`,
    metadata_json: {
      rejected_by: rejectedBy
    }
  });
  
  return {
    ...report,
    status: "rejected",
    approved_by: rejectedBy,
    approved_at: now
  };
}

async function updateDailyReport(id, payload = {}, updatedBy = null) {
  const report = await db("daily_reports").where({ id }).first();
  if (!report) throw new Error("Laporan harian tidak ditemukan.");
  if (report.status !== "pending") throw new Error("Hanya laporan pending yang bisa diedit.");

  if (report.report_date && !canEditReport(report.report_date)) {
    throw new Error("Batas waktu edit laporan harian (12:00 WIB keesokan harinya) sudah terlewati.");
  }

  const now = new Date();
  const updateData = {
    cash_income: Math.max(0, Number(payload.cashIncome ?? payload.cash_income ?? report.cash_income)),
    transfer_income: Math.max(0, Number(payload.transferIncome ?? payload.transfer_income ?? report.transfer_income)),
    qris_income: Math.max(0, Number(payload.qrisIncome ?? payload.qris_income ?? report.qris_income)),
    total_income: Math.max(0, Number(payload.totalIncome ?? payload.total_income ?? report.total_income)),
    total_expense: Math.max(0, Number(payload.totalExpense ?? payload.total_expense ?? report.total_expense)),
    return_cash_amount: Math.max(0, Number(payload.returnCashAmount ?? payload.return_cash_amount ?? report.return_cash_amount)),
    gross_profit: Number(payload.grossProfit ?? payload.gross_profit ?? report.gross_profit),
    drawer_money: Number(payload.drawerMoney ?? payload.drawer_money ?? report.drawer_money),
    updated_at: now
  };

  if (payload.details || payload.details_json) {
    updateData.details_json = JSON.stringify(payload.details ?? payload.details_json);
  }

  await db("daily_reports").where({ id }).update(updateData);

  return {
    ...report,
    ...updateData,
    details_json: typeof updateData.details_json === "string" ? JSON.parse(updateData.details_json) : (payload.details ?? payload.details_json ?? report.details_json)
  };
}

async function deleteDailyReport(id, deletedBy = null) {
  const report = await db("daily_reports").where({ id }).first();
  if (!report) throw new Error("Laporan harian tidak ditemukan.");
  if (report.status !== "pending") throw new Error("Hanya laporan pending yang bisa dihapus.");
  
  await db("daily_reports").where({ id }).delete();
  
  await writeDbActivityLog({
    actor_user_id: deletedBy,
    outlet_id: report.outlet_id,
    module: "daily_report",
    action: "delete",
    entity_type: "daily_report",
    entity_id: id,
    description: `Admin menghapus laporan harian kasir tanggal ${report.report_date}.`,
    metadata_json: { deleted_by: deletedBy }
  });
  
  return { success: true };
}

module.exports = {
  withActivityActor,
  callMockAdmin,
  adminImportApi,
  userByUsername: pick(userByUsername, mockUserByUsername),
  userById: pick(userById, mockUserById),
  cashiersForPinLogin: pick(cashiersForPinLogin, mockCashiersForPinLogin),
  verifyPassword,
  verifyCashierPin,
  updateLastLogin,
  getBootstrap: pick(getBootstrap, () => adminMockApi.getBootstrap()),
  getDashboard: pick(getDashboard, (filters) => adminMockApi.getDashboard(filters)),
  getDashboardMaterialPurchaseComparisons: pick(getDashboardMaterialPurchaseComparisons, (filters) => adminMockApi.getDashboardMaterialPurchaseComparisons(filters)),
  getSalesOutletComparison: pick(getSalesOutletComparison, (filters) => adminMockApi.getSalesOutletComparison(filters)),
  getReportAccountDetail: pick(getReportAccountDetail, (filters) => adminMockApi.getReportAccountDetail(filters)),
  getMasterData: pick(getMasterData, (filters) => adminMockApi.getMasterData(filters)),
  createCategory: pick(createCategory, (payload) => adminMockApi.createCategory(payload)),
  getCategoryDetail: pick(getCategoryDetail, (id) => adminMockApi.getCategoryDetail(id)),
  updateCategory: pick(updateCategory, (id, payload) => adminMockApi.updateCategory(id, payload)),
  toggleCategoryStatus: pick(toggleCategoryStatus, (id, actorUserId) => adminMockApi.toggleCategoryStatus(id, actorUserId)),
  getProductDetail: pick(getProductDetail, (id) => adminMockApi.getProductDetail(id)),
  createProduct: pick(createProduct, (payload) => adminMockApi.createProduct(payload)),
  updateProduct: pick(updateProduct, (id, payload) => adminMockApi.updateProduct(id, payload)),
  toggleProductStatus: pick(toggleProductStatus, (id, actorUserId) => adminMockApi.toggleProductStatus(id, actorUserId)),
  createProductComposition: pick(createProductComposition, (payload) => adminMockApi.createProductComposition(payload)),
  updateProductComposition: pick(updateProductComposition, (id, payload) => adminMockApi.updateProductComposition(id, payload)),
  deleteProductComposition: pick(deleteProductComposition, (id) => adminMockApi.deleteProductComposition(id)),
  createOutlet: pick(createOutlet, (payload) => adminMockApi.createOutlet(payload)),
  getOutletDetail: pick(getOutletDetail, (id) => adminMockApi.getOutletDetail(id)),
  updateOutlet: pick(updateOutlet, (id, payload) => adminMockApi.updateOutlet(id, payload)),
  toggleOutletStatus: pick(toggleOutletStatus, (id, actorUserId) => adminMockApi.toggleOutletStatus(id, actorUserId)),
  createTable: pick(createTable, (payload) => adminMockApi.createTable(payload)),
  generateTables: pick(generateTables, (payload) => adminMockApi.generateTables(payload)),
  getTableDetail: pick(getTableDetail, (id) => adminMockApi.getTableDetail(id)),
  updateTable: pick(updateTable, (id, payload) => adminMockApi.updateTable(id, payload)),
  toggleTableStatus: pick(toggleTableStatus, (id, actorUserId) => adminMockApi.toggleTableStatus(id, actorUserId)),
  createSupplier: pick(createSupplier, (payload) => adminMockApi.createSupplier(payload)),
  getSupplierDetail: pick(getSupplierDetail, (id) => adminMockApi.getSupplierDetail(id)),
  updateSupplier: pick(updateSupplier, (id, payload) => adminMockApi.updateSupplier(id, payload)),
  toggleSupplierStatus: pick(toggleSupplierStatus, (id, actorUserId) => adminMockApi.toggleSupplierStatus(id, actorUserId)),
  createPaymentMethod: pick(createPaymentMethod, (payload) => adminMockApi.createPaymentMethod(payload)),
  updatePaymentMethod: pick(updatePaymentMethod, (id, payload) => adminMockApi.updatePaymentMethod(id, payload)),
  togglePaymentMethodStatus: pick(togglePaymentMethodStatus, (id, actorUserId) => adminMockApi.togglePaymentMethodStatus(id, actorUserId)),
  createDiscount: pick(createDiscount, (payload) => adminMockApi.createDiscount(payload)),
  updateDiscount: pick(updateDiscount, (id, payload) => adminMockApi.updateDiscount(id, payload)),
  toggleDiscountStatus: pick(toggleDiscountStatus, (id, actorUserId) => adminMockApi.toggleDiscountStatus(id, actorUserId)),
  createExpenseCategory: pick(createExpenseCategory, (payload) => adminMockApi.createExpenseCategory(payload)),
  getExpenseCategoryDetail: pick(getExpenseCategoryDetail, (id) => adminMockApi.getExpenseCategoryDetail(id)),
  updateExpenseCategory: pick(updateExpenseCategory, (id, payload) => adminMockApi.updateExpenseCategory(id, payload)),
  toggleExpenseCategoryStatus: pick(toggleExpenseCategoryStatus, (id, actorUserId) => adminMockApi.toggleExpenseCategoryStatus(id, actorUserId)),
  correctExpenseAmount: pick(correctExpenseAmount, (id, payload) => adminMockApi.correctExpenseAmount(id, payload)),
  approveExpense: pick(approveExpense, (id, payload) => adminMockApi.approveExpense(id, payload)),
  rejectExpense: pick(rejectExpense, (id, payload) => adminMockApi.rejectExpense(id, payload)),
  createMaterialCategory: pick(createMaterialCategory, (payload) => adminMockApi.createMaterialCategory(payload)),
  getMaterialCategoryDetail: pick(getMaterialCategoryDetail, (id) => adminMockApi.getMaterialCategoryDetail(id)),
  updateMaterialCategory: pick(updateMaterialCategory, (id, payload) => adminMockApi.updateMaterialCategory(id, payload)),
  toggleMaterialCategoryStatus: pick(toggleMaterialCategoryStatus, (id, actorUserId) => adminMockApi.toggleMaterialCategoryStatus(id, actorUserId)),
  createMaterial: pick(createMaterial, (payload) => adminMockApi.createMaterial(payload)),
  updateMaterial: pick(updateMaterial, (id, payload) => adminMockApi.updateMaterial(id, payload)),
  toggleMaterialStatus: pick(toggleMaterialStatus, (id, actorUserId) => adminMockApi.toggleMaterialStatus(id, actorUserId)),
  createUnit: pick(createUnit, (payload) => adminMockApi.createUnit(payload)),
  updateUnit: pick(updateUnit, (id, payload) => adminMockApi.updateUnit(id, payload)),
  toggleUnitStatus: pick(toggleUnitStatus, (id, actorUserId) => adminMockApi.toggleUnitStatus(id, actorUserId)),
  createFinancialAccount: pick(createFinancialAccount, (payload) => adminMockApi.createFinancialAccount(payload)),
  updateFinancialAccount: pick(updateFinancialAccount, (id, payload) => adminMockApi.updateFinancialAccount(id, payload)),
  toggleFinancialAccountStatus: pick(toggleFinancialAccountStatus, (id, actorUserId) => adminMockApi.toggleFinancialAccountStatus(id, actorUserId)),
  createFinanceEntryGroup: pick(createFinanceEntryGroup, (payload) => adminMockApi.createFinanceEntryGroup(payload)),
  updateFinanceEntryGroup: pick(updateFinanceEntryGroup, (id, payload) => adminMockApi.updateFinanceEntryGroup(id, payload)),
  toggleFinanceEntryGroupStatus: pick(toggleFinanceEntryGroupStatus, (id, actorUserId) => adminMockApi.toggleFinanceEntryGroupStatus(id, actorUserId)),
  createFinanceEntry: pick(createFinanceEntry, (payload) => adminMockApi.createFinanceEntry(payload)),
  updateFinanceEntry: pick(updateFinanceEntry, (id, payload) => adminMockApi.updateFinanceEntry(id, payload)),
  toggleFinanceEntryStatus: pick(toggleFinanceEntryStatus, (id, actorUserId) => adminMockApi.toggleFinanceEntryStatus(id, actorUserId)),
  createReserveFund: pick(createReserveFund, (payload) => adminMockApi.createReserveFund(payload)),
  updateReserveFund: pick(updateReserveFund, (id, payload) => adminMockApi.updateReserveFund(id, payload)),
  toggleReserveFundStatus: pick(toggleReserveFundStatus, (id, actorUserId) => adminMockApi.toggleReserveFundStatus(id, actorUserId)),
  createUser: pick(createUser, (payload) => adminMockApi.createUser(payload)),
  updateUser: pick(updateUser, (id, payload) => adminMockApi.updateUser(id, payload)),
  updateProfile: pick(updateProfile, (id, payload) => adminMockApi.updateProfile(id, payload)),
  changeProfilePassword: pick(changeProfilePassword, (id, payload) => adminMockApi.changeProfilePassword(id, payload)),
  generateCustomerBarcode: pick(generateCustomerBarcode, (outletId) => adminMockApi.generateCustomerBarcode(outletId)),
  getCustomerDetail: pick(getCustomerDetail, (id) => adminMockApi.getCustomerDetail(id)),
  createCustomer: pick(createCustomer, (payload) => adminMockApi.createCustomer(payload)),
  updateCustomer: pick(updateCustomer, (id, payload) => adminMockApi.updateCustomer(id, payload)),
  toggleCustomerStatus: pick(toggleCustomerStatus, (id) => adminMockApi.toggleCustomerStatus(id)),
  toggleUserStatus: pick(toggleUserStatus, (id) => adminMockApi.toggleUserStatus(id)),
  resetUserPassword: pick(resetUserPassword, (id) => adminMockApi.resetUserPassword(id)),
  createRole: pick(createRole, (payload, actorUserId) => adminMockApi.createRole(payload, actorUserId)),
  updateRole: pick(updateRole, (id, payload, actorUserId) => adminMockApi.updateRole(id, payload, actorUserId)),
  deleteRole: pick(deleteRole, (id, actorUserId) => adminMockApi.deleteRole(id, actorUserId)),
  updateRolePermissions: pick(updateRolePermissions, (roleId, permissions) => adminMockApi.updateRolePermissions(roleId, permissions)),
  createRecord: pick(createRecord, (entity, payload) => adminMockApi.createRecord(entity, payload)),
  getInventory: pick(getInventory, (filters) => adminMockApi.getInventory(filters)),
  getStockOpnameWorksheet: pick(getStockOpnameWorksheet, (filters) => adminMockApi.getStockOpnameWorksheet(filters)),
  getStockOpnameMaterialSelection: pick(getStockOpnameMaterialSelection, (filters) => adminMockApi.getStockOpnameMaterialSelection(filters)),
  updateStockOpnameMaterialSelection: pick(updateStockOpnameMaterialSelection, (payload, actorUserId) => adminMockApi.updateStockOpnameMaterialSelection(payload, actorUserId)),
  getStockOpnameRequests: pick(getStockOpnameRequests, (filters) => adminMockApi.getStockOpnameRequests(filters)),
  createStockOpname: pick(createStockOpname, (payload) => adminMockApi.createStockOpname(payload)),
  createStockOpnameBatch: pick(createStockOpnameBatch, (payload) => adminMockApi.createStockOpnameBatch(payload)),
  approveStockOpnameRequest: pick(approveStockOpnameRequest, (id, payload) => adminMockApi.approveStockOpnameRequest(id, payload)),
  rejectStockOpnameRequest: pick(rejectStockOpnameRequest, (id, payload) => adminMockApi.rejectStockOpnameRequest(id, payload)),
  getReports: pick(getReports, (filters) => adminMockApi.getReports(filters)),
  correctTransactionItems: pick(correctTransactionItems, (id, payload, actorUserId) =>
    adminMockApi.correctTransactionItems(id, {
      ...payload,
      updated_by: actorUserId
    })
  ),
  refundTransaction: pick(refundTransaction, (id, payload, refundedBy) => adminMockApi.refundTransaction(id, { ...payload, refunded_by: refundedBy })),
  cancelTransaction: pick(cancelTransaction, (id, payload, cancelledBy) =>
    adminMockApi.cancelTransaction(id, {
      ...payload,
      cancelled_by: cancelledBy
    })
  ),
  uploadProductImage: pick(uploadProductImage, (productId, file) => adminMockApi.uploadProductImage(productId, file)),
  deleteProductImage: pick(deleteProductImage, (productId) => adminMockApi.deleteProductImage(productId)),
  getSettings: pick(getSettings, () => adminMockApi.getSettings()),
  updatePrintSettings: pick(updatePrintSettings, (payload) => adminMockApi.updatePrintSettings(payload)),
  updateAppSecuritySettings,
  getMobileCatalog: getMobileCatalogForSession,
  getPosHistory: pick(getPosHistory, (filters) => adminMockApi.getPosHistory(filters)),
  getPosReports: pick(getPosReports, (filters) => adminMockApi.getPosReports(filters)),
  getPosExpenses: pick(getPosExpenses, (filters) => adminMockApi.getPosExpenses(filters)),
  getPosMaterialStocks: pick(getPosMaterialStocks, (filters) => adminMockApi.getPosMaterialStocks(filters)),
  getPosProductFavorites: pick(getPosProductFavorites, (filters, userId) => adminMockApi.getPosProductFavorites(filters, userId)),
  updatePosProductFavorites: pick(updatePosProductFavorites, (payload, userId) => adminMockApi.updatePosProductFavorites(payload, userId)),
  getPosStockOpnameWorksheet: pick(getPosStockOpnameWorksheet, (filters) => adminMockApi.getPosStockOpnameWorksheet(filters)),
  getPosStockOpnameRequests: pick(getStockOpnameRequests, (filters) => adminMockApi.getStockOpnameRequests(filters)),
  getPosPurchases: pick(getPosPurchases, (filters) => adminMockApi.getPosPurchases(filters)),
  getPosTransfers: pick(getPosTransfers, (filters) => adminMockApi.getPosTransfers(filters)),
  getPosDiscounts: pick(getPosDiscounts, (filters) => adminMockApi.getPosDiscounts(filters)),
  getPosCustomers: pick(getPosCustomers, (filters) => adminMockApi.getPosCustomers(filters)),
  getActivityLogs: pick(getActivityLogs, (filters) => adminMockApi.getActivityLogs(filters)),
  createActivityLog: pick(createActivityLog, (payload) => adminMockApi.createActivityLog(payload)),
  createActivityLogs: pick(createActivityLogs, (payloads) => adminMockApi.createActivityLogs(payloads)),
  verifyReportPin,
  createPosCustomer: pick(createPosCustomer, (payload, createdBy) => adminMockApi.createPosCustomer({ ...payload, createdBy })),
  getOpenBills: pick(getOpenBills, ({ outletId } = {}) => adminMockApi.getOpenBills({ outletId })),
  upsertOpenBill: pick(upsertOpenBill, (payload) => adminMockApi.upsertOpenBill(payload)),
  updateOpenBillPrintCheckpoint: pick(updateOpenBillPrintCheckpoint, (id, payload, actorUserId) => adminMockApi.updateOpenBillPrintCheckpoint(id, payload, actorUserId)),
  deleteOpenBill: pick(deleteOpenBill, (openBillId) => adminMockApi.deleteOpenBill(openBillId)),
  createPosTransaction: pick(createPosTransaction, (payload, createdBy) => adminMockApi.createPosTransaction(payload, createdBy)),
  createPosExpense: pick(createPosExpense, (payload, createdBy) => adminMockApi.createPosExpense(payload, createdBy)),
  updatePosExpense: pick(updatePosExpense, (expenseId, payload, updatedBy) => adminMockApi.updatePosExpense(expenseId, payload, updatedBy)),
  createPosPurchaseBatch: pick(createPosPurchaseBatch, (payload, createdBy) => adminMockApi.createPosPurchaseBatch(payload, createdBy)),
  updatePosPurchaseBatch: pick(updatePosPurchaseBatch, (purchaseId, payload, updatedBy) => adminMockApi.updatePosPurchaseBatch(purchaseId, payload, updatedBy)),
  createPurchase: pick(createPurchase, (payload) => adminMockApi.createPurchase(payload)),
  updatePurchase: pick(updatePurchase, (id, payload) => adminMockApi.updatePurchase(id, payload)),
  approvePurchase: pick(approvePurchase, (id, payload) => adminMockApi.approvePurchase(id, payload)),
  rejectPurchase: pick(rejectPurchase, (id, payload) => adminMockApi.rejectPurchase(id, payload)),
  createPosTransferRequest: pick(createPosTransferRequest, (payload, createdBy) => adminMockApi.createPosTransferRequest(payload, createdBy)),
  createStockTransfer: pick(createStockTransfer, (payload) => adminMockApi.createStockTransfer(payload)),
  updateStockTransfer: pick(updateStockTransfer, (id, payload) => adminMockApi.updateStockTransfer(id, payload)),
  approveStockTransfer: pick(approveStockTransfer, (id, payload) => adminMockApi.approveStockTransfer(id, payload)),
  rejectStockTransfer: pick(rejectStockTransfer, (id, payload) => adminMockApi.rejectStockTransfer(id, payload)),
  createPosStockOpnameRequest: pick(createPosStockOpnameRequest, (payload, createdBy) => adminMockApi.createPosStockOpnameRequest(payload, createdBy)),
  updatePosStockOpnameRequest: pick(updatePosStockOpnameRequest, (id, payload, updatedBy) => adminMockApi.updatePosStockOpnameRequest(id, payload, updatedBy)),
  deletePosStockOpnameRequest: pick(deletePosStockOpnameRequest, (id, deletedBy) => adminMockApi.deletePosStockOpnameRequest(id, deletedBy)),
  createPosDiscount: pick(createPosDiscount, (payload, createdBy) => adminMockApi.createPosDiscount(payload, createdBy)),
  updatePosDiscount: pick(updatePosDiscount, (id, payload, updatedBy) => adminMockApi.updatePosDiscount(id, payload, updatedBy)),
// ─── FITUR LAPORAN HARIAN MANUAL ──────────────────────────────────────────
async function getManualDailyReports(filters = {}) {
  let query = db("manual_daily_reports");
  
  if (filters.outletId && filters.outletId !== "all") {
    query = query.where({ outlet_id: filters.outletId });
  }
  if (filters.from) {
    query = query.where("report_date", ">=", dateOnly(filters.from));
  }
  if (filters.to) {
    query = query.where("report_date", "<=", dateOnly(filters.to));
  }
  
  query = query.orderBy("report_date", "desc");
  const reports = await query;
  return reports.map((row) => ({
    ...row,
    details_json: typeof row.details_json === "string" ? JSON.parse(row.details_json) : row.details_json
  }));
}

async function createManualDailyReport(payload = {}, createdBy = null) {
  const id = createRuntimeId("mdrp");
  const now = new Date();
  
  const reportDate = dateOnly(payload.reportDate || payload.report_date || now);
  const outletId = String(payload.outletId || payload.outlet_id || "").trim();
  const userId = createdBy || String(payload.createdBy || payload.created_by || "").trim();
  
  if (!outletId) throw new Error("Outlet wajib diisi.");
  if (!userId) throw new Error("User pembuat wajib diisi.");
  if (!reportDate) throw new Error("Tanggal laporan wajib diisi.");

  const existing = await db("manual_daily_reports")
    .where({ report_date: reportDate, outlet_id: outletId })
    .first();
  if (existing) {
    throw new Error("Laporan harian manual untuk tanggal ini pada outlet yang dipilih sudah diisi.");
  }

  const row = {
    id,
    outlet_id: outletId,
    report_date: reportDate,
    cash_income: Math.max(0, Number(payload.cashIncome || payload.cash_income || 0)),
    transfer_income: Math.max(0, Number(payload.transferIncome || payload.transfer_income || 0)),
    qris_income: Math.max(0, Number(payload.qrisIncome || payload.qris_income || 0)),
    total_income: Math.max(0, Number(payload.totalIncome || payload.total_income || 0)),
    total_expense: Math.max(0, Number(payload.totalExpense || payload.total_expense || 0)),
    return_cash_amount: Math.max(0, Number(payload.returnCashAmount || payload.return_cash_amount || 0)),
    return_cash_date: payload.returnCashDate || payload.return_cash_date ? dateOnly(payload.returnCashDate || payload.return_cash_date) : null,
    details_json: JSON.stringify(payload.details || payload.details_json || []),
    notes: payload.notes ? String(payload.notes).trim() : null,
    created_by: userId,
    created_at: now,
    updated_at: now
  };

  await db("manual_daily_reports").insert(row);
  return {
    ...row,
    details_json: typeof row.details_json === "string" ? JSON.parse(row.details_json) : row.details_json
  };
}

// ─── FITUR LAPORAN LOGISTIK MANUAL ────────────────────────────────────────
async function getManualLogisticReports(filters = {}) {
  let query = db("manual_logistic_reports");
  
  if (filters.outletId && filters.outletId !== "all") {
    query = query.where({ outlet_id: filters.outletId });
  }
  if (filters.from) {
    query = query.where("report_date", ">=", dateOnly(filters.from));
  }
  if (filters.to) {
    query = query.where("report_date", "<=", dateOnly(filters.to));
  }
  
  query = query.orderBy("report_date", "desc");
  const reports = await query;
  return reports.map((row) => ({
    ...row,
    details_json: typeof row.details_json === "string" ? JSON.parse(row.details_json) : row.details_json
  }));
}

async function createManualLogisticReport(payload = {}, createdBy = null) {
  const id = createRuntimeId("mlrp");
  const now = new Date();
  
  const reportDate = dateOnly(payload.reportDate || payload.report_date || now);
  const outletId = String(payload.outletId || payload.outlet_id || "").trim();
  const userId = createdBy || String(payload.createdBy || payload.created_by || "").trim();
  
  if (!outletId) throw new Error("Outlet wajib diisi.");
  if (!userId) throw new Error("User pembuat wajib diisi.");
  if (!reportDate) throw new Error("Tanggal laporan wajib diisi.");

  const existing = await db("manual_logistic_reports")
    .where({ report_date: reportDate, outlet_id: outletId })
    .first();
  if (existing) {
    throw new Error("Laporan logistik manual untuk tanggal ini pada outlet yang dipilih sudah diisi.");
  }

  const row = {
    id,
    outlet_id: outletId,
    report_date: reportDate,
    supplier_id: payload.supplierId || payload.supplier_id || null,
    payment_type: payload.paymentType || payload.payment_type || "lunas",
    total_amount: Math.max(0, Number(payload.totalAmount || payload.total_amount || 0)),
    details_json: JSON.stringify(payload.details || payload.details_json || []),
    notes: payload.notes ? String(payload.notes).trim() : null,
    created_by: userId,
    created_at: now,
    updated_at: now
  };

  await db("manual_logistic_reports").insert(row);
  return {
    ...row,
    details_json: typeof row.details_json === "string" ? JSON.parse(row.details_json) : row.details_json
  };
}


module.exports = {
  // ... (existing exports)
  getDailyReports,
  createDailyReport,
  approveDailyReport,
  rejectDailyReport,
  updateDailyReport,
  deleteDailyReport,
  getManualDailyReports,
  createManualDailyReport,
  getManualLogisticReports,
  createManualLogisticReport
};

