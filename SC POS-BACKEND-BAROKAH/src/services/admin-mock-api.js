const fs = require("fs");
const { AsyncLocalStorage } = require("node:async_hooks");
const path = require("path");
const env = require("../config/env");
const { defaultRolePermissions, permissionCatalog, hasApkAccess } = require("../config/permission-catalog");
const { calculateStockOpname } = require("../modules/inventory/stock-opname-calculator");
const { buildDashboardSalesByOutlet } = require("../modules/dashboard/dashboard-sales-builder");
const { alphabeticPrefix, generateTableNumbers } = require("../modules/master-data/table-number-generator");
const { normalizeActivityPayload } = require("../modules/activity-logs/activity-log");
const { markActivityWritten } = require("../modules/activity-logs/activity-request-context");
const { calculateMaterialDeltas, calculatePaymentCorrection, calculatePointCorrection, calculateTransactionCorrectionTotals } = require("../modules/transactions/transaction-correction-calculator");
function includesText(value, keyword = "") {
  return String(value || "")
    .toLowerCase()
    .includes(String(keyword || "").toLowerCase());
}

const seedDataPath = path.join(__dirname, "../../database/seeds/data/pos-barokah-admin-demo.json");
const fallbackSeedDataPath = path.join(__dirname, "../../database/seeds/data/pos-barokah-admin-demo-bak.json");
const appTimeZone = "Asia/Jakarta";
const activityContext = new AsyncLocalStorage();
const delay = (ms = 220) => new Promise((resolve) => setTimeout(resolve, ms));
const clone = (value) => structuredClone(value);
const byId = (items) => new Map(items.map((item) => [item.id, item]));
const parseJsonSafe = (value, fallback = {}) => {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

let data = null;
let mockRuntimeInitialized = false;
let units = [];
let outletMap = new Map();
let roleMap = new Map();
let userMap = new Map();
let customerMap = new Map();
let productMap = new Map();
let categoryMap = new Map();
let materialCategoryMap = new Map();
let materialMap = new Map();
let supplierMap = new Map();
let tableMap = new Map();

function isMockDataAllowed() {
  const seedMode = String(process.env.SEED_MODE || "").toLowerCase();
  return env.dataMode === "mock" || seedMode === "demo";
}

function createMockDisabledError() {
  const error = new Error(`Mock data access is disabled in DATA_MODE=${env.dataMode}`);
  error.status = 500;
  error.code = "MOCK_DATA_DISABLED";
  return error;
}

function assertMockDataAllowed() {
  if (!isMockDataAllowed()) {
    throw createMockDisabledError();
  }
}

function ensureMockDataLoaded() {
  assertMockDataAllowed();
  if (!data) {
    const readableSeedPath = fs.existsSync(seedDataPath) ? seedDataPath : fallbackSeedDataPath;
    const seedData = JSON.parse(fs.readFileSync(readableSeedPath, "utf8"));
    data = clone(seedData);
    mockRuntimeInitialized = false;
  }
  return data;
}

function persistMockData() {
  if (process.env.NODE_ENV === "test" || process.env.PERSIST_MOCK_DATA === "false") return;
  ensureMockDataLoaded();
  fs.writeFileSync(seedDataPath, `${JSON.stringify(data, null, 2)}\n`);
}

function shouldPersistMethod(name) {
  return /^(create|update|upload|toggle|delete|reset|approve|reject|refund|upsert|change|correct|verify)/.test(String(name));
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

function withPersistence(api) {
  return new Proxy(api, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "withActivityActor" && !isMockDataAllowed()) {
        return (_actorId, action) => action();
      }
      if (typeof value !== "function") return value;

      return function guardedMockMethod(...args) {
        initializeMockRuntime();
        const result = value.apply(this, args);
        if (!shouldPersistMethod(prop)) return result;

        return Promise.resolve(result).then((resolved) => {
          persistMockData();
          return resolved;
        });
      };
    }
  });
}

const defaultRawMaterialCategories = [
  {
    id: "raw_mat_cat_hpp",
    name: "Harga Pokok Penjualan",
    type: "hpp",
    account_code: "5002",
    sort_order: 1,
    status: "active"
  },
  {
    id: "raw_mat_cat_operasional",
    name: "Operasional",
    type: "biaya",
    account_code: "6000",
    sort_order: 2,
    status: "active"
  }
];

const defaultPaymentMethods = [
  {
    id: "payment_method_cash",
    name: "Cash",
    code: "cash",
    account_code: "1001",
    sort_order: 1,
    status: "active"
  },
  {
    id: "payment_method_transfer",
    name: "Transfer",
    code: "transfer",
    account_code: "1002",
    sort_order: 2,
    status: "active"
  },
  {
    id: "payment_method_qris",
    name: "QRIS",
    code: "qris",
    account_code: "1044",
    sort_order: 3,
    status: "active"
  },
  {
    id: "payment_method_gofood",
    name: "GoFood",
    code: "gofood",
    account_code: "1005",
    sort_order: 4,
    status: "active"
  }
];

const defaultFinancialAccounts = [
  {
    id: "account_1001",
    code: "1001",
    name: "Kas",
    report_group: "cash_bank",
    normal_balance: "debit",
    sort_order: 1,
    status: "active"
  },
  {
    id: "account_1002",
    code: "1002",
    name: "Bank",
    report_group: "cash_bank",
    normal_balance: "debit",
    sort_order: 2,
    status: "active"
  },
  {
    id: "account_1044",
    code: "1044",
    name: "QRIS / E-Wallet",
    report_group: "cash_bank",
    normal_balance: "debit",
    sort_order: 3,
    status: "active"
  },
  {
    id: "account_1005",
    code: "1005",
    name: "GoFood / Penjualan Online",
    report_group: "cash_bank",
    normal_balance: "debit",
    sort_order: 4,
    status: "active"
  },
  {
    id: "account_1201",
    code: "1201",
    name: "Kasbon Karyawan / Piutang",
    report_group: "other_current_asset",
    normal_balance: "debit",
    sort_order: 15,
    status: "active"
  },
  {
    id: "account_1301",
    code: "1301",
    name: "Persediaan",
    report_group: "inventory",
    normal_balance: "debit",
    sort_order: 20,
    status: "active"
  },
  {
    id: "account_1431",
    code: "1431",
    name: "Dana Cadangan",
    report_group: "other_current_asset",
    normal_balance: "debit",
    sort_order: 30,
    status: "active"
  },
  {
    id: "account_1501",
    code: "1501",
    name: "Aset Tetap",
    report_group: "fixed_asset",
    normal_balance: "debit",
    sort_order: 40,
    status: "active"
  },
  {
    id: "account_1510",
    code: "1510",
    name: "Aset Bergerak",
    report_group: "moving_asset",
    normal_balance: "debit",
    sort_order: 41,
    status: "active"
  },
  {
    id: "account_2001",
    code: "2001",
    name: "Hutang / Bon Pembelian",
    report_group: "liability",
    normal_balance: "credit",
    sort_order: 60,
    status: "active"
  },
  {
    id: "account_3001",
    code: "3001",
    name: "Modal Pemilik",
    report_group: "equity",
    normal_balance: "credit",
    sort_order: 80,
    status: "active"
  },
  {
    id: "account_3999",
    code: "3999",
    name: "Laba Ditahan / Penyeimbang",
    report_group: "equity",
    normal_balance: "credit",
    sort_order: 99,
    status: "active"
  },
  {
    id: "account_4001",
    code: "4001",
    name: "Pendapatan Usaha",
    report_group: "income",
    normal_balance: "credit",
    sort_order: 100,
    status: "active"
  },
  {
    id: "account_4002",
    code: "4002",
    name: "Diskon Penjualan",
    report_group: "income",
    normal_balance: "debit",
    sort_order: 101,
    status: "active"
  },
  {
    id: "account_5002",
    code: "5002",
    name: "Harga Pokok Penjualan",
    report_group: "cogs",
    normal_balance: "debit",
    sort_order: 200,
    status: "active"
  },
  {
    id: "account_6000",
    code: "6000",
    name: "Biaya Operasional",
    report_group: "expense",
    normal_balance: "debit",
    sort_order: 300,
    status: "active"
  },
  {
    id: "account_6005",
    code: "6005",
    name: "Biaya Listrik dan Gas",
    report_group: "expense",
    normal_balance: "debit",
    sort_order: 305,
    status: "active"
  },
  {
    id: "account_6011",
    code: "6011",
    name: "Kebersihan",
    report_group: "expense",
    normal_balance: "debit",
    sort_order: 311,
    status: "active"
  },
  {
    id: "account_6012",
    code: "6012",
    name: "Transport",
    report_group: "expense",
    normal_balance: "debit",
    sort_order: 312,
    status: "active"
  },
  {
    id: "account_6013",
    code: "6013",
    name: "Perawatan",
    report_group: "expense",
    normal_balance: "debit",
    sort_order: 313,
    status: "active"
  },
  {
    id: "account_6014",
    code: "6014",
    name: "Packaging",
    report_group: "expense",
    normal_balance: "debit",
    sort_order: 314,
    status: "active"
  },
  {
    id: "account_6015",
    code: "6015",
    name: "Gaji Harian",
    report_group: "expense",
    normal_balance: "debit",
    sort_order: 315,
    status: "active"
  },
  {
    id: "account_6016",
    code: "6016",
    name: "Lauk Karyawan",
    report_group: "expense",
    normal_balance: "debit",
    sort_order: 316,
    status: "active"
  },
  {
    id: "account_6017",
    code: "6017",
    name: "Laundry Karyawan",
    report_group: "expense",
    normal_balance: "debit",
    sort_order: 317,
    status: "active"
  },
  {
    id: "account_6018",
    code: "6018",
    name: "Sedekah Harian",
    report_group: "expense",
    normal_balance: "debit",
    sort_order: 318,
    status: "active"
  },
  {
    id: "account_6019",
    code: "6019",
    name: "Sewa Outlet",
    report_group: "expense",
    normal_balance: "debit",
    sort_order: 319,
    status: "active"
  },
  {
    id: "account_6020",
    code: "6020",
    name: "Uang Bonus",
    report_group: "expense",
    normal_balance: "debit",
    sort_order: 320,
    status: "active"
  },
  {
    id: "account_6021",
    code: "6021",
    name: "Uang Lembur",
    report_group: "expense",
    normal_balance: "debit",
    sort_order: 321,
    status: "active"
  },
  {
    id: "account_6022",
    code: "6022",
    name: "Insentif Visit Outlet",
    report_group: "expense",
    normal_balance: "debit",
    sort_order: 322,
    status: "active"
  },
  {
    id: "account_7010",
    code: "7010",
    name: "Pendapatan Lain-Lain",
    report_group: "other_income",
    normal_balance: "credit",
    sort_order: 400,
    status: "active"
  },
  {
    id: "account_8003",
    code: "8003",
    name: "Pengeluaran Lain-Lain",
    report_group: "other_expense",
    normal_balance: "debit",
    sort_order: 500,
    status: "active"
  }
];

const financialAccountGroups = new Set(["cash_bank", "inventory", "other_current_asset", "fixed_asset", "moving_asset", "liability", "equity", "income", "cogs", "expense", "other_income", "other_expense"]);

const financeEntryGroups = new Set(["other_income", "other_expense", "reserve_fund", "other_current_asset", "fixed_asset", "moving_asset", "liability", "equity"]);

function isReserveFundAccount(account) {
  return Boolean(account && (String(account.code) === "1431" || /dana cadangan/i.test(String(account.name || ""))));
}

function getFinanceGroupFromAccount(account, requestedGroup = "") {
  const group = String(requestedGroup || "").trim();
  if (!account) return group;
  return account.report_group || group;
}

function financeEntryGroupKey({ name, account_code: accountCode, outlet_id: outletId }) {
  return `${String(name || "")
    .trim()
    .toLowerCase()}::${String(accountCode || "").trim()}::${outletId || "global"}`;
}

function getFinanceEntryGroupById(groupId) {
  return (data.finance_entry_groups || []).find((group) => group.id === groupId);
}

function normalizeFinanceEntryGroupFromEntry(entry) {
  const account = getFinancialAccountByCode(entry.account_code);
  const group = getFinanceGroupFromAccount(account, entry.group);
  return {
    name: String(entry.name || "Pos Keuangan").trim(),
    account_code: String(entry.account_code || "").trim(),
    group,
    outlet_id: entry.outlet_id || null,
    status: "active",
    note: ""
  };
}

function normalizePermissionData() {
  data.permissions = clone(permissionCatalog);
  data.roles = data.roles.map((role) => ({
    ...role,
    permissions: defaultRolePermissions[role.id] || role.permissions || {}
  }));
}

function rebuildIndexes() {
  outletMap = byId(data.outlets);
  roleMap = byId(data.roles);
  userMap = byId(data.users);
  customerMap = byId(data.customers);
  productMap = byId(data.products);
  categoryMap = byId(data.categories);
  materialCategoryMap = byId(data.raw_material_categories || []);
  materialMap = byId(data.raw_materials);
  supplierMap = byId(data.suppliers);
  tableMap = byId(data.tables);
}

function getUserOutletIds(userId) {
  const user = userMap.get(userId);
  return Array.isArray(user?.outlet_ids) ? user.outlet_ids : [];
}

function initializeFinanceFoundation() {
  if (!Array.isArray(data.raw_material_categories) || !data.raw_material_categories.length) {
    data.raw_material_categories = clone(defaultRawMaterialCategories);
  }

  const defaultMaterialCategory = data.raw_material_categories.find((category) => category.type === "hpp") || data.raw_material_categories[0];
  data.raw_materials = (data.raw_materials || []).map((material) => {
    const category = data.raw_material_categories.find((item) => item.id === material.category_id) || defaultMaterialCategory;

    return {
      ...material,
      type: material.type || category?.type || "hpp",
      category_id: material.category_id || category?.id || null,
      account_code: category?.account_code || material.account_code || "5002"
    };
  });

  data.payment_methods = Array.isArray(data.payment_methods) && data.payment_methods.length ? data.payment_methods : clone(defaultPaymentMethods);
  data.discounts = Array.isArray(data.discounts) ? data.discounts : [];
  data.discount_outlets = Array.isArray(data.discount_outlets) ? data.discount_outlets : [];
  const linkedDiscountIds = new Set(data.discount_outlets.map((row) => row.discount_id));
  for (const discount of data.discounts) {
    const embeddedOutletIds = Array.isArray(discount.outlet_ids) ? discount.outlet_ids : [];
    const outletIds = embeddedOutletIds.length ? embeddedOutletIds : linkedDiscountIds.has(discount.id) ? [] : data.outlets.map((outlet) => outlet.id);
    for (const outletId of outletIds) {
      if (!data.discount_outlets.some((row) => row.discount_id === discount.id && row.outlet_id === outletId)) {
        data.discount_outlets.push({
          discount_id: discount.id,
          outlet_id: outletId
        });
      }
    }
    delete discount.outlet_ids;
  }
  data.product_variants = Array.isArray(data.product_variants) ? data.product_variants : [];
  data.pos_product_favorites = Array.isArray(data.pos_product_favorites) ? data.pos_product_favorites : [];
  data.activity_logs = Array.isArray(data.activity_logs) ? data.activity_logs : [];
  data.financial_accounts = Array.isArray(data.financial_accounts) && data.financial_accounts.length ? data.financial_accounts : clone(defaultFinancialAccounts);
  const existingAccountCodes = new Set(data.financial_accounts.map((account) => String(account.code)));
  defaultFinancialAccounts.forEach((account) => {
    if (!existingAccountCodes.has(account.code)) {
      data.financial_accounts.push(clone(account));
    }
  });
  data.financial_accounts = data.financial_accounts.map((account, index) => ({
    ...account,
    report_group: account.report_group || "expense",
    normal_balance: account.normal_balance || "debit",
    sort_order: Number(account.sort_order || index + 1),
    status: account.status || "active"
  }));
  data.balance_sheet_entries = Array.isArray(data.balance_sheet_entries) ? data.balance_sheet_entries : [];
  data.balance_sheet_entries = data.balance_sheet_entries.map((entry) => {
    const account = getFinancialAccountByCode(entry.account_code);
    const group = getFinanceGroupFromAccount(account, entry.group);
    return {
      ...entry,
      group,
      entry_date: dateOnly(entry.entry_date || new Date()),
      amount: Math.round(Number(entry.amount || 0)),
      movement_type: entry.movement_type || "in",
      status: entry.status || "active"
    };
  });
  data.finance_entry_groups = Array.isArray(data.finance_entry_groups) ? data.finance_entry_groups : [];
  data.finance_entry_groups = data.finance_entry_groups
    .map((group) => {
      const account = getFinancialAccountByCode(group.account_code);
      const reportGroup = getFinanceGroupFromAccount(account, group.group);
      return {
        ...group,
        name: String(group.name || "Pos Keuangan").trim(),
        account_code: String(group.account_code || "").trim(),
        group: reportGroup,
        outlet_id: group.outlet_id || null,
        note: String(group.note || "").trim(),
        status: group.status || "active",
        created_at: group.created_at || new Date().toISOString()
      };
    })
    .filter((group) => group.name && group.account_code && financeEntryGroups.has(group.group));
  const financeGroupByKey = new Map(data.finance_entry_groups.map((group) => [financeEntryGroupKey(group), group]));
  data.balance_sheet_entries.forEach((entry) => {
    const existingGroup = entry.finance_group_id ? getFinanceEntryGroupById(entry.finance_group_id) : null;
    if (existingGroup) {
      entry.name = existingGroup.name;
      entry.account_code = existingGroup.account_code;
      entry.group = existingGroup.group;
      entry.outlet_id = existingGroup.outlet_id;
      return;
    }

    const groupPayload = normalizeFinanceEntryGroupFromEntry(entry);
    const key = financeEntryGroupKey(groupPayload);
    let group = financeGroupByKey.get(key);
    if (!group) {
      group = {
        id: createSequentialId("finance_group", data.finance_entry_groups),
        ...groupPayload,
        created_at: new Date().toISOString()
      };
      data.finance_entry_groups.push(group);
      financeGroupByKey.set(key, group);
    }
    entry.finance_group_id = group.id;
  });
  data.expense_categories = (data.expense_categories || []).map((category, index) => ({
    ...category,
    account_code: category.account_code || (index === 0 ? "6005" : `60${String(index + 10).padStart(2, "0")}`)
  }));
}

function initializeExpenseCategoriesFromExpenses() {
  if (Array.isArray(data.expense_categories) && data.expense_categories.length) return;

  const seen = new Set();
  data.expense_categories = (data.expenses || []).reduce((result, expense) => {
    const name = String(expense.category || "").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return result;
    seen.add(key);
    result.push({
      id: `expense_cat_${String(result.length + 1).padStart(3, "0")}`,
      name,
      sort_order: result.length + 1,
      status: "active"
    });
    return result;
  }, []);
}

function initializePrintSettings() {
  data.print_settings = {
    printer_name: data.print_settings?.printer_name || "Printer Kasir Utama",
    printer_status: data.print_settings?.printer_status || "active",
    mode: "single_printer_mock"
  };

  if (!Array.isArray(data.print_templates) || !data.print_templates.length) {
    data.print_templates = [
      { key: "customer_order", label: "Customer Order Copy", enabled: true },
      { key: "kitchen_order", label: "Kitchen Order", enabled: true },
      { key: "bill_receipt", label: "Bill / Receipt", enabled: true }
    ];
  }

  data.print_templates = data.print_templates.map((template) => ({
    ...template,
    label: template.key === "kitchen_order" ? "Kitchen Order" : template.label,
    footer_text: typeof template.footer_text === "string" ? template.footer_text : template.key === "bill_receipt" ? "Terima kasih" : ""
  }));
}

function initializeAppSecuritySettings() {
  data.app_security = {
    report_pin_enabled: data.app_security?.report_pin_enabled !== false,
    report_pin: String(data.app_security?.report_pin || "000000")
  };
}

function initializeOpenBills() {
  if (!Array.isArray(data.open_bills)) {
    data.open_bills = [];
  }
  data.open_bills = data.open_bills.map((bill) => ({
    ...bill,
    serviceType: bill.serviceType || bill.service_type || (bill.tableNumber || bill.table_number ? "dine_in" : "takeaway"),
    tableNumber: bill.tableNumber || bill.table_number || null,
    customerPrintedItems: Array.isArray(bill.customerPrintedItems) ? bill.customerPrintedItems : clone(bill.items || []),
    kitchenPrintedItems: Array.isArray(bill.kitchenPrintedItems) ? bill.kitchenPrintedItems : clone(bill.items || [])
  }));
}

function initializeUnitsFromMaterials() {
  const seen = new Set();
  const existingUnits = Array.isArray(data.units) ? data.units : [];
  units = [...existingUnits];
  units.forEach((unit) => {
    if (unit?.code) seen.add(String(unit.code).toLowerCase());
  });
  units = data.raw_materials.reduce((result, material) => {
    const code = String(material.unit || "").trim();
    const key = code.toLowerCase();
    if (!code || seen.has(key)) return result;
    seen.add(key);
    result.push({
      id: `unit_${String(result.length + 1).padStart(3, "0")}`,
      name: code,
      code,
      status: "active"
    });
    return result;
  }, units);
  data.units = units;
}

function initializeStockOpnameMaterialSelections() {
  if (Array.isArray(data.stock_opname_material_selections)) return;
  data.stock_opname_material_selections = data.outlets
    .filter((outlet) => outlet.status !== "inactive")
    .flatMap((outlet) =>
      data.raw_materials
        .filter((material) => material.status !== "inactive")
        .map((material) => ({
          outlet_id: outlet.id,
          material_id: material.id,
          selected_by: null
        }))
    );
}

function initializeStockOpnameSalesCalculations() {
  (data.stock_opname_requests || [])
    .filter((request) => ["pending", "approved"].includes(request.status))
    .forEach((request) => {
      const date = request.opname_date;
      const outletId = request.outlet_id;
      const purchaseTotals = getDailyPurchaseTotals(outletId, date);
      const transferBreakdown = getDailyTransferBreakdown(outletId, date);
      const salesTotals = getDailySalesMaterialTotals(outletId, date);
      request.items = (request.items || []).map((item) => {
        const material = materialMap.get(item.material_id);
        const purchaseQuantity = roundQuantity(purchaseTotals.get(item.material_id) || 0);
        const transferInQuantity = roundQuantity(transferBreakdown.inTotals.get(item.material_id) || 0);
        const transferOutQuantity = roundQuantity(transferBreakdown.outTotals.get(item.material_id) || 0);
        const salesQuantity = roundQuantity(salesTotals.get(item.material_id) || 0);
        const calculated = calculateStockOpname({
          openingQuantity: item.opening_quantity,
          purchaseQuantity,
          transferInQuantity,
          transferOutQuantity,
          salesQuantity,
          damageQuantity: item.damage_quantity,
          actualQuantity: item.actual_quantity,
          unitPrice: item.unit_price || material?.last_purchase_price || 0
        });
        return {
          ...item,
          ...calculated,
          status: calculated.status,
          note: getOpnameNote(calculated.difference)
        };
      });
    });
}

function initializeMockRuntime() {
  ensureMockDataLoaded();
  if (mockRuntimeInitialized) return;

  initializeExpenseCategoriesFromExpenses();
  initializeFinanceFoundation();
  initializePrintSettings();
  initializeAppSecuritySettings();
  initializeOpenBills();
  data.transaction_refunds = Array.isArray(data.transaction_refunds) ? data.transaction_refunds : [];
  data.transactions = (data.transactions || []).map((transaction) => ({
    ...transaction,
    updated_at: transaction.updated_at || transaction.transaction_date
  }));
  normalizePermissionData();
  rebuildIndexes();
  initializeStockOpnameMaterialSelections();
  initializeUnitsFromMaterials();
  refreshMaterialLastPurchasePrices();
  initializeStockOpnameSalesCalculations();
  mockRuntimeInitialized = true;
}

function createSequentialId(prefix, items) {
  const maxNumber = items.reduce((max, item) => {
    const match = String(item.id).match(new RegExp(`^${prefix}_(\\d+)$`));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  return `${prefix}_${String(maxNumber + 1).padStart(3, "0")}`;
}

function createIdGenerator(prefix, items) {
  let maxNumber = items.reduce((max, item) => {
    const match = String(item.id).match(new RegExp(`^${prefix}_(\\d+)$`));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  return () => {
    maxNumber += 1;
    return `${prefix}_${String(maxNumber).padStart(3, "0")}`;
  };
}

function outletFilter(outletId) {
  return !outletId || outletId === "all" ? () => true : (item) => item.outlet_id === outletId;
}

function toDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDateString(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function getDefaultReportRange() {
  const today = new Date();
  return {
    from: toDateString(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: toDateString(today)
  };
}

function withinDateRange(value, from, to) {
  const defaultRange = getDefaultReportRange();
  const date = new Date(value);
  const fromDate = new Date(`${from || defaultRange.from}T00:00:00+07:00`);
  const toDate = new Date(`${to || defaultRange.to}T23:59:59+07:00`);
  return date >= fromDate && date <= toDate;
}

function isSameDate(value, date) {
  return getLocalDateKey(value) === date;
}

function getLocalDateKey(value) {
  if (!value) return "";
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value || "").slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: appTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(parsed);
}

function getLocalHour(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const hourPart = new Intl.DateTimeFormat("en-US", {
    timeZone: appTimeZone,
    hour: "2-digit",
    hour12: false
  })
    .formatToParts(parsed)
    .find((part) => part.type === "hour")?.value;
  const hour = Number(hourPart);
  if (!Number.isFinite(hour)) return null;
  return hour === 24 ? 0 : hour;
}

function roundQuantity(value) {
  return Number(Number(value || 0).toFixed(3));
}

function getOpnameNote(difference) {
  if (Math.abs(difference) < 0.001) return "Pas";
  return difference > 0 ? "Stock Hilang" : "Tidak Sesuai Standar";
}

function getOpnameStatus(difference) {
  if (Math.abs(difference) < 0.001) return "pas";
  return difference > 0 ? "stock_hilang" : "tidak_sesuai_standar";
}

function enrichTransaction(transaction) {
  const items = data.transaction_items
    .filter((item) => item.transaction_id === transaction.id)
    .map((item) => ({
      ...item,
      product: productMap.get(item.product_id)
    }));
  const payment = data.payments.find((item) => item.transaction_id === transaction.id);
  const refund = data.transaction_refunds.find((item) => item.transaction_id === transaction.id);

  return {
    ...transaction,
    outlet: outletMap.get(transaction.outlet_id),
    cashier: userMap.get(transaction.cashier_id),
    customer: transaction.customer_id ? customerMap.get(transaction.customer_id) : null,
    discount_master: transaction.discount_id ? withDiscountOutlets(data.discounts.find((discount) => discount.id === transaction.discount_id)) : null,
    table: transaction.table_id ? tableMap.get(transaction.table_id) : null,
    payment,
    refund: refund
      ? {
          ...refund,
          refunded_by_user: refund.refunded_by ? userMap.get(refund.refunded_by) : null
        }
      : null,
    cancelled_by_user: transaction.cancelled_by ? userMap.get(transaction.cancelled_by) || null : null,
    updated_by_user: transaction.updated_by ? userMap.get(transaction.updated_by) || null : null,
    items
  };
}

function normalizeMobileDate(value, fallback = new Date()) {
  const date = value ? new Date(value) : fallback;
  if (Number.isNaN(date.getTime())) return fallback.toISOString();
  return date.toISOString();
}

function normalizeMobileDateOnly(value, fallback = new Date()) {
  const date = normalizeMobileDate(value, fallback);
  return date.slice(0, 10);
}

function mobileValue(payload, camelKey, snakeKey, fallback = undefined) {
  if (payload?.[camelKey] !== undefined && payload?.[camelKey] !== null) return payload[camelKey];
  if (payload?.[snakeKey] !== undefined && payload?.[snakeKey] !== null) return payload[snakeKey];
  return fallback;
}

function mobileNumber(payload, camelKey, snakeKey, fallback = 0) {
  const value = Number(mobileValue(payload, camelKey, snakeKey, fallback));
  return Number.isFinite(value) ? value : fallback;
}

function createActivityLog(payload = {}) {
  const actorId = payload.actor_user_id || payload.actorUserId || payload.user_id || payload.userId || null;
  const actor = actorId ? userMap.get(actorId) : null;
  const normalized = normalizeActivityPayload(payload, {
    actor_user_id: actorId,
    actor_role: actor?.role_id || null,
    source: payload.source || "backend"
  });
  if (normalized.client_event_id) {
    const existing = data.activity_logs.find((item) => item.client_event_id === normalized.client_event_id);
    if (existing) return existing;
  }
  const now = new Date().toISOString();
  const log = {
    id: payload.id && !String(payload.id).startsWith("activity_local_") ? payload.id : createSequentialId("activity", data.activity_logs),
    ...normalized,
    occurred_at: normalized.occurred_at.toISOString(),
    received_at: now,
    created_at: now
  };

  data.activity_logs.unshift(log);
  markActivityWritten();
  return log;
}

function logAdminActivity(action, { actorId, outletId, module = "admin", entityType, entityId, description, metadata } = {}) {
  createActivityLog({
    actor_user_id: actorId || activityContext.getStore()?.actorId || data.users[0]?.id || null,
    outlet_id: outletId || null,
    source: "admin_web",
    module,
    action,
    entity_type: entityType,
    entity_id: entityId,
    description,
    metadata_json: metadata || {}
  });
}

function logEntityActivity(action, { actorId, module, entityType, entity, entityId, outletId, description, metadata } = {}) {
  logAdminActivity(action, {
    actorId,
    outletId: outletId ?? entity?.outlet_id ?? null,
    module,
    entityType,
    entityId: entityId || entity?.id || null,
    description,
    metadata
  });
}

function getActivityLogRows({ from, to, outletId = "all", source = "all", eventType = "all", outcome = "all", module = "all", action = "all", actorId = "all", keyword = "" } = {}) {
  return data.activity_logs
    .map((log) => ({
      event_type: "business",
      outcome: "succeeded",
      occurred_at: log.created_at,
      received_at: log.created_at,
      ...log
    }))
    .filter((log) => withinDateRange(log.occurred_at, from, to))
    .filter((log) => outletId === "all" || !outletId || log.outlet_id === outletId)
    .filter((log) => source === "all" || !source || log.source === source)
    .filter((log) => eventType === "all" || !eventType || log.event_type === eventType)
    .filter((log) => outcome === "all" || !outcome || log.outcome === outcome)
    .filter((log) => module === "all" || !module || log.module === module)
    .filter((log) => action === "all" || !action || log.action === action)
    .filter((log) => actorId === "all" || !actorId || log.actor_user_id === actorId)
    .map((log) => ({
      ...log,
      actor: log.actor_user_id ? userMap.get(log.actor_user_id) : null,
      outlet: log.outlet_id ? outletMap.get(log.outlet_id) : null
    }))
    .filter((log) => includesText(`${log.description} ${log.source} ${log.module} ${log.action} ${log.entity_type} ${log.entity_id} ${log.actor?.name} ${log.outlet?.name}`, keyword))
    .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
}

function findTableByOutletAndNumber(outletId, tableNumber) {
  const cleanNumber = String(tableNumber || "")
    .trim()
    .toUpperCase();
  if (!cleanNumber) return null;
  return data.tables.find((table) => table.outlet_id === outletId && String(table.number || "").toUpperCase() === cleanNumber);
}

function normalizeMobileItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const productId = String(mobileValue(item, "productId", "product_id", "") || "");
      const product = productMap.get(productId);
      const quantity = Math.max(0, Math.round(mobileNumber(item, "quantity", "quantity", 0)));
      const unitPrice = Math.max(0, Math.round(mobileNumber(item, "unitPrice", "unit_price", 0)));
      const subtotal = Math.max(0, Math.round(mobileNumber(item, "subtotal", "subtotal", quantity * unitPrice)));
      const requestedVariantIds = [...new Set([...((Array.isArray(item.variantIds) ? item.variantIds : []) || []), ...((Array.isArray(item.variant_ids) ? item.variant_ids : []) || []), ...((Array.isArray(item.selectedVariants) ? item.selectedVariants.map((variant) => variant.id) : []) || []), ...((Array.isArray(item.selected_variants) ? item.selected_variants.map((variant) => variant.id) : []) || [])].map((id) => String(id || "")).filter(Boolean))];
      const selectedVariants = requestedVariantIds.map((variantId) => {
        const variant = (data.product_variants || []).find((item) => item.id === variantId && item.product_id === productId && item.status === "active");
        if (!variant) {
          const error = new Error("Catatan variant produk tidak valid atau tidak aktif.");
          error.status = 422;
          throw error;
        }
        return {
          id: variant.id,
          product_id: variant.product_id,
          name: variant.name
        };
      });
      return {
        productId,
        productName: String(mobileValue(item, "productName", "product_name", product?.name || "") || ""),
        categoryId: String(mobileValue(item, "categoryId", "category_id", product?.category_id || "") || ""),
        categoryName: String(mobileValue(item, "categoryName", "category_name", "") || ""),
        quantity,
        unitPrice,
        subtotal,
        variantIds: requestedVariantIds,
        selectedVariants
      };
    })
    .filter((item) => item.productId && item.quantity > 0);
}

function normalizeOpenBillPayload(payload) {
  const outletId = String(mobileValue(payload, "outletId", "outlet_id", "") || "");
  const cashierId = String(mobileValue(payload, "cashierId", "cashier_id", "") || "");
  const requestedServiceType = String(mobileValue(payload, "serviceType", "service_type", "takeaway") || "takeaway").trim();
  const serviceType = requestedServiceType === "dine_in" ? "dine_in" : "takeaway";
  const rawTableNumber = String(mobileValue(payload, "tableNumber", "table_number", "") || "")
    .trim()
    .toUpperCase();
  const tableNumber = serviceType === "dine_in" ? rawTableNumber : null;
  const items = normalizeMobileItems(payload.items);
  const total = Math.max(
    0,
    Math.round(
      mobileNumber(
        payload,
        "total",
        "total",
        items.reduce((sum, item) => sum + item.subtotal, 0)
      )
    )
  );

  if (!outletMap.has(outletId)) throw new Error("Outlet open bill tidak valid.");
  if (!cashierId || !userMap.has(cashierId)) throw new Error("Kasir open bill tidak valid.");
  if (serviceType === "dine_in" && !tableNumber) throw new Error("Meja wajib dipilih untuk open bill dine in.");
  if (!items.length || total <= 0) throw new Error("Item open bill wajib diisi.");

  const table = tableNumber ? findTableByOutletAndNumber(outletId, tableNumber) : null;
  if (serviceType === "dine_in" && !table) throw new Error("Nomor meja tidak valid untuk outlet ini.");

  const now = new Date();
  const normalized = {
    id: String(mobileValue(payload, "id", "id", createSequentialId("open_bill", data.open_bills)) || ""),
    orderNumber: String(mobileValue(payload, "orderNumber", "order_number", "") || ""),
    outletId,
    cashierId,
    serviceType,
    tableNumber,
    items,
    total,
    createdAt: normalizeMobileDate(mobileValue(payload, "createdAt", "created_at", now.toISOString()), now),
    updatedAt: normalizeMobileDate(mobileValue(payload, "updatedAt", "updated_at", now.toISOString()), now),
    synced: true,
    customerId: mobileValue(payload, "customerId", "customer_id", null),
    customerName: mobileValue(payload, "customerName", "customer_name", null),
    customerPhone: mobileValue(payload, "customerPhone", "customer_phone", null),
    customerPoints: Math.max(0, Math.round(mobileNumber(payload, "customerPoints", "customer_points", 0)))
  };
  if (Object.prototype.hasOwnProperty.call(payload, "customerPrintedItems") || Object.prototype.hasOwnProperty.call(payload, "customer_printed_items")) {
    normalized.customerPrintedItems = normalizeMobileItems(mobileValue(payload, "customerPrintedItems", "customer_printed_items", []));
  }
  if (Object.prototype.hasOwnProperty.call(payload, "kitchenPrintedItems") || Object.prototype.hasOwnProperty.call(payload, "kitchen_printed_items")) {
    normalized.kitchenPrintedItems = normalizeMobileItems(mobileValue(payload, "kitchenPrintedItems", "kitchen_printed_items", []));
  }
  return normalized;
}

function getOpenBillRows(outletId = "all") {
  return data.open_bills.filter((bill) => outletId === "all" || bill.outletId === outletId).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function transactionItemToMobile(item) {
  const product = item.product || productMap.get(item.product_id);
  const category = product?.category_id ? categoryMap.get(product.category_id) : null;
  const selectedVariants = item.selectedVariants || item.selected_variants || selectedVariantsFromMetadata(item.metadata_json);
  return {
    productId: item.product_id,
    productName: product?.name || item.product_name || "",
    categoryId: product?.category_id || item.category_id || "",
    categoryName: category?.name || item.category_name || "",
    quantity: Number(item.quantity || 0),
    unitPrice: Number(item.unit_price || item.unitPrice || 0),
    subtotal: Number(item.subtotal || 0),
    variantIds: selectedVariants.map((variant) => variant.id).filter(Boolean),
    selectedVariants
  };
}

function transactionToMobile(transaction) {
  const payment = transaction.payment || data.payments.find((item) => item.transaction_id === transaction.id) || {};
  const table = transaction.table || (transaction.table_id ? tableMap.get(transaction.table_id) : null);
  const customer = transaction.customer || (transaction.customer_id ? customerMap.get(transaction.customer_id) : null);
  return {
    id: transaction.id,
    orderNumber: transaction.order_number || transaction.orderNumber,
    outletId: transaction.outlet_id || transaction.outletId,
    cashierId: transaction.cashier_id || transaction.cashierId,
    serviceType: transaction.service_type || transaction.serviceType || (table ? "dine_in" : "takeaway"),
    tableNumber: table?.number || transaction.table_number || transaction.tableNumber || null,
    paymentMethod: payment.method || transaction.payment_method || transaction.paymentMethod || "cash",
    paidAmount: Number(payment.amount || transaction.paid_amount || transaction.paidAmount || transaction.total || 0),
    changeAmount: Number(payment.change_amount || transaction.change_amount || transaction.changeAmount || 0),
    total: Number(transaction.total || 0),
    note: transaction.note || "",
    discount: Number(transaction.discount || 0),
    subtotal: Number(transaction.subtotal || transaction.total || 0),
    discountId: transaction.discount_id || transaction.discountId || null,
    discountType: transaction.discount_type || transaction.discountType || null,
    discountValue: Number(transaction.discount_value || transaction.discountValue || 0),
    discountName: transaction.discount_master?.name || (transaction.discount_id ? data.discounts.find((discount) => discount.id === transaction.discount_id)?.name : null) || transaction.discount_name || transaction.discountName || null,
    createdAt: transaction.transaction_date || transaction.createdAt,
    status: transaction.status || "paid",
    synced: true,
    customerId: customer?.id || transaction.customer_id || transaction.customerId || null,
    customerName: customer?.name || transaction.customer_name || transaction.customerName || null,
    customerPhone: customer?.phone || transaction.customer_phone || transaction.customerPhone || null,
    customerPointsBefore: Number(transaction.customer_points_before || transaction.customerPointsBefore || 0),
    customerPointsEarned: Number(transaction.customer_points_earned || transaction.customerPointsEarned || 0),
    customerPointsAfter: Number(transaction.customer_points_after || transaction.customerPointsAfter || 0),
    items: (transaction.items || []).map(transactionItemToMobile)
  };
}

function expenseToMobile(expense) {
  return {
    id: expense.id,
    outletId: expense.outlet_id || expense.outletId,
    category: expense.category,
    amount: Number(expense.amount || 0),
    note: expense.description || expense.note || "",
    date: expense.expense_date || expense.date,
    synced: true,
    status: expense.status || "approved",
    rejectionNote: expense.rejection_note || expense.rejectionNote || ""
  };
}

function isApprovedExpense(expense) {
  return !expense.status || expense.status === "approved";
}

function customerToMobile(customer) {
  return {
    id: customer.id,
    outletId: customer.outlet_id || customer.outletId,
    name: customer.name,
    phone: customer.phone,
    barcode: customer.barcode,
    points: Number(customer.points || 0)
  };
}

function createTransactionFromMobilePayload(payload, createdBy) {
  const outletId = String(mobileValue(payload, "outletId", "outlet_id", "") || "");
  const cashierId = String(mobileValue(payload, "cashierId", "cashier_id", createdBy || "") || "");
  const orderNumber = String(mobileValue(payload, "orderNumber", "order_number", "") || "");
  const transactionId = String(mobileValue(payload, "id", "id", createSequentialId("trx", data.transactions)) || "");
  const items = normalizeMobileItems(payload.items);
  const subtotal = Math.max(
    0,
    Math.round(
      mobileNumber(
        payload,
        "subtotal",
        "subtotal",
        items.reduce((sum, item) => sum + item.subtotal, 0)
      )
    )
  );
  const createdAt = normalizeMobileDate(mobileValue(payload, "createdAt", "transaction_date", new Date().toISOString()));
  const transactionDate = dateOnly(createdAt);
  const rawDiscountId = mobileValue(payload, "discountId", "discount_id", null);
  const submittedDiscountId = rawDiscountId == null || String(rawDiscountId).trim() === "" ? null : String(rawDiscountId).trim();
  const selectedDiscount = submittedDiscountId ? data.discounts.find((discount) => discount.id === submittedDiscountId) : null;
  const manualDiscountTypeRaw = String(mobileValue(payload, "discountType", "discount_type", "") || "").trim();
  const manualDiscountType = manualDiscountTypeRaw === "percent" || manualDiscountTypeRaw === "nominal" ? manualDiscountTypeRaw : null;
  const manualDiscountValue = Math.max(0, Math.round(mobileNumber(payload, "discountValue", "discount_value", 0)));
  let discount = 0;
  let discountType = null;
  let discountValue = 0;
  let discountName = null;
  if (submittedDiscountId) {
    discount = calculateDiscountAmount(selectedDiscount, subtotal);
    discountType = selectedDiscount?.type || null;
    discountValue = selectedDiscount ? Number(selectedDiscount.value || 0) : 0;
    discountName = selectedDiscount?.name || null;
  } else if (manualDiscountType && manualDiscountValue > 0) {
    if (manualDiscountType === "percent" && (manualDiscountValue < 1 || manualDiscountValue > 100)) {
      throw new Error("Discount persen wajib 1 sampai 100.");
    }
    if (manualDiscountType === "nominal" && manualDiscountValue <= 0) {
      throw new Error("Discount nominal wajib lebih dari 0.");
    }
    const rawDiscount = manualDiscountType === "percent" ? Math.round((subtotal * manualDiscountValue) / 100) : manualDiscountValue;
    discount = Math.min(subtotal, Math.max(0, rawDiscount));
    discountType = manualDiscountType;
    discountValue = manualDiscountValue;
    discountName = "Diskon Manual";
  }
  const total = Math.max(0, subtotal - discount);
  const requestedServiceType = String(mobileValue(payload, "serviceType", "service_type", "takeaway") || "takeaway");
  const rawTableNumber = mobileValue(payload, "tableNumber", "table_number", null);
  const tableNumber = rawTableNumber == null ? "" : String(rawTableNumber).trim();
  const serviceType = requestedServiceType === "dine_in" && tableNumber ? "dine_in" : "takeaway";
  const table = serviceType === "dine_in" ? findTableByOutletAndNumber(outletId, tableNumber) : null;
  const customerId = mobileValue(payload, "customerId", "customer_id", null);
  const customer = customerId ? customerMap.get(customerId) : null;
  const paymentCode = normalizePaymentMethodCode(mobileValue(payload, "paymentMethod", "payment_method", "cash") || "cash");
  const paymentMethod = getPaymentMethodByCode(paymentCode, {
    activeOnly: true
  });

  if (!outletMap.has(outletId)) throw new Error("Outlet transaksi tidak valid.");
  if (!userMap.has(cashierId)) throw new Error("Kasir transaksi tidak valid.");
  if (!orderNumber) throw new Error("Nomor order transaksi wajib diisi.");
  if (!items.length || subtotal <= 0) throw new Error("Item transaksi wajib diisi.");
  if (serviceType === "dine_in" && !table) throw new Error("Meja transaksi dine in tidak valid.");
  if (!paymentMethod) throw new Error("Metode pembayaran tidak aktif atau tidak valid.");
  if (submittedDiscountId && !isDiscountActiveForDate(selectedDiscount, transactionDate)) {
    throw new Error("Discount tidak aktif atau berada di luar periode.");
  }
  if (submittedDiscountId && !discountAppliesToOutlet(selectedDiscount, outletId)) {
    throw new Error("Discount tidak berlaku untuk outlet transaksi.");
  }

  const existing = data.transactions.find((transaction) => transaction.id === transactionId || transaction.order_number === orderNumber);
  if (existing) return transactionToMobile(enrichTransaction(existing));

  const transaction = {
    id: transactionId,
    order_number: orderNumber,
    outlet_id: outletId,
    cashier_id: cashierId,
    customer_id: customer?.id || null,
    table_id: table?.id || null,
    status: "paid",
    subtotal,
    discount,
    tax: Math.max(0, Math.round(mobileNumber(payload, "tax", "tax", 0))),
    total,
    transaction_date: createdAt,
    service_type: serviceType,
    note: String(mobileValue(payload, "note", "note", "") || "")
      .trim()
      .slice(0, 500),
    discount_id: selectedDiscount?.id || null,
    discount_type: discount > 0 ? discountType : null,
    discount_value: discount > 0 ? discountValue : 0,
    discount_name: discount > 0 ? discountName : null,
    customer_name: mobileValue(payload, "customerName", "customer_name", customer?.name || null),
    customer_phone: mobileValue(payload, "customerPhone", "customer_phone", customer?.phone || null),
    customer_points_before: Math.max(0, Math.round(mobileNumber(payload, "customerPointsBefore", "customer_points_before", customer?.points || 0))),
    customer_points_earned: Math.max(0, Math.round(mobileNumber(payload, "customerPointsEarned", "customer_points_earned", 0))),
    customer_points_after: Math.max(0, Math.round(mobileNumber(payload, "customerPointsAfter", "customer_points_after", customer?.points || 0)))
  };
  data.transactions.unshift(transaction);

  for (const item of items) {
    data.transaction_items.push({
      id: createSequentialId("trx_item", data.transaction_items),
      transaction_id: transaction.id,
      product_id: item.productId,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      subtotal: item.subtotal,
      metadata_json: {
        selected_variants: item.selectedVariants
      }
    });
  }

  applyTransactionStockDeduction(transaction, items);

  data.payments.push({
    id: createSequentialId("payment", data.payments),
    transaction_id: transaction.id,
    method: paymentMethod.code,
    payment_method_id: paymentMethod.id,
    amount: Math.max(0, Math.round(mobileNumber(payload, "paidAmount", "paid_amount", total))),
    status: "paid",
    paid_at: createdAt,
    change_amount: Math.max(0, Math.round(mobileNumber(payload, "changeAmount", "change_amount", 0)))
  });

  if (customer && Number(transaction.customer_points_earned || 0) > 0) {
    customer.points = transaction.customer_points_after || Number(customer.points || 0) + Number(transaction.customer_points_earned || 0);
  }

  data.open_bills = data.open_bills.filter((bill) => bill.orderNumber !== orderNumber);
  if (selectedDiscount) {
    createActivityLog({
      actor_user_id: cashierId,
      outlet_id: outletId,
      source: "kasir_app",
      module: "transaction",
      action: "apply_discount",
      entity_type: "transaction",
      entity_id: transaction.id,
      description: `Discount ${selectedDiscount.name} dipakai pada transaksi ${orderNumber}.`,
      metadata_json: {
        discount_id: selectedDiscount.id,
        discount_type: selectedDiscount.type,
        discount_value: Number(selectedDiscount.value || 0),
        outlet_id: outletId,
        subtotal,
        discount,
        total
      },
      created_at: createdAt
    });
  } else if (discount > 0) {
    createActivityLog({
      actor_user_id: cashierId,
      outlet_id: outletId,
      source: "kasir_app",
      module: "transaction",
      action: "apply_manual_discount",
      entity_type: "transaction",
      entity_id: transaction.id,
      description: `Diskon manual dipakai pada transaksi ${orderNumber}.`,
      metadata_json: {
        discount_type: discountType,
        discount_value: discountValue,
        outlet_id: outletId,
        subtotal,
        discount,
        total
      },
      created_at: createdAt
    });
  }
  rebuildIndexes();
  return transactionToMobile(enrichTransaction(transaction));
}

function createExpenseFromMobilePayload(payload, createdBy) {
  const outletId = String(mobileValue(payload, "outletId", "outlet_id", "") || "");
  const id = String(mobileValue(payload, "id", "id", createSequentialId("expense", data.expenses)) || "");
  const category = String(mobileValue(payload, "category", "category", "") || "").trim();
  const amount = Math.max(0, Math.round(mobileNumber(payload, "amount", "amount", 0)));
  const description = String(mobileValue(payload, "note", "description", "") || "").trim();
  const expenseDate = normalizeMobileDateOnly(mobileValue(payload, "date", "expense_date", new Date().toISOString()));

  if (!outletMap.has(outletId)) throw new Error("Outlet pengeluaran tidak valid.");
  if (!category) throw new Error("Nama pengeluaran operasional wajib dipilih.");
  if (amount <= 0) throw new Error("Nominal pengeluaran wajib lebih dari 0.");

  const existing = data.expenses.find((expense) => expense.id === id);
  if (existing) return expenseToMobile(existing);

  const expense = {
    id,
    outlet_id: outletId,
    category,
    description,
    amount,
    expense_date: expenseDate,
    status: "pending",
    created_by: createdBy
  };
  data.expenses.unshift(expense);
  return expenseToMobile(expense);
}

function updateExpenseFromMobilePayload(expenseId, payload, updatedBy) {
  const expense = data.expenses.find((item) => item.id === expenseId);
  if (!expense) throw new Error("Pengeluaran tidak ditemukan.");
  if ((expense.status || "approved") !== "pending") throw new Error("Pengeluaran hanya bisa diedit sebelum approved/rejected Admin.");

  const outletId = String(mobileValue(payload, "outletId", "outlet_id", expense.outlet_id) || "");
  const category = String(mobileValue(payload, "category", "category", expense.category) || "").trim();
  const amount = Math.max(0, Math.round(mobileNumber(payload, "amount", "amount", expense.amount)));
  const description = String(mobileValue(payload, "note", "description", expense.description || "") || "").trim();

  if (!outletMap.has(outletId)) throw new Error("Outlet pengeluaran tidak valid.");
  if (outletId !== expense.outlet_id) throw new Error("Outlet pengeluaran tidak boleh diubah dari APK.");
  if (!category) throw new Error("Nama pengeluaran operasional wajib dipilih.");
  if (amount <= 0) throw new Error("Nominal pengeluaran wajib lebih dari 0.");

  expense.category = category;
  expense.description = description;
  expense.amount = amount;
  expense.updated_at = new Date().toISOString();
  expense.updated_by = updatedBy;
  createActivityLog({
    actor_user_id: updatedBy,
    outlet_id: expense.outlet_id,
    source: "kasir_app",
    module: "expense",
    action: "update",
    entity_type: "expense",
    entity_id: expense.id,
    description: `Kasir memperbarui pengeluaran ${expense.category}.`,
    metadata_json: {
      category: expense.category,
      amount: expense.amount,
      expense_date: expense.expense_date
    },
    created_at: new Date().toISOString()
  });
  return expenseToMobile(expense);
}

function getProductPrice(productId, outletId) {
  const price = data.product_prices.find((item) => item.product_id === productId && item.outlet_id === outletId);
  return price?.price || 0;
}

function productVariantsForProduct(productId, { activeOnly = false } = {}) {
  return (data.product_variants || [])
    .filter((variant) => variant.product_id === productId)
    .filter((variant) => !activeOnly || variant.status === "active")
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.name).localeCompare(String(b.name), "id-ID"));
}

function selectedVariantsFromMetadata(metadata) {
  if (!metadata) return [];
  const parsed = typeof metadata === "string" ? parseJsonSafe(metadata, {}) : metadata;
  return Array.isArray(parsed?.selected_variants) ? parsed.selected_variants : [];
}

function normalizeProductVariantsPayload(productId, variants = []) {
  const rows = Array.isArray(variants) ? variants : [];
  const cleaned = rows
    .map((variant, index) => ({
      id: variant.id ? String(variant.id) : null,
      product_id: productId,
      name: String(variant.name || "").trim(),
      price_delta: 0,
      sort_order: Number.isFinite(Number(variant.sort_order)) ? Number(variant.sort_order) : index + 1,
      status: variant.status === "inactive" ? "inactive" : "active"
    }))
    .filter((variant) => variant.name);

  const seenNames = new Set();
  for (const variant of cleaned) {
    const key = variant.name.toLowerCase();
    if (seenNames.has(key)) {
      const error = new Error(`Catatan variant ${variant.name} tidak boleh duplikat.`);
      error.status = 422;
      throw error;
    }
    seenNames.add(key);
  }

  if (cleaned.length > 20) {
    const error = new Error("Catatan variant maksimal 20 per produk.");
    error.status = 422;
    throw error;
  }

  const existingById = new Map(productVariantsForProduct(productId).map((variant) => [variant.id, variant]));
  const nextVariantId = createIdGenerator("variant", data.product_variants || []);
  return cleaned.map((variant) => ({
    ...variant,
    id: existingById.has(variant.id) ? variant.id : nextVariantId()
  }));
}

function getProductRows(outletId = "all") {
  return data.products
    .map((product) => {
      const prices = data.product_prices.filter((price) => price.product_id === product.id);
      const visiblePrices = outletId === "all" ? prices : prices.filter((price) => price.outlet_id === outletId);
      const composition = data.product_compositions
        .filter((item) => item.product_id === product.id)
        .map((item) => ({
          ...item,
          material: materialMap.get(item.material_id)
        }));
      const variants = productVariantsForProduct(product.id);

      return {
        ...product,
        category: categoryMap.get(product.category_id),
        all_prices: prices.map((price) => ({
          ...price,
          outlet: outletMap.get(price.outlet_id)
        })),
        prices: visiblePrices.map((price) => ({
          ...price,
          outlet: outletMap.get(price.outlet_id)
        })),
        composition_count: composition.length,
        composition,
        variant_count: variants.filter((variant) => variant.status === "active").length,
        variants
      };
    })
    .filter((product) => outletId === "all" || product.prices.some((price) => Number(price.price || 0) > 0 && price.status !== "inactive"));
}

function getCategoryRows() {
  return data.categories.map((category) => {
    const products = data.products
      .filter((product) => product.category_id === category.id)
      .map((product) => ({
        ...product,
        price_count: data.product_prices.filter((price) => price.product_id === product.id).length,
        composition_count: data.product_compositions.filter((item) => item.product_id === product.id).length
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "id-ID"));

    return {
      ...category,
      products,
      product_count: products.length
    };
  });
}

function getExpenseCategoryRows(keyword = "") {
  return data.expense_categories
    .map((category) => {
      const expenses = (data.expenses || [])
        .filter((expense) => expense.category?.toLowerCase() === category.name.toLowerCase())
        .map((expense) => ({
          ...expense,
          outlet: outletMap.get(expense.outlet_id),
          created_by_user: userMap.get(expense.created_by)
        }))
        .sort((a, b) => new Date(b.expense_date) - new Date(a.expense_date));

      return {
        ...category,
        account: category.account_code ? getFinancialAccountByCode(category.account_code) || null : null,
        expenses,
        expense_count: expenses.length,
        expense_total: expenses.reduce((total, expense) => total + Number(expense.amount || 0), 0)
      };
    })
    .filter((category) => includesText(`${category.name} ${category.status}`, keyword))
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
}

function getPaymentMethodRows(keyword = "") {
  return (data.payment_methods || [])
    .map((method) => ({
      ...method,
      account: method.account_code ? getFinancialAccountByCode(method.account_code) || null : null
    }))
    .filter((method) => includesText(`${method.name} ${method.code} ${method.account_code} ${method.status}`, keyword))
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
}

function getFinancialAccountRows(keyword = "") {
  return (data.financial_accounts || []).filter((account) => includesText(`${account.code} ${account.name} ${account.report_group} ${account.normal_balance} ${account.status}`, keyword)).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.code).localeCompare(String(b.code)));
}

function getFinancialAccountByCode(code) {
  return (data.financial_accounts || []).find((account) => String(account.code) === String(code));
}

function getPrimaryAccount(reportGroup) {
  return (data.financial_accounts || []).filter((account) => account.report_group === reportGroup && account.status !== "inactive").sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))[0] || null;
}

function findAccountByGroupAndName(reportGroup, pattern) {
  return (data.financial_accounts || []).filter((account) => account.report_group === reportGroup && account.status !== "inactive" && pattern.test(String(account.name || ""))).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))[0] || null;
}

function accountDescription(account, fallbackName, accountCode = "") {
  const code = String(account?.code || accountCode || "").trim();
  const name = account?.name ? String(account.name).trim() : code ? "Akun belum terdaftar" : `Akun belum diset${fallbackName ? ` (${fallbackName})` : ""}`;
  return code ? `[${code}] ${name}` : name;
}

function requireFinancialAccount(accountCode, groups = []) {
  const code = String(accountCode || "").trim();
  const account = getFinancialAccountByCode(code);
  const allowedGroups = new Set(groups);

  if (!code || !account) {
    throw new Error("Akun laporan wajib dipilih dari Master Akun.");
  }

  if (allowedGroups.size && !allowedGroups.has(account.report_group)) {
    throw new Error(`Akun [${account.code}] ${account.name} tidak sesuai group laporan.`);
  }

  return account;
}

function findAccountForMaterial(material, fallbackGroup, fallbackCode, fallbackName) {
  const category = materialCategoryMap.get(material?.category_id);
  const accountCode = category?.account_code || material?.account_code || fallbackCode;
  return getFinancialAccountByCode(accountCode) || getPrimaryAccount(fallbackGroup) || null;
}

function isEntryWithinScope(entry, { outletId = "all", from = null, to = null, activeOnly = false } = {}) {
  if (!entry || (activeOnly && entry.status === "inactive")) return false;
  const financeGroup = entry.finance_group_id ? getFinanceEntryGroupById(entry.finance_group_id) : null;
  if (activeOnly && financeGroup?.status === "inactive") return false;
  const entryDate = dateOnly(entry.entry_date || new Date());
  if (outletId !== "all" && entry.outlet_id && entry.outlet_id !== outletId) return false;
  if (from && entryDate < from) return false;
  if (to && entryDate > to) return false;
  return true;
}

function getFinanceEntryRows({ outletId = "all", keyword = "", from = null, to = null, activeOnly = false } = {}) {
  return (data.balance_sheet_entries || [])
    .filter((entry) => isEntryWithinScope(entry, { outletId, from, to, activeOnly }))
    .map((entry) => {
      const account = getFinancialAccountByCode(entry.account_code);
      const amount = Math.round(Number(entry.amount || 0));
      const group = getFinanceGroupFromAccount(account, entry.group);
      const movementType = entry.movement_type || "in";
      const financeGroup = getFinanceEntryGroupById(entry.finance_group_id);
      return {
        ...entry,
        group,
        amount,
        movement_type: movementType,
        signed_amount: movementType === "out" ? -amount : amount,
        account,
        finance_group: financeGroup || null,
        outlet: entry.outlet_id ? outletMap.get(entry.outlet_id) : null
      };
    })
    .filter((entry) => includesText(`${entry.name} ${entry.group} ${entry.account_code} ${entry.account?.name || ""} ${entry.outlet?.name || "semua outlet"} ${entry.note || ""} ${entry.status}`, keyword))
    .sort((a, b) => String(b.entry_date || "").localeCompare(String(a.entry_date || "")) || String(a.name).localeCompare(String(b.name)));
}

function getFinanceEntryGroupRows({ outletId = "all", keyword = "" } = {}) {
  const allEntries = getFinanceEntryRows({ outletId: "all" });

  return (data.finance_entry_groups || [])
    .filter((group) => outletId === "all" || !group.outlet_id || group.outlet_id === outletId)
    .map((group) => {
      const account = getFinancialAccountByCode(group.account_code);
      const groupEntries = allEntries.filter((entry) => entry.finance_group_id === group.id);
      const activeEntries = group.status === "inactive" ? [] : groupEntries.filter((entry) => entry.status !== "inactive");
      const totalIn = activeEntries.filter((entry) => entry.movement_type === "in").reduce((total, entry) => total + Number(entry.amount || 0), 0);
      const totalOut = activeEntries.filter((entry) => entry.movement_type === "out").reduce((total, entry) => total + Number(entry.amount || 0), 0);
      const lastTransaction = [...groupEntries].sort((a, b) => String(b.entry_date || "").localeCompare(String(a.entry_date || "")))[0] || null;

      return {
        ...group,
        group: getFinanceGroupFromAccount(account, group.group),
        account,
        outlet: group.outlet_id ? outletMap.get(group.outlet_id) : null,
        total_in: totalIn,
        total_out: totalOut,
        balance: totalIn - totalOut,
        transaction_count: groupEntries.length,
        active_transaction_count: activeEntries.length,
        last_transaction: lastTransaction,
        transactions: groupEntries
      };
    })
    .filter((group) => includesText(`${group.name} ${group.group} ${group.account_code} ${group.account?.name || ""} ${group.outlet?.name || "semua outlet"} ${group.note || ""} ${group.status}`, keyword))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(a.account_code).localeCompare(String(b.account_code)));
}

function getReserveFundRows({ outletId = "all", keyword = "" } = {}) {
  return getFinanceEntryRows({ outletId, keyword }).filter((entry) => isReserveFundAccount(entry.account));
}

function getReserveFundSummary({ outletId = "all" } = {}) {
  const rows = getFinanceEntryRows({ outletId, activeOnly: true }).filter((entry) => isReserveFundAccount(entry.account));
  const outletIds = outletId === "all" ? data.outlets.map((outlet) => outlet.id) : [outletId].filter((id) => outletMap.has(id));
  return outletIds.map((id) => {
    const outletRows = rows.filter((row) => row.outlet_id === id);
    const totalIn = outletRows.filter((row) => row.movement_type === "in").reduce((total, row) => total + Number(row.amount || 0), 0);
    const totalOut = outletRows.filter((row) => row.movement_type === "out").reduce((total, row) => total + Number(row.amount || 0), 0);
    return {
      outlet_id: id,
      outlet: outletMap.get(id),
      total_in: totalIn,
      total_out: totalOut,
      balance: totalIn - totalOut,
      mutation_count: outletRows.length
    };
  });
}

function sumFinanceEntries(groups, filters) {
  const groupSet = new Set(groups);
  return getFinanceEntryRows({ ...filters, activeOnly: true }).filter((entry) => groupSet.has(entry.group));
}

function groupAmounts(rows, getKey, getDescription) {
  const map = new Map();
  rows.forEach((row) => {
    const key = getKey(row);
    const existing = map.get(key) || {
      key,
      description: getDescription(row),
      account_code: row.account_code || null,
      total: 0
    };
    existing.total += Number(row.signed_amount ?? row.amount ?? row.total ?? 0);
    map.set(key, existing);
  });
  return [...map.values()].filter((row) => Math.round(Number(row.total || 0)) !== 0);
}

function dateOnly(value = new Date()) {
  if (value instanceof Date) {
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${value.getFullYear()}-${month}-${day}`;
  }
  return String(value || new Date().toISOString()).slice(0, 10);
}

function isDiscountActiveForDate(discount, date = new Date()) {
  if (!discount || discount.status !== "active") return false;
  const currentDate = dateOnly(date);
  const startsAt = dateOnly(discount.starts_at);
  const endsAt = dateOnly(discount.ends_at);
  return startsAt <= currentDate && endsAt >= currentDate;
}

function calculateDiscountAmount(discount, subtotal) {
  const base = Math.max(0, Math.round(Number(subtotal || 0)));
  if (!discount || base <= 0) return 0;
  const value = Math.max(0, Number(discount.value || 0));
  const rawAmount = discount.type === "percent" ? Math.round((base * value) / 100) : Math.round(value);
  return Math.min(base, Math.max(0, rawAmount));
}

function getDiscountOutletIds(discountId) {
  return (data.discount_outlets || [])
    .filter((row) => row.discount_id === discountId)
    .map((row) => row.outlet_id)
    .filter((outletId) => outletMap.has(outletId));
}

function discountAppliesToOutlet(discount, outletId) {
  if (!discount || !outletId) return false;
  return getDiscountOutletIds(discount.id).includes(outletId);
}

function syncDiscountOutlets(discountId, outletIds = []) {
  const uniqueOutletIds = [...new Set(outletIds)].filter((outletId) => outletMap.has(outletId));
  data.discount_outlets = (data.discount_outlets || []).filter((row) => row.discount_id !== discountId);
  data.discount_outlets.push(
    ...uniqueOutletIds.map((outletId) => ({
      discount_id: discountId,
      outlet_id: outletId
    }))
  );
}

function withDiscountOutlets(discount) {
  if (!discount) return null;
  const outletIds = getDiscountOutletIds(discount.id);
  return {
    ...discount,
    outlet_ids: outletIds,
    outlets: outletIds.map((outletId) => outletMap.get(outletId)).filter(Boolean)
  };
}

function getDiscountRows(keyword = "", { activeForDate = null } = {}) {
  return (data.discounts || [])
    .filter((discount) => !activeForDate || isDiscountActiveForDate(discount, activeForDate))
    .map(withDiscountOutlets)
    .filter((discount) => includesText(`${discount.name} ${discount.type} ${discount.value} ${discount.status} ${discount.outlets.map((outlet) => outlet.name).join(" ")}`, keyword))
    .sort((a, b) => String(a.starts_at || "").localeCompare(String(b.starts_at || "")) || a.name.localeCompare(b.name));
}

function getMaterialCategoryRows(keyword = "") {
  return (data.raw_material_categories || [])
    .map((category) => {
      const materials = (data.raw_materials || []).filter((material) => material.category_id === category.id);
      return {
        ...category,
        account: category.account_code ? getFinancialAccountByCode(category.account_code) || null : null,
        material_count: materials.length,
        material_type_label: category.type === "biaya" ? "Biaya Produksi" : "Harga Pokok Penjualan"
      };
    })
    .filter((category) => includesText(`${category.name} ${category.type} ${category.account_code} ${category.status}`, keyword))
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
}

function getPrintSettings() {
  return {
    printer_name: data.print_settings?.printer_name || "Printer Kasir Utama",
    printer_status: data.print_settings?.printer_status || "active",
    mode: "single_printer_mock",
    templates: data.print_templates.map((template) => ({ ...template }))
  };
}

function getCompositionRows() {
  return data.product_compositions.map((composition) => ({
    ...composition,
    product: productMap.get(composition.product_id),
    material: materialMap.get(composition.material_id)
  }));
}

function getMaterialRows(outletId = "all") {
  refreshMaterialLastPurchasePrices();

  return data.raw_materials
    .map((material) => {
      const stocks = data.raw_material_stocks
        .filter((stock) => stock.material_id === material.id)
        .filter(outletFilter(outletId))
        .map((stock) => ({
          ...stock,
          outlet: outletMap.get(stock.outlet_id)
        }));

      return {
        ...material,
        category: material.category_id ? materialCategoryMap.get(material.category_id) : null,
        type: material.type || "hpp",
        account_code: materialCategoryMap.get(material.category_id)?.account_code || material.account_code || "5002",
        account: getFinancialAccountByCode(materialCategoryMap.get(material.category_id)?.account_code || material.account_code || "5002") || null,
        stocks,
        total_stock: stocks.reduce((total, stock) => total + Number(stock.quantity || 0), 0),
        stock_value: stocks.reduce((total, stock) => total + Number(stock.stock_value || 0), 0),
        outlet_count: stocks.length
      };
    })
    .filter((material) => outletId === "all" || material.stocks.length > 0);
}

function getUnitRows() {
  return units.map((unit) => {
    const materialCount = data.raw_materials.filter((material) => material.unit === unit.code).length;

    return {
      ...unit,
      material_count: materialCount
    };
  });
}

function getSupplierRows() {
  return data.suppliers.map((supplier) => {
    const purchases = data.purchases
      .filter((purchase) => purchase.supplier_id === supplier.id)
      .map((purchase) => ({
        ...purchase,
        outlet: outletMap.get(purchase.outlet_id),
        item_count: purchase.items.length
      }))
      .sort((a, b) => new Date(b.purchase_date) - new Date(a.purchase_date));

    return {
      ...supplier,
      purchases,
      purchase_count: purchases.length,
      purchase_total: purchases.reduce((total, purchase) => total + Number(purchase.total || 0), 0)
    };
  });
}

function getUserRows() {
  return data.users.map((user) => {
    const { cashier_pin: _cashierPin, pin_hash: _pinHash, ...safeUser } = user;
    return {
      ...safeUser,
      has_pin: Boolean(user.cashier_pin || user.pin_hash || (user.role_id === "role_cashier" ? "000000" : "")),
      role: roleMap.get(user.role_id),
      outlets: user.outlet_ids.map((id) => outletMap.get(id)).filter(Boolean)
    };
  });
}

function getCustomerRows(outletId = "all", keyword = "") {
  return data.customers
    .filter(outletFilter(outletId))
    .filter((customer) => includesText(`${customer.name} ${customer.phone} ${customer.barcode}`, keyword))
    .map((customer) => ({
      ...customer,
      registered_at: customer.registered_at || customer.created_at || new Date().toISOString().slice(0, 10),
      outlet: outletMap.get(customer.outlet_id)
    }));
}

function getOutletRows() {
  return data.outlets.map((outlet) => {
    const stocks = data.raw_material_stocks.filter((stock) => stock.outlet_id === outlet.id);
    const purchases = data.purchases.filter((purchase) => purchase.outlet_id === outlet.id);

    return {
      ...outlet,
      user_count: data.users.filter((user) => user.outlet_ids.includes(outlet.id)).length,
      customer_count: data.customers.filter((customer) => customer.outlet_id === outlet.id).length,
      stock_item_count: stocks.length,
      low_stock_count: stocks.filter((stock) => {
        const material = materialMap.get(stock.material_id);
        return material && Number(stock.quantity || 0) <= Number(material.low_stock_threshold || 0);
      }).length,
      purchase_count: purchases.length,
      purchase_total: purchases.reduce((total, purchase) => total + Number(purchase.total || 0), 0)
    };
  });
}

function getTableRows(outletId = "all", keyword = "") {
  return data.tables
    .filter(outletFilter(outletId))
    .map((table) => {
      const transactions = data.transactions
        .filter((transaction) => transaction.table_id === table.id)
        .map((transaction) => ({
          ...transaction,
          outlet: outletMap.get(transaction.outlet_id),
          cashier: userMap.get(transaction.cashier_id),
          customer: transaction.customer_id ? customerMap.get(transaction.customer_id) : null
        }))
        .sort((a, b) => new Date(b.transaction_date) - new Date(a.transaction_date));

      return {
        ...table,
        outlet: outletMap.get(table.outlet_id),
        transactions,
        transaction_count: transactions.length,
        sales_total: transactions.reduce((total, transaction) => total + Number(transaction.total || 0), 0)
      };
    })
    .filter((table) => includesText(`${table.number} ${table.outlet?.name} ${table.status}`, keyword));
}

function getMobileCatalogSnapshot() {
  const activeOutlets = data.outlets.filter((outlet) => outlet.status === "active");
  const activeOutletIds = new Set(activeOutlets.map((outlet) => outlet.id));
  const activeCategories = data.categories.filter((category) => category.status === "active");
  const activeCategoryIds = new Set(activeCategories.map((category) => category.id));
  const activePriceRows = data.product_prices.filter((price) => price.status === "active" && activeOutletIds.has(price.outlet_id) && Number(price.price || 0) > 0);
  const productIdsWithActivePrice = new Set(activePriceRows.map((price) => price.product_id));
  const activeProducts = data.products.filter((product) => product.status === "active" && activeCategoryIds.has(product.category_id) && productIdsWithActivePrice.has(product.id));
  const activeProductIds = new Set(activeProducts.map((product) => product.id));

  return {
    schema_version: "admin-mobile-catalog-v1",
    generated_at: new Date().toISOString(),
    source: "pos-admin-barokah-runtime-mock",
    outlets: activeOutlets.map((outlet) => ({
      id: outlet.id,
      name: outlet.name,
      code: outlet.code,
      address: outlet.address,
      phone: outlet.phone,
      status: outlet.status
    })),
    transfer_outlets: activeOutlets.map((outlet) => ({
      id: outlet.id,
      name: outlet.name,
      code: outlet.code,
      address: outlet.address,
      phone: outlet.phone,
      status: outlet.status
    })),
    cashiers: data.users
      .filter((user) => user.status === "active" && hasApkAccess(roleMap.get(user.role_id)) && Boolean(user.cashier_pin || (user.role_id === "role_cashier" ? "000000" : "")))
      .map((user) => ({
        id: user.id,
        name: user.name,
        username: user.username,
        password: "",
        has_pin: Boolean(user.cashier_pin || "000000"),
        role_id: user.role_id,
        role_name: roleMap.get(user.role_id)?.name || "",
        permissions: roleMap.get(user.role_id)?.permissions || {},
        outlet_ids: user.outlet_ids.filter((outletId) => activeOutletIds.has(outletId)),
        status: user.status
      }))
      .filter((user) => user.outlet_ids.length),
    categories: activeCategories.map((category) => ({
      id: category.id,
      name: category.name,
      sort_order: category.sort_order,
      status: category.status
    })),
    products: activeProducts.map((product) => ({
      id: product.id,
      category_id: product.category_id,
      sku: product.sku,
      name: product.name,
      image_url: product.image_url || null,
      variants: productVariantsForProduct(product.id, { activeOnly: true }).map((variant) => ({
        id: variant.id,
        product_id: variant.product_id,
        name: variant.name,
        status: variant.status,
        sort_order: Number(variant.sort_order || 0)
      })),
      status: product.status
    })),
    product_prices: activePriceRows
      .filter((price) => activeProductIds.has(price.product_id))
      .map((price) => ({
        id: price.id,
        product_id: price.product_id,
        outlet_id: price.outlet_id,
        price: Number(price.price || 0),
        status: price.status
      })),
    customers: data.customers
      .filter((customer) => customer.status === "active" && activeOutletIds.has(customer.outlet_id))
      .map((customer) => ({
        id: customer.id,
        outlet_id: customer.outlet_id,
        name: customer.name,
        phone: customer.phone,
        barcode: customer.barcode,
        points: Number(customer.points || 0),
        status: customer.status
      })),
    tables: data.tables
      .filter((table) => table.status === "active" && activeOutletIds.has(table.outlet_id))
      .map((table) => ({
        id: table.id,
        outlet_id: table.outlet_id,
        number: table.number,
        status: table.status
      })),
    expense_categories: data.expense_categories
      .filter((category) => category.status === "active")
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
      .map((category) => ({
        id: category.id,
        name: category.name,
        sort_order: Number(category.sort_order || 0),
        status: category.status
      })),
    payment_methods: data.payment_methods
      .filter((method) => method.status === "active")
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
      .map((method) => ({
        id: method.id,
        name: method.name,
        code: method.code,
        account_code: method.account_code,
        sort_order: Number(method.sort_order || 0),
        status: method.status
      })),
    discounts: getDiscountRows("", { activeForDate: new Date() })
      .map((discount) => ({
        id: discount.id,
        name: discount.name,
        type: discount.type,
        value: Number(discount.value || 0),
        starts_at: dateOnly(discount.starts_at),
        ends_at: dateOnly(discount.ends_at),
        outlet_ids: (discount.outlet_ids || []).filter((outletId) => activeOutletIds.has(outletId)),
        status: discount.status
      }))
      .filter((discount) => discount.outlet_ids.length),
    raw_material_categories: data.raw_material_categories.filter((category) => category.status === "active").sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
    raw_materials: data.raw_materials
      .filter((material) => material.status === "active")
      .map((material) => {
        const category = materialCategoryMap.get(material.category_id);
        return {
          id: material.id,
          name: material.name,
          unit: material.unit,
          type: material.type || category?.type || "hpp",
          category_id: material.category_id,
          account_code: category?.account_code || material.account_code,
          status: material.status
        };
      }),
    suppliers: data.suppliers
      .filter((supplier) => supplier.status === "active")
      .map((supplier) => ({
        id: supplier.id,
        name: supplier.name,
        phone: supplier.phone,
        status: supplier.status
      })),
    print_templates: data.print_templates.map((template) => ({
      key: template.key,
      label: template.label,
      enabled: template.enabled !== false,
      footer_text: template.footer_text || ""
    })),
    print_settings: {
      printer_name: data.print_settings?.printer_name || "Printer Kasir Utama",
      printer_status: data.print_settings?.printer_status || "active",
      mode: "single_printer_mock"
    },
    app_security: getAppSecuritySettings()
  };
}

function getStockRows(outletId = "all") {
  return data.raw_material_stocks.filter(outletFilter(outletId)).map((stock) => {
    const material = materialMap.get(stock.material_id);
    const unitPrice = getLatestMaterialPrice(stock.material_id, stock.outlet_id);
    return {
      ...stock,
      last_purchase_price: unitPrice,
      unit_price: unitPrice,
      stock_value: Math.round(Number(stock.quantity || 0) * unitPrice),
      outlet: outletMap.get(stock.outlet_id),
      material,
      status: stock.quantity <= 0 ? "out_of_stock" : stock.quantity <= material.low_stock_threshold ? "low_stock" : "normal"
    };
  });
}

function getPurchaseRows(outletId = "all") {
  return data.purchases.filter(outletFilter(outletId)).map((purchase) => {
    const items = (purchase.items || []).map((item) => {
      const material = materialMap.get(item.material_id);
      const category = materialCategoryMap.get(material?.category_id);
      return {
        ...item,
        material,
        material_type: material?.type || "hpp",
        category
      };
    });
    const hppTotal = items.filter((item) => item.material_type !== "biaya").reduce((total, item) => total + Number(item.subtotal || 0), 0);
    const biayaTotal = items.filter((item) => item.material_type === "biaya").reduce((total, item) => total + Number(item.subtotal || 0), 0);

    return {
      ...purchase,
      items,
      outlet: outletMap.get(purchase.outlet_id),
      supplier: supplierMap.get(purchase.supplier_id) || null,
      created_by_user: purchase.created_by ? userMap.get(purchase.created_by) : null,
      item_count: items.length,
      hpp_total: hppTotal,
      biaya_total: biayaTotal,
      grand_total: Number(purchase.total || hppTotal + biayaTotal)
    };
  });
}

function getExpenseRows(outletId = "all") {
  return data.expenses
    .filter(outletFilter(outletId))
    .map((expense) => ({
      ...expense,
      status: expense.status || "approved",
      outlet: outletMap.get(expense.outlet_id),
      created_by_user: userMap.get(expense.created_by),
      corrected_by_user: userMap.get(expense.corrected_by),
      approved_by_user: userMap.get(expense.approved_by),
      rejected_by_user: userMap.get(expense.rejected_by)
    }))
    .sort((a, b) => new Date(b.expense_date) - new Date(a.expense_date));
}

function getTransferRows(outletId = "all") {
  return data.stock_transfers
    .filter((transfer) => outletId === "all" || transfer.from_outlet_id === outletId || transfer.to_outlet_id === outletId)
    .map((transfer) => {
      const loanSummary = getLoanSummary(transfer);
      const loanParent = transfer.loan_return_for_transfer_id ? data.stock_transfers.find((item) => item.id === transfer.loan_return_for_transfer_id) : null;
      return {
        ...transfer,
        transfer_type: normalizeTransferType(transfer.transfer_type),
        transfer_type_label: getTransferTypeLabel(transfer),
        loan_return_for_transfer_id: transfer.loan_return_for_transfer_id || null,
        loan_parent: loanParent
          ? {
              id: loanParent.id,
              transfer_date: loanParent.transfer_date,
              from_outlet_id: loanParent.from_outlet_id,
              to_outlet_id: loanParent.to_outlet_id,
              from_outlet: outletMap.get(loanParent.from_outlet_id),
              to_outlet: outletMap.get(loanParent.to_outlet_id)
            }
          : null,
        ...loanSummary,
        source: transfer.source || "admin_web",
        batch_id: transfer.batch_id || null,
        note: transfer.note || "",
        items: (transfer.items || []).map((item) => {
          const material = materialMap.get(item.material_id);
          const category = materialCategoryMap.get(material?.category_id);
          return {
            ...item,
            material,
            material_type: material?.type || "hpp",
            category
          };
        }),
        from_outlet: outletMap.get(transfer.from_outlet_id),
        to_outlet: outletMap.get(transfer.to_outlet_id),
        requested_user: userMap.get(transfer.requested_by),
        approved_user: transfer.approved_by ? userMap.get(transfer.approved_by) : null,
        item_count: (transfer.items || []).length
      };
    });
}

function getOpnameRows(outletId = "all") {
  return data.stock_opnames
    .filter(outletFilter(outletId))
    .map((opname) => ({
      ...opname,
      outlet: outletMap.get(opname.outlet_id),
      material: materialMap.get(opname.material_id),
      user: userMap.get(opname.created_by)
    }))
    .sort((a, b) => {
      const dateCompare = String(b.opname_date).localeCompare(String(a.opname_date));
      if (dateCompare !== 0) return dateCompare;
      return String(b.id).localeCompare(String(a.id), "id-ID", {
        numeric: true
      });
    });
}

function getOpnameRequestStore() {
  if (!Array.isArray(data.stock_opname_requests)) data.stock_opname_requests = [];
  return data.stock_opname_requests;
}

function getSelectedOpnameMaterialIds(outletId) {
  return new Set((data.stock_opname_material_selections || []).filter((row) => row.outlet_id === outletId).map((row) => row.material_id));
}

function normalizeOpnameRequestItem(row = {}, outletId, date, { allowInactiveMaterialIds = new Set() } = {}) {
  const material = materialMap.get(row.material_id || row.materialId);
  if (!material || (material.status === "inactive" && !allowInactiveMaterialIds.has(material.id))) {
    throw new Error("Produk opname wajib aktif.");
  }

  const actualQuantity = Number(row.actual_quantity ?? row.actualQuantity ?? 0);
  const damageQuantity = Number(row.damage_quantity ?? row.damageQuantity ?? 0);
  const openingQuantity = roundQuantity(row.opening_quantity ?? row.openingQuantity ?? 0);
  if (!Number.isFinite(openingQuantity) || openingQuantity < 0 || !Number.isFinite(actualQuantity) || actualQuantity < 0 || !Number.isFinite(damageQuantity) || damageQuantity < 0) {
    throw new Error("Stok awal, rusak, dan sisa stok wajib valid.");
  }

  const transferBreakdown = getDailyTransferBreakdown(outletId, date);
  const purchaseQuantity = roundQuantity(getDailyPurchaseTotals(outletId, date).get(material.id) || 0);
  const fallbackTransferInQuantity = roundQuantity(transferBreakdown.inTotals.get(material.id) || 0);
  const fallbackTransferOutQuantity = roundQuantity(transferBreakdown.outTotals.get(material.id) || 0);
  const transferInQuantity = fallbackTransferInQuantity;
  const transferOutQuantity = fallbackTransferOutQuantity;
  const salesQuantity = roundQuantity(getDailySalesMaterialTotals(outletId, date).get(material.id) || 0);
  const physicalQuantity = roundQuantity(actualQuantity);
  const unitPrice = Number(row.unit_price ?? row.unitPrice ?? getLatestMaterialPrice(material.id, outletId, date));
  const calculated = calculateStockOpname({
    openingQuantity,
    purchaseQuantity,
    transferInQuantity,
    transferOutQuantity,
    salesQuantity,
    damageQuantity,
    actualQuantity: physicalQuantity,
    unitPrice
  });

  return {
    material_id: material.id,
    material_name: material.name,
    material_type: material.type || "hpp",
    unit: material.unit,
    unit_price: unitPrice,
    opening_quantity: calculated.opening_quantity,
    purchase_quantity: calculated.purchase_quantity,
    transfer_in_quantity: calculated.transfer_in_quantity,
    incoming_quantity: calculated.incoming_quantity,
    transfer_quantity: calculated.transfer_quantity,
    transfer_out_quantity: calculated.transfer_out_quantity,
    damage_quantity: calculated.damage_quantity,
    computed_sales_quantity: salesQuantity,
    system_quantity: calculated.system_quantity,
    real_system_quantity: calculated.real_system_quantity,
    actual_quantity: calculated.actual_quantity,
    difference: calculated.difference,
    status: calculated.status,
    loss_amount: calculated.loss_amount,
    note: getOpnameNote(calculated.difference)
  };
}

function enrichOpnameRequest(request) {
  return {
    ...request,
    source: request.source || "kasir_app",
    outlet: outletMap.get(request.outlet_id),
    requested_user: request.requested_by ? userMap.get(request.requested_by) : null,
    approved_user: request.approved_by ? userMap.get(request.approved_by) : null,
    rejected_user: request.rejected_by ? userMap.get(request.rejected_by) : null,
    item_count: (request.items || []).length,
    total_loss_amount: (request.items || []).reduce((total, item) => total + Number(item.loss_amount || 0), 0),
    items: (request.items || []).map((item) => {
      const material = materialMap.get(item.material_id);
      const incomingQuantity = Number(item.incoming_quantity || 0);
      const transferQuantity = Number(item.transfer_quantity || 0);
      const transferOutQuantity = Number(item.transfer_out_quantity || 0);
      const transferInQuantity = Number(item.transfer_in_quantity ?? Math.max(transferQuantity + transferOutQuantity, 0));
      const purchaseQuantity = Number(item.purchase_quantity ?? Math.max(incomingQuantity - transferInQuantity, 0));
      return {
        ...item,
        purchase_quantity: purchaseQuantity,
        transfer_in_quantity: transferInQuantity,
        material,
        category: materialCategoryMap.get(material?.category_id),
        material_type: item.material_type || material?.type || "hpp",
        unit: item.unit || material?.unit || ""
      };
    })
  };
}

function getOpnameRequestRows({ outletId = "all", from, to, status } = {}) {
  return getOpnameRequestStore()
    .filter((request) => outletId === "all" || !outletId || request.outlet_id === outletId)
    .filter((request) => !status || status === "all" || request.status === status)
    .filter((request) => withinDateRange(request.opname_date, from, to))
    .map(enrichOpnameRequest)
    .sort((a, b) => {
      const dateCompare = String(b.opname_date).localeCompare(String(a.opname_date));
      if (dateCompare !== 0) return dateCompare;
      return String(b.created_at || b.id).localeCompare(String(a.created_at || a.id), "id-ID", { numeric: true });
    });
}

function getStockRow(outletId, materialId) {
  return data.raw_material_stocks.find((stock) => stock.outlet_id === outletId && stock.material_id === materialId);
}

function ensureStockRow(outletId, materialId) {
  const existing = getStockRow(outletId, materialId);
  if (existing) return existing;

  const material = materialMap.get(materialId);
  const stock = {
    id: createSequentialId("stock", data.raw_material_stocks),
    outlet_id: outletId,
    material_id: materialId,
    quantity: 0,
    unit: material?.unit || ""
  };
  data.raw_material_stocks.push(stock);
  return stock;
}

function addMaterialQuantity(totals, materialId, quantity) {
  totals.set(materialId, roundQuantity((totals.get(materialId) || 0) + Number(quantity || 0)));
}

function getDailyPurchaseTotals(outletId, date) {
  const totals = new Map();
  data.purchases
    .filter((purchase) => purchase.outlet_id === outletId && purchase.status === "approved" && isSameDate(purchase.purchase_date, date))
    .forEach((purchase) => {
      purchase.items.forEach((item) => addMaterialQuantity(totals, item.material_id, item.quantity));
    });
  return totals;
}

function getDailyTransferTotals(outletId, date) {
  const totals = new Map();
  data.stock_transfers
    .filter((transfer) => transfer.status === "approved" && isSameDate(transfer.transfer_date, date))
    .forEach((transfer) => {
      transfer.items.forEach((item) => {
        if (transfer.to_outlet_id === outletId) addMaterialQuantity(totals, item.material_id, item.quantity);
        if (transfer.from_outlet_id === outletId) addMaterialQuantity(totals, item.material_id, -Number(item.quantity || 0));
      });
    });
  return totals;
}

function getDailyTransferBreakdown(outletId, date) {
  const inTotals = new Map();
  const outTotals = new Map();
  const netTotals = new Map();
  data.stock_transfers
    .filter((transfer) => transfer.status === "approved" && isSameDate(transfer.transfer_date, date))
    .forEach((transfer) => {
      transfer.items.forEach((item) => {
        if (transfer.to_outlet_id === outletId) {
          addMaterialQuantity(inTotals, item.material_id, item.quantity);
          addMaterialQuantity(netTotals, item.material_id, item.quantity);
        }
        if (transfer.from_outlet_id === outletId) {
          addMaterialQuantity(outTotals, item.material_id, item.quantity);
          addMaterialQuantity(netTotals, item.material_id, -Number(item.quantity || 0));
        }
      });
    });
  return { inTotals, outTotals, netTotals };
}

function addTransactionMaterialUsage(totals, transactionId, sign = 1) {
  data.transaction_items
    .filter((item) => item.transaction_id === transactionId)
    .forEach((item) => {
      data.product_compositions
        .filter((composition) => composition.product_id === item.product_id)
        .forEach((composition) => {
          addMaterialQuantity(totals, composition.material_id, Number(sign || 0) * Number(composition.quantity || 0) * Number(item.quantity || 0));
        });
    });
}

function transactionStockWasDeducted(transaction) {
  if (transaction.stock_deducted === true) return true;
  return transaction.stock_deducted == null && ["paid", "refunded", "cancelled"].includes(transaction.status);
}

function getDailySalesMaterialTotals(outletId, date) {
  const totals = new Map();

  data.transactions
    .filter((transaction) => transaction.outlet_id === outletId && transactionStockWasDeducted(transaction))
    .forEach((transaction) => {
      if (isSameDate(transaction.operational_at || transaction.transaction_date, date)) {
        addTransactionMaterialUsage(totals, transaction.id, 1);
      }
      if (transaction.stock_cancelled === true && isSameDate(transaction.stock_cancelled_at || transaction.cancelled_at, date)) {
        addTransactionMaterialUsage(totals, transaction.id, -1);
      }
    });

  (data.transaction_refunds || [])
    .filter((refund) => refund.status !== "cancelled" && isSameDate(refund.refunded_at, date))
    .forEach((refund) => {
      const transaction = data.transactions.find((item) => item.id === refund.transaction_id && item.outlet_id === outletId && transactionStockWasDeducted(item));
      if (transaction) addTransactionMaterialUsage(totals, transaction.id, -1);
    });

  return totals;
}

function applyTransactionStockDeduction(transaction, items) {
  const totals = new Map();

  items.forEach((item) => {
    data.product_compositions
      .filter((composition) => composition.product_id === item.productId)
      .forEach((composition) => {
        const material = materialMap.get(composition.material_id);
        if (!material || material.status === "inactive") return;
        addMaterialQuantity(totals, composition.material_id, Number(composition.quantity || 0) * Number(item.quantity || 0));
      });
  });

  totals.forEach((quantity, materialId) => {
    if (!quantity) return;
    const material = materialMap.get(materialId);
    const stock = ensureStockRow(transaction.outlet_id, materialId);
    stock.quantity = roundQuantity(Number(stock.quantity || 0) - quantity);
    stock.unit = material?.unit || stock.unit;
  });

  transaction.stock_deducted = true;
  transaction.stock_deducted_at = new Date().toISOString();
  return totals;
}

function applyTransactionStockReturn(transaction) {
  if (transaction.stock_deducted !== true || transaction.stock_refunded === true) {
    return new Map();
  }

  const totals = new Map();
  data.transaction_items
    .filter((item) => item.transaction_id === transaction.id)
    .forEach((item) => {
      data.product_compositions
        .filter((composition) => composition.product_id === item.product_id)
        .forEach((composition) => {
          const material = materialMap.get(composition.material_id);
          if (!material || material.status === "inactive") return;
          addMaterialQuantity(totals, composition.material_id, Number(composition.quantity || 0) * Number(item.quantity || 0));
        });
    });

  totals.forEach((quantity, materialId) => {
    if (!quantity) return;
    const material = materialMap.get(materialId);
    const stock = ensureStockRow(transaction.outlet_id, materialId);
    stock.quantity = roundQuantity(Number(stock.quantity || 0) + quantity);
    stock.unit = material?.unit || stock.unit;
  });

  transaction.stock_refunded = true;
  transaction.stock_refunded_at = new Date().toISOString();
  return totals;
}

function getTransactionMaterialQuantities(transaction) {
  const totals = new Map();

  data.transaction_items
    .filter((item) => item.transaction_id === transaction.id)
    .forEach((item) => {
      data.product_compositions
        .filter((composition) => composition.product_id === item.product_id)
        .forEach((composition) => {
          const material = materialMap.get(composition.material_id);
          if (!material || material.status === "inactive") return;
          addMaterialQuantity(totals, composition.material_id, Number(composition.quantity || 0) * Number(item.quantity || 0));
        });
    });

  return totals;
}

function getStockMovementRows(outletId = "all") {
  const movements = [];
  const includeOutlet = outletFilter(outletId);

  data.transactions
    .filter(includeOutlet)
    .filter((transaction) => ["paid", "refunded"].includes(transaction.status) && transaction.stock_deducted === true)
    .forEach((transaction) => {
      getTransactionMaterialQuantities(transaction).forEach((quantity, materialId) => {
        if (!quantity) return;
        const material = materialMap.get(materialId);
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

  data.transaction_refunds
    .filter(includeOutlet)
    .filter((refund) => refund.status !== "cancelled")
    .forEach((refund) => {
      const transaction = data.transactions.find((item) => item.id === refund.transaction_id);
      if (!transaction || transaction.stock_deducted !== true) return;

      getTransactionMaterialQuantities(transaction).forEach((quantity, materialId) => {
        if (!quantity) return;
        const material = materialMap.get(materialId);
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

function getLatestMaterialPrice(materialId, outletId, date) {
  const matchingItems = data.purchases
    .map((purchase, purchaseIndex) => ({ purchase, purchaseIndex }))
    .filter(({ purchase }) => purchase.outlet_id === outletId && purchase.status === "approved" && (!date || purchase.purchase_date <= date))
    .flatMap((purchase) =>
      purchase.purchase.items
        .filter((item) => item.material_id === materialId)
        .map((item) => ({
          purchase_date: purchase.purchase.purchase_date,
          purchase_index: purchase.purchaseIndex,
          unit_price: Number(item.unit_price || 0)
        }))
    )
    .sort((a, b) => {
      const dateCompare = b.purchase_date.localeCompare(a.purchase_date);
      if (dateCompare !== 0) return dateCompare;
      return a.purchase_index - b.purchase_index;
    });

  if (matchingItems[0]) return matchingItems[0].unit_price;

  const material = materialMap.get(materialId);
  return Number(material?.last_purchase_price || 0);
}

function getMaterialPriceComparisons({ outletId = "all", from, to } = {}) {
  const activeMaterials = new Set(data.raw_materials.filter((material) => material.status !== "inactive").map((material) => material.id));
  const purchaseItems = data.purchases
    .map((purchase, purchaseIndex) => ({ purchase, purchaseIndex }))
    .filter(({ purchase }) => purchase.status === "approved")
    .flatMap(({ purchase, purchaseIndex }) =>
      (purchase.items || [])
        .filter((item) => activeMaterials.has(item.material_id))
        .map((item, itemIndex) => ({
          id: `${purchase.id}_${item.material_id}_${itemIndex}`,
          material_id: item.material_id,
          outlet_id: purchase.outlet_id,
          supplier_id: purchase.supplier_id,
          purchase_id: purchase.id,
          purchase_date: purchase.purchase_date,
          purchase_index: purchaseIndex,
          item_index: itemIndex,
          unit_price: Number(item.unit_price || 0)
        }))
    );

  const grouped = new Map();
  purchaseItems.forEach((item) => {
    const key = `${item.outlet_id}_${item.material_id}`;
    const rows = grouped.get(key) || [];
    rows.push(item);
    grouped.set(key, rows);
  });

  const latestRows = Array.from(grouped.entries())
    .map(([key, rows]) => {
      const sortedRows = rows.sort((a, b) => {
        const dateCompare = String(b.purchase_date || "").localeCompare(String(a.purchase_date || ""));
        if (dateCompare !== 0) return dateCompare;
        if (b.purchase_index !== a.purchase_index) return b.purchase_index - a.purchase_index;
        return b.item_index - a.item_index;
      });
      const latestIndex = sortedRows.findIndex((row) => withinDateRange(row.purchase_date, from, to));
      if (latestIndex < 0) return null;
      const latest = sortedRows[latestIndex];
      const material = materialMap.get(latest.material_id);
      const outlet = outletMap.get(latest.outlet_id);
      const supplier = supplierMap.get(latest.supplier_id);

      return {
        id: key,
        material_id: latest.material_id,
        material,
        material_name: material?.name || "-",
        outlet_id: latest.outlet_id,
        outlet,
        outlet_name: outlet?.name || "-",
        supplier_id: latest.supplier_id || null,
        supplier,
        supplier_name: supplier?.name || "-",
        latest_purchase_id: latest.purchase_id,
        latest_purchase_date: latest.purchase_date,
        latest_price: latest.unit_price
      };
    })
    .filter(Boolean);

  const rowsByMaterial = new Map();
  latestRows.forEach((row) => {
    const rows = rowsByMaterial.get(row.material_id) || [];
    rows.push(row);
    rowsByMaterial.set(row.material_id, rows);
  });

  return latestRows
    .filter((row) => outletFilter(outletId)(row))
    .map((row) => {
      const peers = rowsByMaterial.get(row.material_id) || [row];
      const validPrices = peers.map((peer) => Number(peer.latest_price || 0)).filter((price) => Number.isFinite(price) && price >= 0);
      const benchmarkPrice = validPrices.length ? Math.min(...validPrices) : Number(row.latest_price || 0);
      const benchmarkRows = peers.filter((peer) => Math.abs(Number(peer.latest_price || 0) - benchmarkPrice) < 0.0001);
      const benchmarkOutlet = benchmarkRows[0]?.outlet || null;
      const difference = Number(row.latest_price || 0) - benchmarkPrice;
      const changePercent = benchmarkPrice ? (difference / benchmarkPrice) * 100 : 0;
      const status = difference > 0 ? "lebih_mahal" : benchmarkRows.length > 1 && peers.length > 1 ? "sama" : "termurah";

      return {
        ...row,
        benchmark_outlet_id: benchmarkOutlet?.id || null,
        benchmark_outlet: benchmarkOutlet,
        benchmark_outlet_name: benchmarkOutlet?.name || "-",
        benchmark_price: benchmarkPrice,
        previous_purchase_date: null,
        previous_price: benchmarkPrice,
        difference,
        change_percent: changePercent,
        status,
        trend: status
      };
    })
    .sort((a, b) => {
      const diffCompare = Number(b.difference || 0) - Number(a.difference || 0);
      if (diffCompare !== 0) return diffCompare;
      const materialCompare = String(a.material_name || "").localeCompare(String(b.material_name || ""), "id-ID");
      if (materialCompare !== 0) return materialCompare;
      return String(b.latest_purchase_date || "").localeCompare(String(a.latest_purchase_date || ""));
    });
}

function getMaterialPurchaseComparisons({ from, to, outletIds = "", materialIds = "" } = {}) {
  const selectedOutletIds = new Set(parsePosQueryList(outletIds));
  const selectedMaterialIds = new Set(parsePosQueryList(materialIds));
  const outletOptions = getOutletRows().filter((outlet) => outlet.status !== "inactive");
  const materialOptions = data.raw_materials
    .filter((material) => material.status !== "inactive")
    .map((material) => {
      const category = materialCategoryMap.get(material.category_id);
      return {
        id: material.id,
        name: material.name,
        type: material.type || category?.type || "hpp",
        unit: material.unit,
        category_id: material.category_id,
        category_name: category?.name || "-"
      };
    })
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "id-ID"));

  const allowedOutletIds = selectedOutletIds.size ? selectedOutletIds : new Set(outletOptions.map((outlet) => outlet.id));
  const allowedMaterialIds = selectedMaterialIds.size ? selectedMaterialIds : new Set(materialOptions.map((material) => material.id));
  const matrixOutlets = selectedOutletIds.size ? outletOptions.filter((outlet) => selectedOutletIds.has(outlet.id)) : outletOptions;

  const rows = getPurchaseRows("all")
    .filter((purchase) => purchase.status === "approved")
    .filter((purchase) => withinDateRange(purchase.purchase_date, from, to))
    .filter((purchase) => allowedOutletIds.has(purchase.outlet_id))
    .flatMap((purchase) =>
      (purchase.items || [])
        .filter((item) => allowedMaterialIds.has(item.material_id))
        .map((item, itemIndex) => {
          const material = item.material || materialMap.get(item.material_id);
          const category = item.category || materialCategoryMap.get(material?.category_id);
          const outlet = purchase.outlet || outletMap.get(purchase.outlet_id);
          const supplier = purchase.supplier || supplierMap.get(purchase.supplier_id);
          const quantity = Number(item.quantity || 0);
          const unitPrice = Number(item.unit_price || 0);
          const subtotal = Number(item.subtotal ?? quantity * unitPrice);

          return {
            id: `${purchase.id}_${item.material_id}_${itemIndex}`,
            purchase_id: purchase.id,
            purchase_date: purchase.purchase_date,
            outlet_id: purchase.outlet_id,
            outlet,
            outlet_name: outlet?.name || "-",
            material_id: item.material_id,
            material,
            material_name: material?.name || "-",
            material_type: material?.type || category?.type || "hpp",
            category_id: category?.id || null,
            category_name: category?.name || "-",
            quantity,
            unit: item.unit || material?.unit || "",
            unit_price: unitPrice,
            subtotal,
            supplier_id: purchase.supplier_id || null,
            supplier,
            supplier_name: supplier?.name || "-"
          };
        })
    )
    .sort((a, b) => {
      const dateCompare = String(b.purchase_date || "").localeCompare(String(a.purchase_date || ""));
      if (dateCompare !== 0) return dateCompare;
      const outletCompare = String(a.outlet_name || "").localeCompare(String(b.outlet_name || ""), "id-ID");
      if (outletCompare !== 0) return outletCompare;
      return String(a.material_name || "").localeCompare(String(b.material_name || ""), "id-ID");
    });

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

  const matrixRows = materialOptions
    .filter((material) => rows.some((row) => row.material_id === material.id) || selectedMaterialIds.has(material.id))
    .map((material) => {
      const cells = matrixOutlets.map((outlet) => {
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
      const outletCells = cells.map((cell) => {
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
      const maxDifference = cellsWithData.length > 1 ? Math.max(...outletCells.map((cell) => Number(cell.difference || 0))) : 0;

      return {
        id: material.id,
        material_id: material.id,
        material_name: material.name,
        material_type: material.type || "hpp",
        category_name: material.category_name || "-",
        unit: material.unit || "",
        max_difference: maxDifference,
        outlet_cells: outletCells
      };
    })
    .sort((a, b) => {
      const differenceCompare = Number(b.max_difference || 0) - Number(a.max_difference || 0);
      if (differenceCompare !== 0) return differenceCompare;
      return String(a.material_name || "").localeCompare(String(b.material_name || ""), "id-ID");
    });

  return {
    outlets: outletOptions,
    matrix_outlets: matrixOutlets,
    materials: materialOptions,
    rows,
    matrix_rows: matrixRows,
    summary: {
      total_items: rows.length,
      total_amount: rows.reduce((total, row) => total + Number(row.subtotal || 0), 0),
      by_outlet: byOutlet,
      by_material: byMaterial
    }
  };
}

function getLatestMaterialPurchase(materialId, outletId) {
  return data.purchases
    .map((purchase, purchaseIndex) => ({ purchase, purchaseIndex }))
    .filter(({ purchase }) => purchase.status === "approved" && (!outletId || purchase.outlet_id === outletId))
    .flatMap(({ purchase, purchaseIndex }) =>
      purchase.items
        .filter((item) => item.material_id === materialId)
        .map((item) => ({
          outlet_id: purchase.outlet_id,
          purchase_date: purchase.purchase_date,
          purchase_index: purchaseIndex,
          unit_price: Number(item.unit_price || 0)
        }))
    )
    .sort((a, b) => {
      const dateCompare = b.purchase_date.localeCompare(a.purchase_date);
      if (dateCompare !== 0) return dateCompare;
      return a.purchase_index - b.purchase_index;
    })[0];
}

function parsePosQueryList(value) {
  if (Array.isArray(value)) return value.flatMap((item) => parsePosQueryList(item));
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildPosMaterialStockSnapshot(materialId, outletId) {
  const material = materialMap.get(materialId);
  const stock = getStockRow(outletId, materialId);
  const latest = getLatestMaterialPurchase(materialId, outletId);
  return {
    material_id: materialId,
    outlet_id: outletId,
    quantity: Number(stock?.quantity || 0),
    unit: stock?.unit || material?.unit || "",
    last_purchase_price: Number(latest?.unit_price || stock?.last_purchase_price || material?.last_purchase_price || 0),
    last_purchase_date: latest?.purchase_date || stock?.last_purchase_date || material?.last_purchase_date || null
  };
}

function refreshMaterialLastPurchasePrices() {
  data.raw_materials.forEach((material) => {
    const latest = getLatestMaterialPurchase(material.id);

    material.last_purchase_price = Number(latest?.unit_price || material.last_purchase_price || 0);
    material.last_purchase_date = latest?.purchase_date || material.last_purchase_date || null;
    material.last_purchase_outlet_id = latest?.outlet_id || material.last_purchase_outlet_id || null;
  });

  data.raw_material_stocks.forEach((stock) => {
    const latest = getLatestMaterialPurchase(stock.material_id, stock.outlet_id);
    const material = data.raw_materials.find((item) => item.id === stock.material_id);

    stock.last_purchase_price = Number(latest?.unit_price || material?.last_purchase_price || 0);
    stock.last_purchase_date = latest?.purchase_date || stock.last_purchase_date || material?.last_purchase_date || null;
    stock.stock_value = Math.round(Number(stock.quantity || 0) * Number(stock.last_purchase_price || 0));
  });
}

function applyLastPurchasePrice({ materialId, outletId, unitPrice, purchaseDate }) {
  const material = data.raw_materials.find((item) => item.id === materialId);
  const stock = getStockRow(outletId, materialId);

  if (material) {
    const shouldUpdateMaterial = !material.last_purchase_date || String(purchaseDate) >= String(material.last_purchase_date);
    if (shouldUpdateMaterial) {
      material.last_purchase_price = Number(unitPrice || 0);
      material.last_purchase_date = purchaseDate;
      material.last_purchase_outlet_id = outletId;
    }
  }

  if (stock) {
    const shouldUpdateStock = !stock.last_purchase_date || String(purchaseDate) >= String(stock.last_purchase_date);
    if (shouldUpdateStock) {
      stock.last_purchase_price = Number(unitPrice || 0);
      stock.last_purchase_date = purchaseDate;
    }
    stock.stock_value = Math.round(Number(stock.quantity || 0) * Number(stock.last_purchase_price || 0));
  }
}

function applyApprovedPurchaseStock(purchase) {
  (purchase.items || []).forEach((item) => {
    const material = materialMap.get(item.material_id);
    if (!material) return;
    const stock = ensureStockRow(purchase.outlet_id, item.material_id);
    stock.quantity = Number((Number(stock.quantity || 0) + Number(item.quantity || 0)).toFixed(3));
    stock.unit = item.unit || material.unit;
    applyLastPurchasePrice({
      materialId: item.material_id,
      outletId: purchase.outlet_id,
      unitPrice: item.unit_price,
      purchaseDate: purchase.purchase_date
    });
  });
}

function reverseApprovedPurchaseStock(purchase) {
  (purchase.items || []).forEach((item) => {
    const material = materialMap.get(item.material_id);
    if (!material) return;
    const stock = ensureStockRow(purchase.outlet_id, item.material_id);
    stock.quantity = Number((Number(stock.quantity || 0) - Number(item.quantity || 0)).toFixed(3));
    stock.unit = item.unit || material.unit;
    stock.stock_value = Math.round(Number(stock.quantity || 0) * Number(stock.last_purchase_price || 0));
  });
}

function normalizePurchaseItems(items = []) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error("Minimal satu harga pokok produksi wajib diisi.");
  }

  return items.map((item, index) => {
    const materialId = item.material_id || item.materialId;
    const material = materialMap.get(materialId);
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unit_price ?? item.unitPrice ?? 0);
    const subtotal = Math.round(quantity * unitPrice);

    if (!material || material.status === "inactive" || quantity <= 0 || unitPrice <= 0) {
      throw new Error(`Harga Pokok Produksi, qty, dan harga baris ${index + 1} wajib valid.`);
    }

    return {
      material_id: materialId,
      quantity,
      unit: material.unit,
      unit_price: unitPrice,
      subtotal
    };
  });
}

function normalizePurchasePayload(payload, { createdBy = null, source = "admin_web", defaultStatus = "pending" } = {}) {
  const outletId = payload.outlet_id || payload.outletId;
  const supplierId = payload.supplier_id || payload.supplierId || null;
  const supplier = supplierId ? supplierMap.get(supplierId) : null;
  const paymentType = payload.payment_type || payload.paymentType || "lunas";
  const purchaseDate = payload.purchase_date || payload.purchaseDate || new Date().toISOString().slice(0, 10);
  const rawItems = Array.isArray(payload.items)
    ? payload.items
    : [
        {
          material_id: payload.material_id || payload.materialId,
          quantity: payload.quantity,
          unit_price: payload.unit_price ?? payload.unitPrice
        }
      ];
  const items = normalizePurchaseItems(rawItems);
  const total = items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);

  if (!outletMap.has(outletId)) {
    throw new Error("Outlet pembelian wajib valid.");
  }

  if (supplierId && (!supplier || supplier.status !== "active")) {
    throw new Error("Supplier pembelian tidak valid atau inactive.");
  }

  if (!["lunas", "bon"].includes(paymentType)) {
    throw new Error("Tipe pembayaran pembelian harus lunas atau bon.");
  }

  return {
    outlet_id: outletId,
    supplier_id: supplierId,
    purchase_date: purchaseDate,
    status: payload.status || defaultStatus,
    payment_type: paymentType,
    source: payload.source || source,
    batch_id: payload.batch_id || payload.batchId || payload.local_id || payload.localId || null,
    note: payload.note || "",
    created_by: payload.created_by || payload.createdBy || createdBy || null,
    total,
    items
  };
}

function normalizeTransferItems(items = []) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error("Minimal satu harga pokok produksi transfer wajib diisi.");
  }

  return items.map((item, index) => {
    const materialId = item.material_id || item.materialId;
    const material = materialMap.get(materialId);
    const quantity = Number(item.quantity || 0);

    if (!material || material.status === "inactive" || quantity <= 0) {
      throw new Error(`Harga Pokok Produksi dan qty baris ${index + 1} wajib valid.`);
    }

    return {
      material_id: materialId,
      quantity,
      unit: material.unit
    };
  });
}

function normalizeTransferType(value) {
  return value === "loan" ? "loan" : "regular";
}

function getTransferTypeLabel(transfer) {
  if (transfer?.loan_return_for_transfer_id) return "Pengembalian Pinjaman";
  return normalizeTransferType(transfer?.transfer_type) === "loan" ? "Pinjaman" : "Regular";
}

function getLoanReturnTotals(loanTransferId, { includePending = false, excludeTransferId = null } = {}) {
  const totals = new Map();
  data.stock_transfers
    .filter((transfer) => {
      if (transfer.id === excludeTransferId) return false;
      if (transfer.loan_return_for_transfer_id !== loanTransferId) return false;
      if (transfer.status === "approved") return true;
      return includePending && transfer.status === "pending";
    })
    .forEach((transfer) => {
      (transfer.items || []).forEach((item) => {
        totals.set(item.material_id, roundQuantity((totals.get(item.material_id) || 0) + Number(item.quantity || 0)));
      });
    });
  return totals;
}

function getLoanSummary(transfer, options = {}) {
  if (normalizeTransferType(transfer?.transfer_type) !== "loan") {
    return {
      loan_status: null,
      loan_remaining_items: [],
      loan_returned_items: [],
      loan_return_count: 0
    };
  }

  const returnedTotals = getLoanReturnTotals(transfer.id, options);
  const returnedTransfers = data.stock_transfers.filter((item) => item.loan_return_for_transfer_id === transfer.id && item.status === "approved");
  const returnedItems = (transfer.items || []).map((item) => {
    const material = materialMap.get(item.material_id);
    return {
      material_id: item.material_id,
      material_name: material?.name || item.material_name || item.material_id,
      material_type: material?.type || "hpp",
      unit: material?.unit || item.unit,
      quantity: roundQuantity(returnedTotals.get(item.material_id) || 0)
    };
  });
  const remainingItems = (transfer.items || []).map((item, index) => {
    const returned = returnedItems[index]?.quantity || 0;
    const material = materialMap.get(item.material_id);
    return {
      material_id: item.material_id,
      material_name: material?.name || item.material_name || item.material_id,
      material_type: material?.type || "hpp",
      unit: material?.unit || item.unit,
      quantity: roundQuantity(Math.max(0, Number(item.quantity || 0) - returned))
    };
  });

  let loanStatus = "pending";
  if (transfer.status === "rejected") loanStatus = "rejected";
  else if (transfer.status === "pending") loanStatus = "pending";
  else {
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

function validateLoanReturn({ loanTransferId, fromOutletId, toOutletId, items, excludeTransferId = null, includePending = true }) {
  if (!loanTransferId) return null;
  const loanTransfer = data.stock_transfers.find((item) => item.id === loanTransferId);
  if (!loanTransfer || normalizeTransferType(loanTransfer.transfer_type) !== "loan" || loanTransfer.status !== "approved") {
    throw new Error("Transfer pinjaman asal wajib approved dan valid.");
  }
  if (fromOutletId !== loanTransfer.to_outlet_id || toOutletId !== loanTransfer.from_outlet_id) {
    throw new Error("Pengembalian pinjaman wajib dari outlet peminjam ke outlet pemberi.");
  }

  const loanItems = new Map((loanTransfer.items || []).map((item) => [item.material_id, Number(item.quantity || 0)]));
  const returnedTotals = getLoanReturnTotals(loanTransferId, {
    includePending,
    excludeTransferId
  });
  const requestedTotals = new Map();
  items.forEach((item) => {
    requestedTotals.set(item.material_id, roundQuantity((requestedTotals.get(item.material_id) || 0) + Number(item.quantity || 0)));
  });
  requestedTotals.forEach((requestedQuantity, materialId) => {
    if (!loanItems.has(materialId)) {
      throw new Error("Produk pengembalian wajib sama dengan produk pinjaman.");
    }
    const remaining = roundQuantity((loanItems.get(materialId) || 0) - (returnedTotals.get(materialId) || 0));
    if (requestedQuantity > remaining) {
      const material = materialMap.get(materialId);
      throw new Error(`Qty pengembalian ${material?.name || materialId} melebihi sisa pinjaman.`);
    }
  });
  return loanTransfer;
}

function normalizeTransferPayload(payload, { createdBy = null, source = "admin_web", defaultStatus = "pending" } = {}) {
  const fromOutletId = payload.from_outlet_id || payload.fromOutletId;
  const toOutletId = payload.to_outlet_id || payload.toOutletId;
  const loanReturnForTransferId = payload.loan_return_for_transfer_id || payload.loanReturnForTransferId || null;
  const transferType = loanReturnForTransferId ? "regular" : normalizeTransferType(payload.transfer_type || payload.transferType);
  const transferDate = payload.transfer_date || payload.transferDate || new Date().toISOString().slice(0, 10);
  const rawItems = Array.isArray(payload.items)
    ? payload.items
    : [
        {
          material_id: payload.material_id || payload.materialId,
          quantity: payload.quantity
        }
      ];
  const items = normalizeTransferItems(rawItems);

  if (!outletMap.has(fromOutletId) || !outletMap.has(toOutletId)) {
    throw new Error("Outlet asal dan outlet tujuan transfer wajib valid.");
  }

  const fromOutlet = outletMap.get(fromOutletId);
  const toOutlet = outletMap.get(toOutletId);
  if (fromOutlet?.status === "inactive" || toOutlet?.status === "inactive") {
    throw new Error("Outlet asal dan outlet tujuan transfer wajib aktif.");
  }

  if (fromOutletId === toOutletId) {
    throw new Error("Outlet asal dan tujuan tidak boleh sama.");
  }

  validateLoanReturn({
    loanTransferId: loanReturnForTransferId,
    fromOutletId,
    toOutletId,
    items,
    excludeTransferId: payload.id || null,
    includePending: true
  });

  return {
    from_outlet_id: fromOutletId,
    to_outlet_id: toOutletId,
    transfer_type: transferType,
    loan_return_for_transfer_id: loanReturnForTransferId,
    requested_by: payload.requested_by || payload.requestedBy || createdBy || data.users[0]?.id || null,
    approved_by: null,
    status: payload.status || defaultStatus,
    source: payload.source || source,
    batch_id: payload.batch_id || payload.batchId || payload.local_id || payload.localId || null,
    note: payload.note || "",
    transfer_date: transferDate,
    items
  };
}

function getStockOpnameWorksheetRows({ outletId, date, selectedOnly = false }) {
  const outlet = outletMap.get(outletId);
  if (!outlet || !date) return [];

  const purchaseTotals = getDailyPurchaseTotals(outletId, date);
  const transferBreakdown = getDailyTransferBreakdown(outletId, date);
  const salesTotals = getDailySalesMaterialTotals(outletId, date);
  const stockByMaterialId = new Map(data.raw_material_stocks.filter((stock) => stock.outlet_id === outletId).map((stock) => [stock.material_id, stock]));
  const selectedMaterialIds = selectedOnly ? getSelectedOpnameMaterialIds(outletId) : null;

  return data.raw_materials
    .filter((material) => material.status === "active")
    .filter((material) => !selectedMaterialIds || selectedMaterialIds.has(material.id))
    .filter((material) => stockByMaterialId.has(material.id))
    .map((material, index) => {
      const stock = stockByMaterialId.get(material.id);
      const purchaseQuantity = roundQuantity(purchaseTotals.get(material.id) || 0);
      const transferInQuantity = roundQuantity(transferBreakdown.inTotals.get(material.id) || 0);
      const transferOutQuantity = roundQuantity(transferBreakdown.outTotals.get(material.id) || 0);
      const salesQuantity = roundQuantity(salesTotals.get(material.id) || 0);
      const damageQuantity = 0;
      const currentStockQuantity = roundQuantity(stock?.quantity || 0);
      const openingQuantity = roundQuantity(currentStockQuantity - purchaseQuantity - transferInQuantity + transferOutQuantity + salesQuantity);
      const actualQuantity = Math.max(currentStockQuantity, 0);
      const unitPrice = getLatestMaterialPrice(material.id, outletId, date);
      const calculated = calculateStockOpname({
        openingQuantity,
        purchaseQuantity,
        transferInQuantity,
        transferOutQuantity,
        salesQuantity,
        damageQuantity,
        actualQuantity,
        unitPrice
      });

      return {
        id: `worksheet_${outletId}_${material.id}`,
        no: index + 1,
        outlet_id: outletId,
        outlet,
        material_id: material.id,
        material,
        stock_id: stock?.id || null,
        name: material.name,
        unit: material.unit,
        unit_price: unitPrice,
        ...calculated,
        actual_quantity: actualQuantity,
        status: calculated.status,
        note: getOpnameNote(calculated.difference)
      };
    });
}

function createOpnameBatchId() {
  const existing = [...(Array.isArray(data.stock_opnames) ? data.stock_opnames : []), ...(Array.isArray(data.stock_opname_requests) ? data.stock_opname_requests : [])];
  const maxNumber = existing.reduce((max, item) => {
    const match = String(item.batch_id || "").match(/^opname_batch_(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  return `opname_batch_${String(maxNumber + 1).padStart(3, "0")}`;
}

function getTransactionRows({ outletId = "all", from, to } = {}) {
  return data.transactions
    .filter(outletFilter(outletId))
    .filter((transaction) => withinDateRange(transaction.transaction_date, from, to))
    .map(enrichTransaction)
    .sort((a, b) => new Date(b.transaction_date) - new Date(a.transaction_date));
}

function getTopProducts(transactions) {
  const totals = new Map();
  for (const transaction of transactions) {
    for (const item of transaction.items) {
      const current = totals.get(item.product_id) || {
        product: item.product,
        quantity: 0,
        total: 0
      };
      current.quantity += item.quantity;
      current.total += item.subtotal;
      totals.set(item.product_id, current);
    }
  }
  return [...totals.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 6);
}

function getSalesByCategory(transactions) {
  const totals = new Map();

  for (const transaction of transactions) {
    for (const item of transaction.items || []) {
      const product = item.product || productMap.get(item.product_id);
      const categoryId = item.category_id || item.categoryId || product?.category_id || "uncategorized";
      const category = categoryId !== "uncategorized" ? categoryMap.get(categoryId) : null;
      const categoryName = item.category_name || item.categoryName || category?.name || "Tanpa Kategori";
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
      current.transaction_ids.add(transaction.id);
      totals.set(categoryId, current);
    }
  }

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

function getDailySales(transactions, from, to) {
  const totals = new Map();
  for (const transaction of transactions) {
    const date = getLocalDateKey(transaction.transaction_date);
    if (!date) continue;
    totals.set(date, (totals.get(date) || 0) + transaction.total);
  }

  if (from && to) {
    const result = [];
    const cursor = parseLocalDateString(from);
    const end = parseLocalDateString(to);

    while (cursor <= end) {
      const date = toDateString(cursor);
      result.push({ date, total: totals.get(date) || 0 });
      cursor.setDate(cursor.getDate() + 1);
    }

    return result;
  }

  return [...totals.entries()].map(([date, total]) => ({ date, total })).sort((a, b) => a.date.localeCompare(b.date));
}

function getTotalsByDay(rows, dateKey, amountKey, from, to) {
  const totals = new Map();
  for (const row of rows) {
    const date = String(row[dateKey] || "").slice(0, 10);
    totals.set(date, (totals.get(date) || 0) + Number(row[amountKey] || 0));
  }

  if (from && to) {
    const result = [];
    const cursor = parseLocalDateString(from);
    const end = parseLocalDateString(to);

    while (cursor <= end) {
      const date = toDateString(cursor);
      result.push({ date, total: totals.get(date) || 0 });
      cursor.setDate(cursor.getDate() + 1);
    }

    return result;
  }

  return [...totals.entries()].map(([date, total]) => ({ date, total })).sort((a, b) => a.date.localeCompare(b.date));
}

function getSalesByOutlet(transactions, outletId = "all") {
  const totals = new Map();
  const baseOutlets = data.outlets.filter((outlet) => !outletId || outletId === "all" || outlet.id === outletId);

  baseOutlets.forEach((outlet) => {
    totals.set(outlet.id, {
      outlet,
      total: 0,
      transactions: 0,
      average_transaction: 0
    });
  });

  for (const transaction of transactions) {
    const current = totals.get(transaction.outlet_id) || {
      outlet: outletMap.get(transaction.outlet_id),
      total: 0,
      transactions: 0,
      average_transaction: 0
    };
    current.total += transaction.total;
    current.transactions += 1;
    current.average_transaction = Math.round(current.total / current.transactions);
    totals.set(transaction.outlet_id, current);
  }
  return [...totals.values()].sort((a, b) => String(a.outlet?.name || "").localeCompare(String(b.outlet?.name || ""), "id-ID"));
}

function getSalesByCustomer(transactions) {
  const totals = new Map();
  for (const transaction of transactions) {
    const customerId = transaction.customer?.id || transaction.customer_id || "umum";
    const customerName = transaction.customer?.name || transaction.customer_name || "Umum";
    const current = totals.get(customerId) || {
      id: customerId,
      customer: transaction.customer || null,
      customer_name: customerName,
      total: 0,
      transactions: 0
    };
    current.total += Number(transaction.total || 0);
    current.transactions += 1;
    current.average_transaction = Math.round(current.total / current.transactions);
    totals.set(customerId, current);
  }
  return [...totals.values()].sort((a, b) => b.total - a.total);
}

function getSalesByHour(transactions) {
  const rows = Array.from({ length: 24 }, (_, hour) => ({
    id: `${String(hour).padStart(2, "0")}:00`,
    hour: `${String(hour).padStart(2, "0")}:00`,
    total: 0,
    transactions: 0,
    average_transaction: 0
  }));

  for (const transaction of transactions) {
    const hour = getLocalHour(transaction.transaction_date);
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) continue;
    rows[hour].total += Number(transaction.total || 0);
    rows[hour].transactions += 1;
    rows[hour].average_transaction = Math.round(rows[hour].total / rows[hour].transactions);
  }

  return rows;
}

function getSalesByServiceType(transactions) {
  const totals = new Map([
    [
      "dine_in",
      {
        id: "dine_in",
        service_type: "dine_in",
        label: "Dine In",
        total: 0,
        transactions: 0,
        average_transaction: 0
      }
    ],
    [
      "takeaway",
      {
        id: "takeaway",
        service_type: "takeaway",
        label: "Takeaway",
        total: 0,
        transactions: 0,
        average_transaction: 0
      }
    ]
  ]);

  for (const transaction of transactions) {
    const serviceType = transaction.service_type === "dine_in" ? "dine_in" : "takeaway";
    const current = totals.get(serviceType);
    current.total += Number(transaction.total || 0);
    current.transactions += 1;
    current.average_transaction = Math.round(current.total / current.transactions);
  }

  return [...totals.values()];
}

function getSalesComparisonDateRange(from, to) {
  const defaultRange = getDefaultReportRange();
  const dateFrom = from || defaultRange.from;
  const dateTo = to || defaultRange.to;
  const cursor = parseLocalDateString(dateFrom);
  const end = parseLocalDateString(dateTo);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime()) || cursor > end) return [];

  const dates = [];
  while (cursor <= end) {
    dates.push(toDateString(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function buildSalesOutletComparison({ transactions = [], outlets = [], outletOptions = [], from, to } = {}) {
  const dates = getSalesComparisonDateRange(from, to);
  const paymentMethodMap = new Map(getPaymentMethodRows().map((method) => [method.code, method]));
  const rows = transactions
    .filter((transaction) => transaction.status === "paid")
    .map((transaction) => {
      const paymentMethod = transaction.payment?.method || transaction.payment_method || "unknown";
      const paidAmount = Number(transaction.payment?.amount ?? transaction.paid_amount ?? transaction.paidAmount ?? transaction.total ?? 0);
      const changeAmount = Number(transaction.payment?.change_amount ?? transaction.change_amount ?? transaction.changeAmount ?? 0);

      return {
        id: transaction.id,
        order_number: transaction.order_number,
        transaction_date: transaction.transaction_date,
        date: getLocalDateKey(transaction.transaction_date),
        outlet_id: transaction.outlet_id,
        outlet: transaction.outlet || outletMap.get(transaction.outlet_id) || null,
        outlet_name: transaction.outlet?.name || outletMap.get(transaction.outlet_id)?.name || "-",
        customer_id: transaction.customer_id || null,
        customer: transaction.customer || null,
        customer_name: transaction.customer?.name || transaction.customer_name || "Umum",
        payment_method: paymentMethod,
        payment_label: paymentMethodMap.get(paymentMethod)?.name || String(paymentMethod || "-").toUpperCase(),
        payment: transaction.payment || {
          method: paymentMethod,
          amount: paidAmount,
          change_amount: changeAmount
        },
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

function getGrossProfitEstimate(transactions) {
  const revenue = transactions.reduce((total, item) => total + item.total, 0);
  return Math.round(revenue * 0.42);
}

function percentOfIncome(amount, income) {
  if (!income) return 0;
  return Number(((Number(amount || 0) / income) * 100).toFixed(2));
}

function reportRow(description, total, income, options = {}) {
  return {
    description,
    total: Math.round(Number(total || 0)),
    percent_of_income: percentOfIncome(total, income),
    level: options.level || 0,
    kind: options.kind || "account",
    bold: Boolean(options.bold),
    account_code: options.account_code || null
  };
}

function buildProfitLossReport({ outletId = "all", transactions, purchases, expenses, from, to }) {
  const revenue = transactions.reduce((total, item) => total + Number(item.total || 0) + Number(item.discount || 0), 0);
  const discounts = transactions.reduce((total, item) => total + Number(item.discount || 0), 0);
  const income = revenue - discounts;
  const incomeAccount = getPrimaryAccount("income");
  const discountAccount = findAccountByGroupAndName("income", /diskon/i);
  const cogsAccount = getPrimaryAccount("cogs");
  const expenseAccount = getPrimaryAccount("expense");
  const purchaseItems = purchases.flatMap((purchase) => (purchase.items || []).map((item) => ({ ...item, purchase })));
  const cogsGroups = groupAmounts(
    purchaseItems
      .map((item) => ({
        ...item,
        material: materialMap.get(item.material_id),
        amount: Number(item.subtotal || 0)
      }))
      .filter((item) => (item.material?.type || "hpp") !== "biaya")
      .map((item) => {
        const category = materialCategoryMap.get(item.material?.category_id);
        const fallbackAccountCode = category?.account_code || item.material?.account_code || null;
        const account = findAccountForMaterial(item.material, "cogs", cogsAccount?.code, cogsAccount?.name);
        return {
          ...item,
          account_code: account?.code || fallbackAccountCode,
          account,
          amount: Number(item.subtotal || 0)
        };
      }),
    (item) => item.account_code || `unmapped_cogs_${item.material_id || item.id}`,
    (item) => accountDescription(item.account, "Harga Pokok Penjualan", item.account_code)
  );
  const operationalPurchaseGroups = groupAmounts(
    purchaseItems
      .map((item) => ({
        ...item,
        material: materialMap.get(item.material_id),
        amount: Number(item.subtotal || 0)
      }))
      .filter((item) => item.material?.type === "biaya")
      .map((item) => {
        const category = materialCategoryMap.get(item.material?.category_id);
        const fallbackAccountCode = category?.account_code || item.material?.account_code || null;
        const account = findAccountForMaterial(item.material, "expense", expenseAccount?.code, expenseAccount?.name);
        return {
          ...item,
          account_code: account?.code || fallbackAccountCode,
          account,
          amount: Number(item.subtotal || 0)
        };
      }),
    (item) => `purchase_${item.account_code || `unmapped_expense_${item.material_id || item.id}`}`,
    (item) => `${accountDescription(item.account, "Biaya Produksi", item.account_code)} - Pembelian Produk Biaya Produksi`
  );
  const expenseGroups = groupAmounts(
    expenses.map((expense) => {
      const category = data.expense_categories.find((item) => item.name.toLowerCase() === String(expense.category || "").toLowerCase());
      const account = getFinancialAccountByCode(category?.account_code);
      return {
        ...expense,
        amount: Number(expense.amount || 0),
        account_code: account?.code || category?.account_code || null,
        account,
        description: accountDescription(account, expense.category || category?.name || "Biaya Operasional", category?.account_code)
      };
    }),
    (expense) => `expense_${expense.account_code || `unmapped_${expense.category || expense.id}`}`,
    (expense) => expense.description
  );
  const otherIncomeGroups = groupAmounts(
    sumFinanceEntries(["other_income"], { outletId, from, to }),
    (entry) => `other_income_${entry.account_code || entry.id}`,
    (entry) => accountDescription(entry.account || getFinancialAccountByCode(entry.account_code), entry.name, entry.account_code)
  );
  const otherExpenseGroups = groupAmounts(
    sumFinanceEntries(["other_expense"], { outletId, from, to }),
    (entry) => `other_expense_${entry.account_code || entry.id}`,
    (entry) => accountDescription(entry.account || getFinancialAccountByCode(entry.account_code), entry.name, entry.account_code)
  );
  const cogsTotal = cogsGroups.reduce((total, item) => total + Number(item.total || 0), 0);
  const expenseTotal = expenseGroups.reduce((total, item) => total + Number(item.total || 0), 0) + operationalPurchaseGroups.reduce((total, item) => total + Number(item.total || 0), 0);
  const otherIncomeTotal = otherIncomeGroups.reduce((total, item) => total + Number(item.total || 0), 0);
  const otherExpenseTotal = otherExpenseGroups.reduce((total, item) => total + Number(item.total || 0), 0);
  const grossProfit = income - cogsTotal;
  const netOperatingIncome = grossProfit - expenseTotal;
  const netOtherIncome = otherIncomeTotal - otherExpenseTotal;
  const netIncome = netOperatingIncome + netOtherIncome;

  return {
    title: "Laba & Rugi",
    from,
    to,
    columns: ["Description", "Total", "% of Income"],
    rows: [
      reportRow("Income", 0, income, { kind: "section" }),
      reportRow(accountDescription(incomeAccount, "Pendapatan Usaha"), revenue, income, { level: 1, account_code: incomeAccount?.code }),
      reportRow(accountDescription(discountAccount, "Diskon Penjualan"), -discounts, income, { level: 1, account_code: discountAccount?.code }),
      reportRow("Total Income", income, income, { kind: "total", bold: true }),
      reportRow("Cost of Goods Sold", 0, income, { kind: "section" }),
      ...cogsGroups.map((item) =>
        reportRow(item.description, item.total, income, {
          level: 1,
          account_code: item.account_code
        })
      ),
      reportRow("Total Cost of Goods Sold", cogsTotal, income, {
        kind: "total",
        bold: true
      }),
      reportRow("GROSS PROFIT", grossProfit, income, {
        kind: "total",
        bold: true
      }),
      reportRow("Expense", 0, income, { kind: "section" }),
      ...expenseGroups.map((item) =>
        reportRow(item.description, item.total, income, {
          level: 1,
          account_code: item.account_code
        })
      ),
      ...operationalPurchaseGroups.map((item) =>
        reportRow(item.description, item.total, income, {
          level: 1,
          account_code: item.account_code
        })
      ),
      reportRow("Total Expense", expenseTotal, income, {
        kind: "total",
        bold: true
      }),
      reportRow("NET OPERATING INCOME", netOperatingIncome, income, {
        kind: "total",
        bold: true
      }),
      reportRow("Other Income", 0, income, { kind: "section" }),
      ...otherIncomeGroups.map((item) =>
        reportRow(item.description, item.total, income, {
          level: 1,
          account_code: item.account_code
        })
      ),
      reportRow("Total Other Income", otherIncomeTotal, income, {
        kind: "total",
        bold: true
      }),
      reportRow("Other Expense", 0, income, { kind: "section" }),
      ...otherExpenseGroups.map((item) =>
        reportRow(item.description, item.total, income, {
          level: 1,
          account_code: item.account_code
        })
      ),
      reportRow("Total Other Expense", otherExpenseTotal, income, {
        kind: "total",
        bold: true
      }),
      reportRow("NET OTHER INCOME", netOtherIncome, income, {
        kind: "total",
        bold: true
      }),
      reportRow("NET INCOME", netIncome, income, {
        kind: "grand_total",
        bold: true
      })
    ],
    summary: {
      revenue,
      discounts,
      cogs_total: cogsTotal,
      expense_total: expenseTotal,
      other_income_total: otherIncomeTotal,
      other_expense_total: otherExpenseTotal,
      gross_profit: grossProfit,
      net_income: netIncome
    }
  };
}

function buildBalanceSheetReport({ outletId, netIncome, purchases = [], date }) {
  const stocks = getStockRows(outletId);
  const cashAccount = getPrimaryAccount("cash_bank");
  const inventoryAccount = getPrimaryAccount("inventory");
  const liabilityAccount = getPrimaryAccount("liability");
  const inventory = stocks.reduce((total, stock) => total + Number(stock.stock_value || 0), 0);
  const transactionsToDate = getTransactionRows({
    outletId,
    from: "1900-01-01",
    to: date
  });
  const cashGroups = groupAmounts(
    transactionsToDate.map((transaction) => {
      const paymentCode = transaction.payment?.method || "cash";
      const paymentMethod = getPaymentMethodByCode(paymentCode) || {};
      const account = getFinancialAccountByCode(paymentMethod.account_code) || cashAccount;
      return {
        amount: Number(transaction.total || 0),
        account_code: account?.code || paymentMethod.account_code || null,
        account
      };
    }),
    (item) => item.account_code || `unmapped_cash_${item.paymentCode || "unknown"}`,
    (item) => accountDescription(item.account, "Kas / Bank", item.account_code)
  );
  const otherCurrentAssetGroups = groupAmounts(
    sumFinanceEntries(["other_current_asset", "reserve_fund"], {
      outletId,
      to: date
    }),
    (entry) => `current_asset_${entry.account_code || entry.id}`,
    (entry) => accountDescription(entry.account || getFinancialAccountByCode(entry.account_code), entry.name, entry.account_code)
  );
  const fixedAssetGroups = groupAmounts(
    sumFinanceEntries(["fixed_asset"], { outletId, to: date }),
    (entry) => `fixed_asset_${entry.account_code || entry.id}`,
    (entry) => accountDescription(entry.account || getFinancialAccountByCode(entry.account_code), entry.name, entry.account_code)
  );
  const movingAssetGroups = groupAmounts(
    sumFinanceEntries(["moving_asset"], { outletId, to: date }),
    (entry) => `moving_asset_${entry.account_code || entry.id}`,
    (entry) => accountDescription(entry.account || getFinancialAccountByCode(entry.account_code), entry.name, entry.account_code)
  );
  const liabilityEntryGroups = groupAmounts(
    sumFinanceEntries(["liability"], { outletId, to: date }),
    (entry) => `liability_${entry.account_code || entry.id}`,
    (entry) => accountDescription(entry.account || getFinancialAccountByCode(entry.account_code), entry.name, entry.account_code)
  );
  const bonTotal = purchases.filter((purchase) => purchase.status === "approved" && purchase.payment_type === "bon" && dateOnly(purchase.purchase_date) <= date).reduce((total, purchase) => total + Number(purchase.total || 0), 0);
  const bonGroups = bonTotal
    ? [
        {
          description: accountDescription(liabilityAccount, "Hutang / Bon Pembelian"),
          account_code: liabilityAccount?.code,
          total: bonTotal
        }
      ]
    : [];
  const liabilityGroups = groupAmounts(
    [...liabilityEntryGroups, ...bonGroups].map((item) => ({
      ...item,
      amount: Number(item.total || 0)
    })),
    (item) => `liability_${item.account_code || item.key || item.description}`,
    (item) => item.description
  );
  const equityGroups = groupAmounts(
    sumFinanceEntries(["equity"], { outletId, to: date }),
    (entry) => `equity_${entry.account_code || entry.id}`,
    (entry) => accountDescription(entry.account || getFinancialAccountByCode(entry.account_code), entry.name, entry.account_code)
  );
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
    date,
    columns: ["Description", "Total"],
    rows: [
      reportRow("ASSET", 0, totalAsset, { kind: "section" }),
      reportRow("Cash and Bank", 0, totalAsset, { level: 1, kind: "section" }),
      ...cashGroups.map((item) =>
        reportRow(item.description, item.total, totalAsset, {
          level: 2,
          account_code: item.account_code
        })
      ),
      reportRow("Total Cash and Bank", cashTotal, totalAsset, {
        level: 1,
        kind: "total",
        bold: true
      }),
      reportRow("Inventory", 0, totalAsset, { level: 1, kind: "section" }),
      reportRow(accountDescription(inventoryAccount, "Persediaan"), inventory, totalAsset, { level: 2, account_code: inventoryAccount?.code }),
      reportRow("Total Inventory", inventory, totalAsset, {
        level: 1,
        kind: "total",
        bold: true
      }),
      reportRow("Other Current Asset", 0, totalAsset, {
        level: 1,
        kind: "section"
      }),
      ...otherCurrentAssetGroups.map((item) =>
        reportRow(item.description, item.total, totalAsset, {
          level: 2,
          account_code: item.account_code
        })
      ),
      reportRow("Total Other Current Asset", otherCurrentAssetTotal, totalAsset, { level: 1, kind: "total", bold: true }),
      reportRow("Fixed Asset", 0, totalAsset, { level: 1, kind: "section" }),
      ...fixedAssetGroups.map((item) =>
        reportRow(item.description, item.total, totalAsset, {
          level: 2,
          account_code: item.account_code
        })
      ),
      reportRow("Total Fixed Asset", fixedAssetTotal, totalAsset, {
        level: 1,
        kind: "total",
        bold: true
      }),
      reportRow("Moving Asset", 0, totalAsset, { level: 1, kind: "section" }),
      ...movingAssetGroups.map((item) =>
        reportRow(item.description, item.total, totalAsset, {
          level: 2,
          account_code: item.account_code
        })
      ),
      reportRow("Total Moving Asset", movingAssetTotal, totalAsset, {
        level: 1,
        kind: "total",
        bold: true
      }),
      reportRow("TOTAL ASSET", totalAsset, totalAsset, {
        kind: "grand_total",
        bold: true
      }),
      reportRow("LIABILITIES AND EQUITY", 0, totalAsset, { kind: "section" }),
      reportRow("LIABILITY", 0, totalAsset, { level: 1, kind: "section" }),
      ...liabilityGroups.map((item) =>
        reportRow(item.description, item.total, totalAsset, {
          level: 2,
          account_code: item.account_code
        })
      ),
      reportRow("Total Liability", totalLiability, totalAsset, {
        level: 1,
        kind: "total",
        bold: true
      }),
      reportRow("EQUITY", equity, totalAsset, { level: 1, kind: "section" }),
      ...equityGroups.map((item) =>
        reportRow(item.description, item.total, totalAsset, {
          level: 2,
          account_code: item.account_code
        })
      ),
      reportRow("Net Income", netIncome, totalAsset, { level: 2 }),
      ...(Math.round(balanceDifference) !== 0
        ? [
            reportRow("Selisih belum seimbang", balanceDifference, totalAsset, {
              level: 2,
              kind: "warning"
            })
          ]
        : []),
      reportRow("Total Equity", equity, totalAsset, {
        level: 1,
        kind: "total",
        bold: true
      }),
      reportRow("TOTAL LIABILITIES AND EQUITY", liabilitiesAndEquity, totalAsset, { kind: "grand_total", bold: true })
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

function accountDetailRow({ amount, date, description, outlet, reference, sourceType, status = "active" }) {
  const signedAmount = Math.round(Number(amount || 0));
  return {
    id: `${sourceType}_${reference || date}_${Math.random().toString(36).slice(2, 8)}`,
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

function buildAccountDetailResponse({ accountCode, from, outletId, report, rows, to }) {
  const account = getFinancialAccountByCode(accountCode) || {
    code: accountCode,
    name: "Akun belum terdaftar",
    report_group: null
  };
  const sortedRows = [...rows].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.reference || "").localeCompare(String(b.reference || "")));
  const summaryMap = new Map();
  sortedRows.forEach((row) => {
    const existing = summaryMap.get(row.source_type) || {
      source_type: row.source_type,
      source_label: row.source_label,
      count: 0,
      total: 0
    };
    existing.count += 1;
    existing.total += Number(row.signed_amount || 0);
    summaryMap.set(row.source_type, existing);
  });

  return {
    report,
    account,
    account_code: accountCode,
    from,
    to,
    outlet_id: outletId,
    total: sortedRows.reduce((total, row) => total + Number(row.signed_amount || 0), 0),
    summary: [...summaryMap.values()],
    rows: sortedRows
  };
}

function getMockProfitLossAccountDetail({ accountCode, from, outletId, to }) {
  const rows = [];
  const incomeAccount = getPrimaryAccount("income");
  const discountAccount = findAccountByGroupAndName("income", /diskon/i);
  const cogsAccount = getPrimaryAccount("cogs");
  const expenseAccount = getPrimaryAccount("expense");
  const transactions = getTransactionRows({ outletId, from, to }).filter((transaction) => transaction.status === "paid");
  const purchases = getPurchaseRows(outletId)
    .filter((purchase) => purchase.status === "approved")
    .filter((purchase) => withinDateRange(purchase.purchase_date, from, to));
  const expenses = getExpenseRows(outletId)
    .filter((expense) => withinDateRange(expense.expense_date, from, to))
    .filter(isApprovedExpense);

  if (incomeAccount?.code && String(accountCode) === String(incomeAccount.code)) {
    transactions.forEach((transaction) => {
      rows.push(
        accountDetailRow({
          amount: Number(transaction.total || 0) + Number(transaction.discount || 0),
          date: transaction.transaction_date,
          description: `Penjualan ${transaction.order_number}`,
          outlet: transaction.outlet || outletMap.get(transaction.outlet_id),
          reference: transaction.order_number,
          sourceType: "sales",
          status: transaction.status
        })
      );
    });
  }

  if (discountAccount?.code && String(accountCode) === String(discountAccount.code)) {
    transactions
      .filter((transaction) => Number(transaction.discount || 0) > 0)
      .forEach((transaction) => {
        rows.push(
          accountDetailRow({
            amount: -Number(transaction.discount || 0),
            date: transaction.transaction_date,
            description: `Diskon ${transaction.order_number}`,
            outlet: transaction.outlet || outletMap.get(transaction.outlet_id),
            reference: transaction.order_number,
            sourceType: "discount",
            status: transaction.status
          })
        );
      });
  }

  purchases.forEach((purchase) => {
    (purchase.items || []).forEach((item) => {
      const material = item.material || materialMap.get(item.material_id);
      const isBiaya = material?.type === "biaya";
      const account = findAccountForMaterial(material, isBiaya ? "expense" : "cogs", isBiaya ? expenseAccount?.code : cogsAccount?.code);
      if (!account?.code || String(account.code) !== String(accountCode)) return;
      rows.push(
        accountDetailRow({
          amount: Number(item.subtotal || 0),
          date: purchase.purchase_date,
          description: `${isBiaya ? "Pembelian Biaya Produksi" : "Pembelian HPP"} - ${material?.name || item.material_id}`,
          outlet: purchase.outlet || outletMap.get(purchase.outlet_id),
          reference: purchase.batch_id || purchase.id,
          sourceType: isBiaya ? "purchase_biaya" : "purchase_hpp",
          status: purchase.status
        })
      );
    });
  });

  expenses.forEach((expense) => {
    const category = data.expense_categories.find((item) => item.name.toLowerCase() === String(expense.category || "").toLowerCase());
    const account = getFinancialAccountByCode(category?.account_code);
    if (!account?.code || String(account.code) !== String(accountCode)) return;
    rows.push(
      accountDetailRow({
        amount: Number(expense.amount || 0),
        date: expense.expense_date,
        description: expense.description || expense.category || "Pengeluaran",
        outlet: expense.outlet || outletMap.get(expense.outlet_id),
        reference: expense.id,
        sourceType: "expense",
        status: expense.status || "active"
      })
    );
  });

  sumFinanceEntries(["other_income", "other_expense"], {
    outletId,
    from,
    to
  }).forEach((entry) => {
    if (String(entry.account_code) !== String(accountCode)) return;
    rows.push(
      accountDetailRow({
        amount: Number(entry.signed_amount ?? entry.amount ?? 0),
        date: entry.entry_date,
        description: entry.note || entry.name || "Entry Keuangan",
        outlet: entry.outlet || outletMap.get(entry.outlet_id),
        reference: entry.id,
        sourceType: "finance_entry",
        status: entry.status
      })
    );
  });

  return rows;
}

function getMockBalanceSheetAccountDetail({ accountCode, outletId, to }) {
  const rows = [];
  const cashAccount = getPrimaryAccount("cash_bank");
  const inventoryAccount = getPrimaryAccount("inventory");
  const liabilityAccount = getPrimaryAccount("liability");
  const transactions = getTransactionRows({
    outletId,
    from: "1900-01-01",
    to
  }).filter((transaction) => transaction.status === "paid");
  const purchasesToDate = getPurchaseRows(outletId)
    .filter((purchase) => purchase.status === "approved")
    .filter((purchase) => dateOnly(purchase.purchase_date) <= to);

  transactions.forEach((transaction) => {
    const paymentCode = transaction.payment?.method || "cash";
    const paymentMethod = getPaymentMethodByCode(paymentCode) || {};
    const account = getFinancialAccountByCode(paymentMethod.account_code) || cashAccount;
    if (!account?.code || String(account.code) !== String(accountCode)) return;
    rows.push(
      accountDetailRow({
        amount: Number(transaction.total || 0),
        date: transaction.transaction_date,
        description: `Payment ${paymentMethod.name || paymentCode} - ${transaction.order_number}`,
        outlet: transaction.outlet || outletMap.get(transaction.outlet_id),
        reference: transaction.order_number,
        sourceType: "payment",
        status: transaction.status
      })
    );
  });

  if (inventoryAccount?.code && String(inventoryAccount.code) === String(accountCode)) {
    getStockRows(outletId).forEach((stock) => {
      rows.push(
        accountDetailRow({
          amount: Number(stock.stock_value || 0),
          date: to,
          description: `${stock.material?.name || stock.material_id} - ${stock.quantity} ${stock.unit || stock.material?.unit || ""}`,
          outlet: stock.outlet || outletMap.get(stock.outlet_id),
          reference: stock.id,
          sourceType: "inventory",
          status: stock.status
        })
      );
    });
  }

  sumFinanceEntries(["other_current_asset", "reserve_fund", "fixed_asset", "moving_asset", "liability", "equity"], { outletId, to }).forEach((entry) => {
    if (String(entry.account_code) !== String(accountCode)) return;
    rows.push(
      accountDetailRow({
        amount: Number(entry.signed_amount ?? entry.amount ?? 0),
        date: entry.entry_date,
        description: entry.note || entry.name || "Entry Keuangan",
        outlet: entry.outlet || outletMap.get(entry.outlet_id),
        reference: entry.id,
        sourceType: "finance_entry",
        status: entry.status
      })
    );
  });

  if (liabilityAccount?.code && String(liabilityAccount.code) === String(accountCode)) {
    purchasesToDate
      .filter((purchase) => purchase.payment_type === "bon")
      .forEach((purchase) => {
        rows.push(
          accountDetailRow({
            amount: Number(purchase.total || purchase.grand_total || 0),
            date: purchase.purchase_date,
            description: `Bon pembelian ${purchase.supplier?.name || "tanpa supplier"}`,
            outlet: purchase.outlet || outletMap.get(purchase.outlet_id),
            reference: purchase.batch_id || purchase.id,
            sourceType: "purchase_bon",
            status: purchase.status
          })
        );
      });
  }

  return rows;
}

function getReportAccountDetail({ report = "profit_loss", accountCode, outletId = "all", from, to } = {}) {
  const defaultRange = getDefaultReportRange();
  const dateFrom = from || defaultRange.from;
  const dateTo = to || defaultRange.to;
  if (!accountCode) {
    throw new Error("Kode akun wajib dikirim.");
  }

  const rows =
    report === "balance_sheet"
      ? getMockBalanceSheetAccountDetail({ accountCode, outletId, to: dateTo })
      : getMockProfitLossAccountDetail({
          accountCode,
          from: dateFrom,
          outletId,
          to: dateTo
        });

  return clone(
    buildAccountDetailResponse({
      accountCode,
      from: report === "balance_sheet" ? null : dateFrom,
      outletId,
      report,
      rows,
      to: dateTo
    })
  );
}

function normalizeCashierPin(payload, { required = false } = {}) {
  const hasPin = Object.prototype.hasOwnProperty.call(payload, "cashier_pin") || Object.prototype.hasOwnProperty.call(payload, "cashierPin") || Object.prototype.hasOwnProperty.call(payload, "pin");
  const pin = String(payload.cashier_pin ?? payload.cashierPin ?? payload.pin ?? "").trim();

  if (!pin) {
    if (required) throw new Error("PIN kasir wajib diisi 6 digit.");
    return null;
  }

  if (!/^\d{6}$/.test(pin)) {
    throw new Error("PIN kasir wajib 6 digit angka.");
  }

  return hasPin ? pin : null;
}

function normalizeUserPayload(payload, { isCreate = false, requirePin = false } = {}) {
  const name = String(payload.name || "").trim();
  const rawUsername = String(payload.username || "");
  const username = rawUsername.trim().toLowerCase();
  const email = String(payload.email || "")
    .trim()
    .toLowerCase();
  const roleId = payload.role_id;
  const requestedOutletIds = Array.isArray(payload.outlet_ids) ? payload.outlet_ids : [];
  const outletIds = requestedOutletIds.filter((id) => outletMap.has(id));
  const status = payload.status || "active";

  if (!name || !username || !email || !roleMap.has(roleId) || !outletIds.length) {
    throw new Error("Nama, username, email, role, dan minimal 1 outlet wajib diisi.");
  }

  if (!email.includes("@")) {
    throw new Error("Format email tidak valid.");
  }

  if (/\s/.test(rawUsername)) {
    throw new Error("Username tidak boleh memakai spasi.");
  }

  if (!/^[a-z0-9._-]+$/.test(username)) {
    throw new Error("Username hanya boleh huruf, angka, titik, underscore, atau strip.");
  }

  if (outletIds.length !== requestedOutletIds.length) {
    throw new Error("Outlet akses user tidak valid.");
  }

  if (!["active", "inactive"].includes(status)) {
    throw new Error("Status user tidak valid.");
  }

  const apkEnabled = hasApkAccess(roleMap.get(roleId));
  const cashierPin = apkEnabled ? normalizeCashierPin(payload, { required: isCreate || requirePin }) : null;

  const normalized = {
    name,
    username,
    email,
    role_id: roleId,
    outlet_ids: [...new Set(outletIds)],
    status
  };

  if (apkEnabled && cashierPin) {
    normalized.cashier_pin = cashierPin;
  }

  return normalized;
}

function assertUniqueUser({ email, userId, username }) {
  if (data.users.some((user) => user.id !== userId && user.username.toLowerCase() === username.toLowerCase())) {
    throw new Error("Username sudah digunakan.");
  }

  if (data.users.some((user) => user.id !== userId && user.email.toLowerCase() === email.toLowerCase())) {
    throw new Error("Email sudah digunakan.");
  }
}

function normalizeProfilePayload(payload) {
  const name = String(payload.name || "").trim();
  const username = String(payload.username || "")
    .trim()
    .toLowerCase();
  const email = String(payload.email || "")
    .trim()
    .toLowerCase();

  if (!name || !username || !email) {
    throw new Error("Nama, username, dan email wajib diisi.");
  }

  if (!email.includes("@")) {
    throw new Error("Format email tidak valid.");
  }

  return { name, username, email };
}

function createTemporaryPassword() {
  return `BRK-${Math.floor(100000 + Math.random() * 900000)}`;
}

function createCustomerBarcode(outletId) {
  const outlet = outletMap.get(outletId);
  const outletCode = outlet?.code || "BRK";
  const prefix = `CUST-${outletCode}-`;
  const maxNumber = data.customers
    .filter((customer) => customer.outlet_id === outletId && customer.barcode?.startsWith(prefix))
    .reduce((max, customer) => {
      const number = Number(customer.barcode.replace(prefix, ""));
      return Number.isNaN(number) ? max : Math.max(max, number);
    }, 0);

  return `${prefix}${String(maxNumber + 1).padStart(4, "0")}`;
}

function normalizeCustomerPayload(payload, customerId) {
  const name = String(payload.name || "").trim();
  const phone = String(payload.phone || "").trim();
  const outletId = payload.outlet_id;
  const status = payload.status || "active";
  const barcode = String(payload.barcode || "")
    .trim()
    .toUpperCase();

  if (!name || !phone || !outletMap.has(outletId)) {
    throw new Error("Nama customer, nomor HP, dan outlet wajib diisi.");
  }

  if (data.customers.some((customer) => customer.id !== customerId && customer.phone === phone && customer.outlet_id === outletId)) {
    throw new Error("Nomor HP sudah terdaftar di outlet ini.");
  }

  if (barcode && data.customers.some((customer) => customer.id !== customerId && customer.barcode.toLowerCase() === barcode.toLowerCase())) {
    throw new Error("Barcode sudah digunakan customer lain.");
  }

  return {
    name,
    phone,
    outlet_id: outletId,
    status,
    barcode
  };
}

function normalizeOutletPayload(payload, outletId) {
  const name = String(payload.name || "").trim();
  const code = String(payload.code || "")
    .trim()
    .toUpperCase();
  const address = String(payload.address || "").trim();
  const phone = String(payload.phone || "").trim();
  const openedAt = String(payload.opened_at || "").trim();
  const status = payload.status || "active";

  if (!name || code.length < 2 || address.length < 5 || phone.length < 6 || !openedAt) {
    throw new Error("Nama, kode, alamat, telepon, dan tanggal buka outlet wajib diisi.");
  }

  if (Number.isNaN(new Date(`${openedAt}T00:00:00`).getTime())) {
    throw new Error("Tanggal buka outlet tidak valid.");
  }

  if (!["active", "inactive"].includes(status)) {
    throw new Error("Status outlet tidak valid.");
  }

  if (data.outlets.some((outlet) => outlet.id !== outletId && outlet.code.toLowerCase() === code.toLowerCase())) {
    throw new Error("Kode outlet sudah digunakan.");
  }

  return {
    name,
    code,
    address,
    phone,
    opened_at: openedAt,
    status
  };
}

function normalizeTablePayload(payload, tableId) {
  const outletId = payload.outlet_id;
  const number = String(payload.number || "")
    .trim()
    .toUpperCase();
  const status = payload.status || "active";

  if (!outletMap.has(outletId) || !number) {
    throw new Error("Outlet dan nomor meja wajib diisi.");
  }

  if (!["active", "inactive"].includes(status)) {
    throw new Error("Status meja tidak valid.");
  }

  if (data.tables.some((table) => table.id !== tableId && table.outlet_id === outletId && table.number.toLowerCase() === number.toLowerCase())) {
    throw new Error("Nomor meja sudah digunakan di outlet ini.");
  }

  return {
    outlet_id: outletId,
    number,
    status
  };
}

function normalizeCategoryPayload(payload, categoryId, fallbackSortOrder) {
  const name = String(payload.name || "").trim();
  const hasSortOrder = Object.prototype.hasOwnProperty.call(payload, "sort_order") && payload.sort_order !== "" && payload.sort_order !== null;
  const sortOrder = Number(hasSortOrder ? payload.sort_order : fallbackSortOrder);
  const status = payload.status || "active";

  if (!name || !Number.isFinite(sortOrder) || sortOrder <= 0) {
    throw new Error("Nama kategori dan urutan wajib valid.");
  }

  if (!["active", "inactive"].includes(status)) {
    throw new Error("Status kategori tidak valid.");
  }

  if (data.categories.some((category) => category.id !== categoryId && category.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("Nama kategori sudah digunakan.");
  }

  return {
    name,
    sort_order: sortOrder,
    status
  };
}

function normalizeExpenseCategoryPayload(payload, categoryId, fallbackSortOrder) {
  const name = String(payload.name || "").trim();
  const accountCode = String(payload.account_code || payload.accountCode || "").trim();
  const hasSortOrder = Object.prototype.hasOwnProperty.call(payload, "sort_order") && payload.sort_order !== "" && payload.sort_order !== null;
  const sortOrder = Number(hasSortOrder ? payload.sort_order : fallbackSortOrder);
  const status = payload.status || "active";

  if (!name || !Number.isFinite(sortOrder) || sortOrder <= 0) {
    throw new Error("Nama pengeluaran operasional dan urutan wajib valid.");
  }

  if (!["active", "inactive"].includes(status)) {
    throw new Error("Status nama pengeluaran operasional tidak valid.");
  }
  requireFinancialAccount(accountCode, ["expense"]);

  if (data.expense_categories.some((category) => category.id !== categoryId && category.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("Nama pengeluaran operasional sudah digunakan.");
  }

  return {
    name,
    account_code: accountCode,
    sort_order: sortOrder,
    status
  };
}

function normalizeExpenseCorrectionPayload(payload = {}) {
  const amount = Math.round(Number(payload.amount || 0));
  const correctionNote = String(payload.correction_note || payload.correctionNote || "").trim();

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Nominal koreksi wajib lebih dari 0.");
  }

  if (!correctionNote) {
    throw new Error("Catatan koreksi wajib diisi.");
  }

  return {
    amount,
    correction_note: correctionNote
  };
}

function normalizePaymentMethodCode(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getPaymentMethodByCode(code, { activeOnly = false } = {}) {
  const normalizedCode = normalizePaymentMethodCode(code || "cash");
  return (data.payment_methods || []).find((method) => method.code === normalizedCode && (!activeOnly || method.status === "active"));
}

function normalizePaymentMethodPayload(payload, methodId, fallbackSortOrder) {
  const name = String(payload.name || "").trim();
  const code = normalizePaymentMethodCode(payload.code || name);
  const accountCode = String(payload.account_code || payload.accountCode || "").trim();
  const hasSortOrder = (Object.prototype.hasOwnProperty.call(payload, "sort_order") && payload.sort_order !== "" && payload.sort_order !== null) || (Object.prototype.hasOwnProperty.call(payload, "sortOrder") && payload.sortOrder !== "" && payload.sortOrder !== null);
  const sortOrderValue = hasSortOrder ? (payload.sort_order ?? payload.sortOrder) : fallbackSortOrder;
  const sortOrder = Number(sortOrderValue);
  const status = payload.status || "active";

  if (!name || !code || !Number.isFinite(sortOrder) || sortOrder <= 0) {
    throw new Error("Nama, kode, dan urutan metode pembayaran wajib valid.");
  }

  if (!["active", "inactive"].includes(status)) {
    throw new Error("Status metode pembayaran tidak valid.");
  }
  requireFinancialAccount(accountCode, ["cash_bank"]);

  if ((data.payment_methods || []).some((method) => method.id !== methodId && method.code.toLowerCase() === code.toLowerCase())) {
    throw new Error("Kode metode pembayaran sudah digunakan.");
  }

  if ((data.payment_methods || []).some((method) => method.id !== methodId && method.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("Nama metode pembayaran sudah digunakan.");
  }

  return {
    name,
    code,
    account_code: accountCode,
    sort_order: sortOrder,
    status
  };
}

function normalizeFinancialAccountPayload(payload, accountId, fallbackSortOrder) {
  const code = String(payload.code || "").trim();
  const name = String(payload.name || "").trim();
  const reportGroup = String(payload.report_group || payload.reportGroup || "").trim();
  const normalBalance = String(payload.normal_balance || payload.normalBalance || "debit").trim();
  const hasSortOrder = (Object.prototype.hasOwnProperty.call(payload, "sort_order") && payload.sort_order !== "" && payload.sort_order !== null) || (Object.prototype.hasOwnProperty.call(payload, "sortOrder") && payload.sortOrder !== "" && payload.sortOrder !== null);
  const sortOrder = Number(hasSortOrder ? (payload.sort_order ?? payload.sortOrder) : fallbackSortOrder);
  const status = payload.status || "active";

  if (!code || !name || !financialAccountGroups.has(reportGroup) || !Number.isFinite(sortOrder) || sortOrder <= 0) {
    throw new Error("Kode, nama, group laporan, dan urutan akun wajib valid.");
  }

  if (!["debit", "credit"].includes(normalBalance)) {
    throw new Error("Normal balance akun tidak valid.");
  }

  if (!["active", "inactive"].includes(status)) {
    throw new Error("Status akun tidak valid.");
  }

  if ((data.financial_accounts || []).some((account) => account.id !== accountId && String(account.code).toLowerCase() === code.toLowerCase())) {
    throw new Error("Kode akun sudah digunakan.");
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

function normalizeFinanceEntryGroupPayload(payload, groupId) {
  const name = String(payload.name || "").trim();
  const accountCode = String(payload.account_code || payload.accountCode || "").trim();
  const account = getFinancialAccountByCode(accountCode);
  const group = getFinanceGroupFromAccount(account, payload.group);
  const outletId = payload.outlet_id && payload.outlet_id !== "all" ? String(payload.outlet_id) : null;
  const note = String(payload.note || "").trim();
  const status = payload.status || "active";

  if (!name || !accountCode || !account || !financeEntryGroups.has(group)) {
    throw new Error("Nama pos, akun laporan, dan group Pos Keuangan wajib valid.");
  }

  if (outletId && !outletMap.has(outletId)) {
    throw new Error("Outlet Pos Keuangan tidak ditemukan.");
  }

  if (!["active", "inactive"].includes(status)) {
    throw new Error("Status Pos Keuangan tidak valid.");
  }

  const key = financeEntryGroupKey({
    name,
    account_code: accountCode,
    outlet_id: outletId
  });
  const duplicate = (data.finance_entry_groups || []).some((item) => item.id !== groupId && financeEntryGroupKey(item) === key);
  if (duplicate) {
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

function findOrCreateFinanceEntryGroupForEntry(entryPayload) {
  if (entryPayload.finance_group_id) return getFinanceEntryGroupById(entryPayload.finance_group_id);
  const groupPayload = normalizeFinanceEntryGroupFromEntry(entryPayload);
  const key = financeEntryGroupKey(groupPayload);
  let group = (data.finance_entry_groups || []).find((item) => financeEntryGroupKey(item) === key);
  if (!group) {
    group = {
      id: createSequentialId("finance_group", data.finance_entry_groups || []),
      ...groupPayload,
      created_at: new Date().toISOString()
    };
    data.finance_entry_groups.push(group);
  }
  entryPayload.finance_group_id = group.id;
  return group;
}

function normalizeFinanceEntryPayload(payload, entryId) {
  const existingEntry = entryId ? data.balance_sheet_entries.find((entry) => entry.id === entryId) : null;
  const financeGroupId = String(payload.finance_group_id || payload.financeGroupId || existingEntry?.finance_group_id || "").trim();
  const financeGroup = financeGroupId ? getFinanceEntryGroupById(financeGroupId) : null;
  const requestedGroup = String(payload.group || financeGroup?.group || "").trim();
  const accountCode = String(financeGroup?.account_code || payload.account_code || payload.accountCode || (requestedGroup === "reserve_fund" ? "1431" : "")).trim();
  const account = getFinancialAccountByCode(accountCode);
  const group = getFinanceGroupFromAccount(account, requestedGroup);
  const name = String(financeGroup?.name || payload.name || "").trim();
  const amount = Math.round(Number(payload.amount || 0));
  const entryDate = dateOnly(payload.entry_date || payload.entryDate || new Date());
  const outletId = financeGroup ? financeGroup.outlet_id || null : payload.outlet_id && payload.outlet_id !== "all" ? String(payload.outlet_id) : null;
  const movementType = String(payload.movement_type || payload.movementType || existingEntry?.movement_type || "in").trim();
  const note = String(payload.note || "").trim();
  const status = payload.status || "active";

  if (financeGroupId && !financeGroup) {
    throw new Error("Pos Keuangan tidak ditemukan.");
  }

  if (!entryId && financeGroup?.status === "inactive") {
    throw new Error("Pos Keuangan inactive tidak bisa dipakai untuk transaksi baru.");
  }

  if (!name || !financeEntryGroups.has(group) || !accountCode || !account) {
    throw new Error("Nama, group, dan akun transaksi keuangan wajib valid.");
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Nominal transaksi keuangan wajib lebih dari 0.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
    throw new Error("Tanggal transaksi keuangan wajib valid.");
  }

  if (outletId && !outletMap.has(outletId)) {
    throw new Error("Outlet transaksi keuangan tidak ditemukan.");
  }

  if (!["in", "out"].includes(movementType)) {
    throw new Error("Arah saldo transaksi keuangan tidak valid.");
  }

  if (!["active", "inactive"].includes(status)) {
    throw new Error("Status transaksi keuangan tidak valid.");
  }

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

function normalizeDiscountPayload(payload, discountId) {
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

  if (!outletIds.length || outletIds.some((outletId) => !outletMap.has(outletId))) {
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

  if (
    (data.discounts || []).some((discount) => {
      if (discount.id === discountId || String(discount.name || "").toLowerCase() !== name.toLowerCase()) return false;
      const existingOutletIds = getDiscountOutletIds(discount.id);
      return outletIds.some((outletId) => existingOutletIds.includes(outletId));
    })
  ) {
    throw new Error("Nama discount sudah digunakan.");
  }

  return {
    name,
    type,
    value: type === "percent" ? Number(value) : Math.round(value),
    starts_at: startsAt,
    ends_at: endsAt,
    outlet_ids: outletIds,
    status
  };
}

function normalizeMaterialCategoryPayload(payload, categoryId, fallbackSortOrder) {
  const name = String(payload.name || "").trim();
  const type = String(payload.type || "hpp").trim();
  const hasSortOrder = Object.prototype.hasOwnProperty.call(payload, "sort_order") && payload.sort_order !== "" && payload.sort_order !== null;
  const sortOrder = Number(hasSortOrder ? payload.sort_order : fallbackSortOrder);
  const status = payload.status || "active";
  const accountCode = String(payload.account_code || (type === "biaya" ? "6000" : "5002")).trim();

  if (!name || !Number.isFinite(sortOrder) || sortOrder <= 0) {
    throw new Error("Nama kategori harga pokok produksi dan urutan wajib valid.");
  }
  if (!["hpp", "biaya"].includes(type)) {
    throw new Error("Type kategori harga pokok produksi harus hpp atau biaya.");
  }
  if (!["active", "inactive"].includes(status)) {
    throw new Error("Status kategori harga pokok produksi tidak valid.");
  }
  requireFinancialAccount(accountCode, [type === "biaya" ? "expense" : "cogs"]);
  if (data.raw_material_categories.some((category) => category.id !== categoryId && category.type === type && category.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("Nama kategori harga pokok produksi sudah digunakan untuk type ini.");
  }

  return {
    name,
    type,
    account_code: accountCode,
    sort_order: sortOrder,
    status
  };
}

function normalizePrintSettingsPayload(payload) {
  const defaultTemplateMap = new Map(data.print_templates.map((template) => [template.key, template]));
  const submittedTemplateMap = new Map((payload.templates || []).map((template) => [template.key, template]));
  const templateKeys = ["customer_order", "kitchen_order", "bill_receipt"];
  const templates = templateKeys.map((key) => {
    const current = submittedTemplateMap.get(key) || defaultTemplateMap.get(key) || {};
    return {
      key,
      label:
        current.label ||
        {
          customer_order: "Customer Order Copy",
          kitchen_order: "Kitchen Order",
          bill_receipt: "Bill / Receipt"
        }[key],
      enabled: current.enabled !== false,
      footer_text: normalizePrintFooterText(key, current.footer_text)
    };
  });

  const printerName = String(payload.printer_name || data.print_settings?.printer_name || "").trim();
  if (!printerName) {
    throw new Error("Nama printer wajib diisi.");
  }

  const printerStatus = payload.printer_status === "inactive" ? "inactive" : "active";

  return {
    settings: {
      printer_name: printerName,
      printer_status: printerStatus,
      mode: "single_printer_mock"
    },
    templates
  };
}

function normalizePrintFooterText(templateKey, value) {
  if (templateKey === "kitchen_order") return "";
  const text = String(value || "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (text.length > 300) {
    throw new Error("Footer struk maksimal 300 karakter.");
  }
  return text;
}

function getAppSecuritySettings() {
  return {
    report_pin_enabled: data.app_security?.report_pin_enabled !== false,
    has_report_pin: Boolean(data.app_security?.report_pin)
  };
}

function normalizeAppSecurityPayload(payload = {}) {
  const enabled = payload.report_pin_enabled !== false;
  const hasSubmittedPin = Object.prototype.hasOwnProperty.call(payload, "report_pin") && payload.report_pin !== undefined && payload.report_pin !== null && payload.report_pin !== "";
  const pin = hasSubmittedPin ? String(payload.report_pin).trim() : "";

  if ((enabled && !data.app_security?.report_pin && !pin) || pin) {
    if (!/^\d{6}$/.test(pin)) {
      throw new Error("PIN laporan APK wajib 6 digit angka.");
    }
  }

  return {
    report_pin_enabled: enabled,
    report_pin: pin || data.app_security?.report_pin || "000000"
  };
}

function normalizeCompositionPayload(payload, compositionId) {
  const productId = payload.product_id;
  const materialId = payload.material_id;
  const quantity = Number(payload.quantity || 0);
  const product = productMap.get(productId);
  const material = materialMap.get(materialId);

  if (!product || !material || quantity <= 0) {
    throw new Error("Produk jual, harga pokok produksi, dan qty komposisi wajib valid.");
  }

  if (data.product_compositions.some((composition) => composition.id !== compositionId && composition.product_id === productId && composition.material_id === materialId)) {
    throw new Error("Harga Pokok Produksi sudah ada di komposisi produk ini.");
  }

  return {
    product_id: productId,
    material_id: materialId,
    quantity,
    unit: payload.unit || material.unit
  };
}

function getProductSkuPrefix(category) {
  const name = String(category?.name || "")
    .trim()
    .toLowerCase();
  const knownPrefixes = {
    makanan: "MKN",
    minuman: "MNM",
    snack: "SNK",
    paket: "PKT"
  };
  if (knownPrefixes[name]) return knownPrefixes[name];

  const sanitized = String(category?.name || "Produk")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
  return (sanitized || "PRD").slice(0, 3).padEnd(3, "X");
}

function generateProductSku(categoryId) {
  const category = categoryMap.get(categoryId);
  const prefix = getProductSkuPrefix(category);
  const usedNumbers = data.products
    .map((product) => String(product.sku || "").toUpperCase())
    .map((sku) => sku.match(new RegExp(`^${prefix}-(\\d+)$`))?.[1])
    .filter(Boolean)
    .map((value) => Number(value));
  let nextNumber = (usedNumbers.length ? Math.max(...usedNumbers) : 0) + 1;
  let sku = `${prefix}-${String(nextNumber).padStart(3, "0")}`;
  const existingSkus = new Set(data.products.map((product) => String(product.sku || "").toUpperCase()));

  while (existingSkus.has(sku)) {
    nextNumber += 1;
    sku = `${prefix}-${String(nextNumber).padStart(3, "0")}`;
  }

  return sku;
}

const adminMockApi = {
  withActivityActor(actorId, action) {
    return activityContext.run({ actorId }, action);
  },

  async getMobileCatalogSnapshot() {
    await delay(180);
    return clone(getMobileCatalogSnapshot());
  },

  async login({ username, password }) {
    await delay(350);
    const user = data.users.find((item) => item.username === username);
    if (!user || !password) {
      throw new Error("Username atau password tidak valid.");
    }
    if (user.status !== "active") {
      throw new Error("User nonaktif. Hubungi Owner/Admin.");
    }
    return {
      ...clone(user),
      role: clone(roleMap.get(user.role_id)),
      outlets: user.outlet_ids.map((id) => outletMap.get(id))
    };
  },

  async getBootstrap() {
    await delay();
    return clone({
      outlets: getOutletRows(),
      tables: getTableRows("all"),
      roles: data.roles,
      users: getUserRows(),
      permissions: data.permissions,
      metadata: data.metadata
    });
  },

  async getDashboard({ outletId = "all", from = "2026-04-01", to = "2026-04-30" } = {}) {
    await delay();
    const transactions = getTransactionRows({ outletId, from, to });
    const allOutletTransactions = getTransactionRows({
      outletId: "all",
      from,
      to
    });
    const purchases = getPurchaseRows(outletId).filter((purchase) => purchase.status === "approved" && withinDateRange(purchase.purchase_date, from, to));
    const expenses = data.expenses
      .filter(outletFilter(outletId))
      .filter((expense) => withinDateRange(expense.expense_date, from, to))
      .filter(isApprovedExpense);
    const lowStocks = getStockRows(outletId).filter((stock) => stock.status !== "normal");
    const revenue = transactions.reduce((total, item) => total + item.total, 0);
    const purchaseTotal = purchases.reduce((total, item) => total + item.total, 0);
    const expenseTotal = expenses.reduce((total, item) => total + item.amount, 0);

    return clone({
      metrics: {
        revenue,
        transactions: transactions.length,
        purchases: purchaseTotal,
        expenses: expenseTotal,
        gross_profit_estimate: getGrossProfitEstimate(transactions),
        low_stock_count: lowStocks.length
      },
      daily_sales: getDailySales(transactions),
      top_products: getTopProducts(transactions),
      sales_by_category: getSalesByCategory(transactions),
      recent_transactions: transactions.slice(0, 8),
      low_stocks: lowStocks.slice(0, 8),
      sales_by_outlet: buildDashboardSalesByOutlet({
        outlets: data.outlets,
        transactions: allOutletTransactions
      }),
      material_price_comparisons: getMaterialPriceComparisons({
        outletId,
        from,
        to
      })
    });
  },

  async getDashboardMaterialPurchaseComparisons(filters = {}) {
    await delay();
    return clone(getMaterialPurchaseComparisons(filters));
  },

  async getMasterData({ outletId = "all", keyword = "" } = {}) {
    await delay();
    const users = getUserRows();
    const customers = getCustomerRows(outletId, keyword);

    return clone({
      users,
      outlets: getOutletRows(),
      roles: data.roles,
      categories: getCategoryRows(),
      expense_categories: getExpenseCategoryRows(keyword),
      raw_material_categories: getMaterialCategoryRows(keyword),
      payment_methods: getPaymentMethodRows(keyword),
      financial_accounts: getFinancialAccountRows(keyword),
      finance_entry_groups: getFinanceEntryGroupRows({ outletId, keyword }),
      finance_entries: getFinanceEntryRows({ outletId, keyword }),
      reserve_funds: getReserveFundRows({ outletId, keyword }),
      reserve_fund_summary: getReserveFundSummary({ outletId }),
      discounts: getDiscountRows(keyword),
      activity_logs: getActivityLogRows({ keyword }).slice(0, 200),
      materials: getMaterialRows(outletId),
      compositions: getCompositionRows(),
      units: getUnitRows(),
      suppliers: getSupplierRows(),
      tables: getTableRows(outletId, keyword),
      customers,
      products: getProductRows(outletId).filter((product) => includesText(`${product.name} ${product.sku} ${product.category?.name}`, keyword))
    });
  },

  async getInventory({ outletId = "all" } = {}) {
    await delay();
    return clone({
      stocks: getStockRows(outletId),
      all_stocks: getStockRows("all"),
      purchases: getPurchaseRows(outletId),
      transfers: getTransferRows(outletId),
      opnames: getOpnameRows(outletId),
      opname_requests: getOpnameRequestRows({ outletId }),
      stock_movements: getStockMovementRows(outletId),
      materials: data.raw_materials,
      suppliers: getSupplierRows(),
      outlets: getOutletRows()
    });
  },

  async getStockOpnameWorksheet({ outletId, date } = {}) {
    await delay();
    const outlet = outletMap.get(outletId);

    if (!outletId || outletId === "all" || !outlet) {
      return clone({
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
      });
    }

    const rows = getStockOpnameWorksheetRows({ outletId, date });
    const totalMissingQuantity = rows.reduce((total, row) => total + Math.max(Number(row.difference || 0), 0), 0);

    return clone({
      outlet,
      date,
      rows,
      summary: {
        total_items: rows.length,
        match_items: rows.filter((row) => Math.abs(Number(row.difference || 0)) < 0.001).length,
        missing_items: rows.filter((row) => Number(row.difference || 0) > 0).length,
        total_missing_quantity: roundQuantity(totalMissingQuantity),
        total_loss_amount: rows.reduce((total, row) => total + Number(row.loss_amount || 0), 0)
      }
    });
  },

  async getPosStockOpnameWorksheet({ outletId, date } = {}) {
    await delay();
    const outlet = outletMap.get(outletId);
    const rows = outlet ? getStockOpnameWorksheetRows({ outletId, date, selectedOnly: true }) : [];
    const totalMissingQuantity = rows.reduce((total, row) => total + Math.max(Number(row.difference || 0), 0), 0);
    return clone({
      outlet: outlet || null,
      date,
      rows,
      summary: {
        total_items: rows.length,
        match_items: rows.filter((row) => Math.abs(Number(row.difference || 0)) < 0.001).length,
        missing_items: rows.filter((row) => Number(row.difference || 0) > 0).length,
        total_missing_quantity: roundQuantity(totalMissingQuantity),
        total_loss_amount: rows.reduce((total, row) => total + Number(row.loss_amount || 0), 0)
      }
    });
  },

  async getStockOpnameMaterialSelection({ outletId, outlet_id: outletIdSnake } = {}) {
    await delay(120);
    const resolvedOutletId = outletId || outletIdSnake;
    const outlet = outletMap.get(resolvedOutletId);
    if (!outlet) throw new Error("Outlet wajib valid.");
    const selectedIds = getSelectedOpnameMaterialIds(resolvedOutletId);
    const items = data.raw_materials
      .filter((material) => material.status !== "inactive")
      .map((material) => ({
        material_id: material.id,
        name: material.name,
        type: material.type || "hpp",
        unit: material.unit,
        selected: selectedIds.has(material.id)
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return clone({
      outlet_id: resolvedOutletId,
      outlet,
      selected_material_ids: items.filter((item) => item.selected).map((item) => item.material_id),
      items
    });
  },

  async updateStockOpnameMaterialSelection(payload = {}, actorUserId = null) {
    await delay(220);
    const outletId = payload.outlet_id || payload.outletId;
    const outlet = outletMap.get(outletId);
    if (!outlet) throw new Error("Outlet wajib valid.");
    const requestedMaterialIds = payload.material_ids ?? payload.materialIds ?? [];
    if (!Array.isArray(requestedMaterialIds)) throw new Error("Daftar item stock opname wajib berupa array.");
    const materialIds = [...new Set(requestedMaterialIds.map((id) => String(id).trim()).filter(Boolean))];
    if (materialIds.some((id) => !materialMap.has(id) || materialMap.get(id).status === "inactive")) {
      throw new Error("Pilihan item stock opname mengandung Harga Pokok Produksi yang tidak aktif atau tidak valid.");
    }
    data.stock_opname_material_selections = [
      ...(data.stock_opname_material_selections || []).filter((row) => row.outlet_id !== outletId),
      ...materialIds.map((materialId) => ({
        outlet_id: outletId,
        material_id: materialId,
        selected_by: actorUserId,
        updated_at: new Date().toISOString()
      }))
    ];
    createActivityLog({
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
    return this.getStockOpnameMaterialSelection({ outletId });
  },

  async getStockOpnameRequests(filters = {}) {
    await delay(180);
    return clone(getOpnameRequestRows(filters));
  },

  async getReports({ outletId = "all", from, to } = {}) {
    await delay();
    const defaultRange = getDefaultReportRange();
    const dateFrom = from || defaultRange.from;
    const dateTo = to || defaultRange.to;
    const transactions = getTransactionRows({
      outletId,
      from: dateFrom,
      to: dateTo
    });
    const paidTransactions = transactions.filter((transaction) => transaction.status === "paid");
    const purchases = getPurchaseRows(outletId).filter((purchase) => withinDateRange(purchase.purchase_date, dateFrom, dateTo));
    const balancePurchases = getPurchaseRows(outletId).filter((purchase) => withinDateRange(purchase.purchase_date, "1900-01-01", dateTo));
    const approvedPurchases = purchases.filter((purchase) => purchase.status === "approved");
    const expenses = getExpenseRows(outletId).filter((expense) => withinDateRange(expense.expense_date, dateFrom, dateTo));
    const approvedExpenses = expenses.filter(isApprovedExpense);
    const revenue = paidTransactions.reduce((total, item) => total + item.total, 0);
    const purchaseTotal = approvedPurchases.reduce((total, item) => total + item.total, 0);
    const expenseTotal = approvedExpenses.reduce((total, item) => total + item.amount, 0);
    const payment_breakdown = paidTransactions.reduce((result, transaction) => {
      const method = transaction.payment?.method || "unknown";
      result[method] = (result[method] || 0) + transaction.total;
      return result;
    }, {});
    const accountingProfitLoss = buildProfitLossReport({
      outletId,
      transactions: paidTransactions,
      purchases: approvedPurchases,
      expenses: approvedExpenses,
      from: dateFrom,
      to: dateTo
    });
    const accountingBalanceSheet = buildBalanceSheetReport({
      outletId,
      netIncome: accountingProfitLoss.summary.net_income,
      purchases: balancePurchases,
      date: dateTo
    });

    return clone({
      transactions,
      outlets: getOutletRows(),
      sales_by_day: getDailySales(paidTransactions, dateFrom, dateTo),
      sales_by_product: getTopProducts(paidTransactions),
      sales_by_outlet: getSalesByOutlet(paidTransactions, outletId),
      sales_by_customer: getSalesByCustomer(paidTransactions),
      sales_by_hour: getSalesByHour(paidTransactions),
      sales_by_service_type: getSalesByServiceType(paidTransactions),
      payment_methods: getPaymentMethodRows(),
      purchases_by_day: getTotalsByDay(approvedPurchases, "purchase_date", "total", dateFrom, dateTo),
      expenses_by_day: getTotalsByDay(approvedExpenses, "expense_date", "amount", dateFrom, dateTo),
      purchases,
      expenses,
      profit_loss: {
        revenue,
        cogs_estimate: accountingProfitLoss.summary.cogs_total,
        gross_profit: accountingProfitLoss.summary.gross_profit,
        expenses: accountingProfitLoss.summary.expense_total,
        net_profit: accountingProfitLoss.summary.net_income,
        payment_breakdown
      },
      balance_sheet: {
        assets: accountingBalanceSheet.summary.assets,
        liabilities: accountingBalanceSheet.summary.liabilities,
        equity: accountingBalanceSheet.summary.equity
      },
      accounting_profit_loss: accountingProfitLoss,
      accounting_balance_sheet: accountingBalanceSheet,
      activity_logs: getActivityLogRows({
        from: dateFrom,
        to: dateTo,
        outletId
      }).slice(0, 500)
    });
  },

  async getReportAccountDetail(filters = {}) {
    await delay(180);
    return getReportAccountDetail(filters);
  },

  async getSalesOutletComparison({ from, to, outletIds = "" } = {}) {
    await delay();
    const outletIdsList = parsePosQueryList(outletIds);
    const outletOptions = getOutletRows().filter((outlet) => outlet.status !== "inactive");
    const selectedOutlets = outletIdsList.length ? outletOptions.filter((outlet) => outletIdsList.includes(outlet.id)) : outletOptions;
    const allowedOutletIds = new Set(selectedOutlets.map((outlet) => outlet.id));
    const defaultRange = getDefaultReportRange();
    const dateFrom = from || defaultRange.from;
    const dateTo = to || defaultRange.to;
    const transactions = getTransactionRows({
      outletId: "all",
      from: dateFrom,
      to: dateTo
    })
      .filter((transaction) => transaction.status === "paid")
      .filter((transaction) => allowedOutletIds.has(transaction.outlet_id));

    return clone(
      buildSalesOutletComparison({
        transactions,
        outlets: selectedOutlets,
        outletOptions,
        from: dateFrom,
        to: dateTo
      })
    );
  },

  async getSettings() {
    await delay();
    return clone({
      roles: data.roles,
      permissions: data.permissions,
      categories: getCategoryRows(),
      print_settings: getPrintSettings(),
      app_security: getAppSecuritySettings()
    });
  },

  async updatePrintSettings(payload) {
    await delay(360);
    const next = normalizePrintSettingsPayload(payload);
    data.print_settings = next.settings;
    data.print_templates = next.templates;
    logEntityActivity("print/update", {
      module: "settings",
      entityType: "print_settings",
      entityId: "print",
      description: "Admin update pengaturan print.",
      metadata: {
        printer_name: data.print_settings.printer_name,
        printer_status: data.print_settings.printer_status,
        template_count: data.print_templates.length
      }
    });
    rebuildIndexes();
    return clone(getPrintSettings());
  },

  async updateAppSecuritySettings(payload) {
    await delay(280);
    data.app_security = normalizeAppSecurityPayload(payload);
    createActivityLog({
      actor_user_id: payload.updated_by || payload.updatedBy || null,
      source: "admin_web",
      module: "settings",
      action: "app_security/update",
      entity_type: "app_security",
      entity_id: "report_pin",
      description: "Admin update PIN laporan APK",
      metadata_json: {
        report_pin_enabled: data.app_security.report_pin_enabled
      }
    });
    return clone(getAppSecuritySettings());
  },

  async createUser(payload) {
    await delay(360);
    const userPayload = normalizeUserPayload(payload, { isCreate: true });
    assertUniqueUser(userPayload);

    const user = {
      id: createSequentialId("user", data.users),
      ...userPayload,
      last_login_at: null
    };

    data.users.push(user);
    logEntityActivity("user/create", {
      module: "user",
      entityType: "user",
      entity: user,
      description: `User ${user.name} dibuat.`,
      metadata: {
        role_id: user.role_id,
        outlet_ids: user.outlet_ids,
        status: user.status
      }
    });
    rebuildIndexes();

    return clone(getUserRows().find((item) => item.id === user.id));
  },

  async updateUser(userId, payload) {
    await delay(360);
    const user = data.users.find((item) => item.id === userId);

    if (!user) {
      throw new Error("User tidak ditemukan.");
    }

    const nextRole = roleMap.get(payload.role_id || user.role_id);
    const userPayload = normalizeUserPayload(payload, {
      requirePin: hasApkAccess(nextRole) && !Boolean(user.cashier_pin)
    });
    assertUniqueUser({ ...userPayload, userId });

    user.name = userPayload.name;
    user.username = userPayload.username;
    user.email = userPayload.email;
    user.role_id = userPayload.role_id;
    user.outlet_ids = userPayload.outlet_ids;
    user.status = userPayload.status;
    if (hasApkAccess(roleMap.get(userPayload.role_id))) {
      if (userPayload.cashier_pin) user.cashier_pin = userPayload.cashier_pin;
    } else {
      delete user.cashier_pin;
    }
    logEntityActivity("user/update", {
      module: "user",
      entityType: "user",
      entity: user,
      description: `User ${user.name} diperbarui.`,
      metadata: {
        role_id: user.role_id,
        outlet_ids: user.outlet_ids,
        status: user.status
      }
    });
    rebuildIndexes();

    return clone(getUserRows().find((item) => item.id === userId));
  },

  async updateProfile(userId, payload) {
    await delay(320);
    const user = data.users.find((item) => item.id === userId);

    if (!user) {
      throw new Error("User tidak ditemukan.");
    }

    const profilePayload = normalizeProfilePayload(payload);
    assertUniqueUser({ ...profilePayload, userId });

    user.name = profilePayload.name;
    user.username = profilePayload.username;
    user.email = profilePayload.email;
    user.profile_updated_at = new Date().toISOString();
    logEntityActivity("profile/update", {
      actorId: user.id,
      module: "profile",
      entityType: "user",
      entity: user,
      description: `Profil ${user.name} diperbarui.`
    });
    rebuildIndexes();

    return clone(getUserRows().find((item) => item.id === userId));
  },

  async changeProfilePassword(userId, payload) {
    await delay(360);
    const user = data.users.find((item) => item.id === userId);
    const currentPassword = String(payload.current_password || "");
    const newPassword = String(payload.new_password || "");
    const confirmPassword = String(payload.confirm_password || "");

    if (!user) {
      throw new Error("User tidak ditemukan.");
    }

    if (!currentPassword) {
      throw new Error("Password lama wajib diisi.");
    }

    if (newPassword.length < 6) {
      throw new Error("Password baru minimal 6 karakter.");
    }

    if (newPassword !== confirmPassword) {
      throw new Error("Konfirmasi password tidak sama.");
    }

    user.password_changed_at = new Date().toISOString();
    logEntityActivity("profile/change_password", {
      actorId: user.id,
      module: "profile",
      entityType: "user",
      entity: user,
      description: `Password profil ${user.name} diganti.`
    });
    rebuildIndexes();

    return clone(getUserRows().find((item) => item.id === userId));
  },

  async toggleUserStatus(userId) {
    await delay(260);
    const user = data.users.find((item) => item.id === userId);

    if (!user) {
      throw new Error("User tidak ditemukan.");
    }

    user.status = user.status === "active" ? "inactive" : "active";
    logEntityActivity("user/toggle_status", {
      module: "user",
      entityType: "user",
      entity: user,
      description: `Status user ${user.name} menjadi ${user.status}.`,
      metadata: { status: user.status }
    });
    rebuildIndexes();

    return clone(getUserRows().find((item) => item.id === userId));
  },

  async resetUserPassword(userId) {
    await delay(320);
    const user = data.users.find((item) => item.id === userId);

    if (!user) {
      throw new Error("User tidak ditemukan.");
    }

    user.password_reset_at = new Date().toISOString();
    logEntityActivity("user/reset_password", {
      module: "user",
      entityType: "user",
      entity: user,
      description: `Password user ${user.name} direset.`
    });
    rebuildIndexes();

    return clone({
      user: getUserRows().find((item) => item.id === userId),
      temporary_password: createTemporaryPassword()
    });
  },

  async createRole(payload = {}) {
    await delay(280);
    const name = String(payload.name || "").trim();
    const description = String(payload.description || "").trim();
    if (name.length < 2 || name.length > 80) throw new Error("Nama role wajib 2-80 karakter.");
    if (description.length > 500) throw new Error("Deskripsi role maksimal 500 karakter.");
    if (data.roles.some((role) => role.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("Nama role sudah digunakan.");
    }
    const role = {
      id: createSequentialId("role", data.roles),
      name,
      description: description || null,
      permissions: {}
    };
    data.roles.push(role);
    logEntityActivity("role/create_role", {
      module: "permission",
      entityType: "role",
      entity: role,
      description: `Role ${role.name} dibuat.`
    });
    rebuildIndexes();
    return clone(role);
  },

  async updateRole(roleId, payload = {}) {
    await delay(280);
    const role = data.roles.find((item) => item.id === roleId);
    if (!role) throw new Error("Role tidak ditemukan.");
    if (roleId === "role_owner") throw new Error("Role Owner dikunci agar akses penuh tetap aman.");
    const name = String(payload.name || "").trim();
    const description = String(payload.description || "").trim();
    if (name.length < 2 || name.length > 80) throw new Error("Nama role wajib 2-80 karakter.");
    if (description.length > 500) throw new Error("Deskripsi role maksimal 500 karakter.");
    if (data.roles.some((item) => item.id !== roleId && item.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("Nama role sudah digunakan.");
    }
    const before = { name: role.name, description: role.description };
    role.name = name;
    role.description = description || null;
    logEntityActivity("role/update_role", {
      module: "permission",
      entityType: "role",
      entity: role,
      description: `Role ${role.name} diperbarui.`,
      metadata: {
        before,
        after: { name: role.name, description: role.description }
      }
    });
    rebuildIndexes();
    return clone(role);
  },

  async deleteRole(roleId) {
    await delay(240);
    const roleIndex = data.roles.findIndex((item) => item.id === roleId);
    if (roleIndex < 0) throw new Error("Role tidak ditemukan.");
    if (["role_owner", "role_admin", "role_cashier"].includes(roleId)) {
      throw new Error("Role bawaan tidak dapat dihapus.");
    }
    const assignedUsers = data.users.filter((user) => user.role_id === roleId).length;
    if (assignedUsers) {
      const error = new Error(`Role masih digunakan oleh ${assignedUsers} user.`);
      error.status = 409;
      error.code = "ROLE_IN_USE";
      throw error;
    }
    const [role] = data.roles.splice(roleIndex, 1);
    logEntityActivity("role/delete_role", {
      module: "permission",
      entityType: "role",
      entity: role,
      description: `Role ${role.name} dihapus.`
    });
    rebuildIndexes();
    return { id: roleId, deleted: true };
  },

  async updateRolePermissions(roleId, permissions) {
    await delay(320);
    const role = data.roles.find((item) => item.id === roleId);

    if (!role) {
      throw new Error("Role tidak ditemukan.");
    }

    if (role.id === "role_owner") {
      throw new Error("Permission Owner dikunci agar akses penuh tetap aman.");
    }

    const allowedByKey = new Map(data.permissions.map((permission) => [permission.key, permission.actions]));
    role.permissions = Object.entries(permissions || {}).reduce((result, [permissionKey, actions]) => {
      const allowedActions = allowedByKey.get(permissionKey);
      if (!allowedActions) return result;

      const filtered = (Array.isArray(actions) ? actions : []).filter((action) => allowedActions.includes(action));
      if (permissionKey.startsWith("apk.") && filtered.length && !filtered.includes("view") && allowedActions.includes("view")) {
        filtered.unshift("view");
      }
      result[permissionKey] = filtered;
      return result;
    }, {});
    logEntityActivity("role/update_permissions", {
      module: "permission",
      entityType: "role",
      entity: role,
      description: `Permission role ${role.name} diperbarui.`,
      metadata: {
        permission_count: Object.keys(role.permissions || {}).length
      }
    });
    rebuildIndexes();

    return clone(role);
  },

  async generateCustomerBarcode(outletId) {
    await delay(180);
    if (!outletMap.has(outletId)) {
      throw new Error("Outlet tidak ditemukan.");
    }

    logEntityActivity("customer/generate_barcode", {
      outletId,
      module: "customer",
      entityType: "customer_barcode",
      entityId: outletId,
      description: `Admin generate barcode customer untuk ${outletMap.get(outletId)?.name}.`
    });
    return clone({
      barcode: createCustomerBarcode(outletId)
    });
  },

  async getCustomerDetail(customerId) {
    await delay();
    const customer = getCustomerRows("all").find((item) => item.id === customerId);

    if (!customer) {
      throw new Error("Customer tidak ditemukan.");
    }

    return clone(customer);
  },

  async createCustomer(payload) {
    await delay(360);
    const customerId = createSequentialId("customer", data.customers);
    const customerPayload = normalizeCustomerPayload(payload, customerId);
    const customer = {
      id: customerId,
      outlet_id: customerPayload.outlet_id,
      name: customerPayload.name,
      phone: customerPayload.phone,
      barcode: customerPayload.barcode || createCustomerBarcode(customerPayload.outlet_id),
      status: customerPayload.status,
      registered_at: payload.registered_at || new Date().toISOString().slice(0, 10)
    };

    data.customers.push(customer);
    logEntityActivity("customer/create", {
      module: "customer",
      entityType: "customer",
      entity: customer,
      description: `Customer ${customer.name} dibuat.`,
      metadata: { phone: customer.phone, barcode: customer.barcode }
    });
    rebuildIndexes();

    return clone(getCustomerRows("all").find((item) => item.id === customerId));
  },

  async updateCustomer(customerId, payload) {
    await delay(360);
    const customer = data.customers.find((item) => item.id === customerId);

    if (!customer) {
      throw new Error("Customer tidak ditemukan.");
    }

    const customerPayload = normalizeCustomerPayload(payload, customerId);
    customer.name = customerPayload.name;
    customer.phone = customerPayload.phone;
    customer.outlet_id = customerPayload.outlet_id;
    customer.barcode = customerPayload.barcode || customer.barcode || createCustomerBarcode(customerPayload.outlet_id);
    customer.status = customerPayload.status;
    logEntityActivity("customer/update", {
      module: "customer",
      entityType: "customer",
      entity: customer,
      description: `Customer ${customer.name} diperbarui.`,
      metadata: {
        phone: customer.phone,
        barcode: customer.barcode,
        status: customer.status
      }
    });
    rebuildIndexes();

    return clone(getCustomerRows("all").find((item) => item.id === customerId));
  },

  async toggleCustomerStatus(customerId) {
    await delay(260);
    const customer = data.customers.find((item) => item.id === customerId);

    if (!customer) {
      throw new Error("Customer tidak ditemukan.");
    }

    customer.status = customer.status === "active" ? "inactive" : "active";
    logEntityActivity("customer/toggle_status", {
      module: "customer",
      entityType: "customer",
      entity: customer,
      description: `Status customer ${customer.name} menjadi ${customer.status}.`,
      metadata: { status: customer.status }
    });
    rebuildIndexes();

    return clone(getCustomerRows("all").find((item) => item.id === customerId));
  },

  async getOutletDetail(outletId) {
    await delay();
    const outlet = getOutletRows().find((item) => item.id === outletId);

    if (!outlet) {
      throw new Error("Outlet tidak ditemukan.");
    }

    return clone(outlet);
  },

  async createOutlet(payload) {
    await delay(360);
    const outletPayload = normalizeOutletPayload(payload);
    const outlet = {
      id: createSequentialId("outlet", data.outlets),
      ...outletPayload
    };

    data.outlets.push(outlet);

    data.users = data.users.map((user) => (user.role_id === "role_owner" && !user.outlet_ids.includes(outlet.id) ? { ...user, outlet_ids: [...user.outlet_ids, outlet.id] } : user));
    logEntityActivity("outlet/create", {
      outletId: outlet.id,
      module: "outlet",
      entityType: "outlet",
      entity: outlet,
      description: `Outlet ${outlet.name} dibuat.`,
      metadata: { code: outlet.code, status: outlet.status }
    });
    rebuildIndexes();

    return clone(getOutletRows().find((item) => item.id === outlet.id));
  },

  async updateOutlet(outletId, payload) {
    await delay(360);
    const outlet = data.outlets.find((item) => item.id === outletId);

    if (!outlet) {
      throw new Error("Outlet tidak ditemukan.");
    }

    const outletPayload = normalizeOutletPayload(payload, outletId);
    outlet.name = outletPayload.name;
    outlet.code = outletPayload.code;
    outlet.address = outletPayload.address;
    outlet.phone = outletPayload.phone;
    outlet.opened_at = outletPayload.opened_at;
    outlet.status = outletPayload.status;
    logEntityActivity("outlet/update", {
      outletId: outlet.id,
      module: "outlet",
      entityType: "outlet",
      entity: outlet,
      description: `Outlet ${outlet.name} diperbarui.`,
      metadata: { code: outlet.code, status: outlet.status }
    });
    rebuildIndexes();

    return clone(getOutletRows().find((item) => item.id === outletId));
  },

  async toggleOutletStatus(outletId) {
    await delay(260);
    const outlet = data.outlets.find((item) => item.id === outletId);

    if (!outlet) {
      throw new Error("Outlet tidak ditemukan.");
    }

    outlet.status = outlet.status === "active" ? "inactive" : "active";
    logEntityActivity("outlet/toggle_status", {
      outletId: outlet.id,
      module: "outlet",
      entityType: "outlet",
      entity: outlet,
      description: `Status outlet ${outlet.name} menjadi ${outlet.status}.`,
      metadata: { status: outlet.status }
    });
    rebuildIndexes();

    return clone(getOutletRows().find((item) => item.id === outletId));
  },

  async createTable(payload) {
    await delay(320);
    const tablePayload = normalizeTablePayload(payload);
    const table = {
      id: createSequentialId("table", data.tables),
      ...tablePayload
    };

    data.tables.push(table);
    logEntityActivity("table/create", {
      module: "table",
      entityType: "table",
      entity: table,
      description: `Meja ${table.number} dibuat.`,
      metadata: { status: table.status }
    });
    rebuildIndexes();

    return clone(getTableRows("all").find((item) => item.id === table.id));
  },

  async generateTables(payload) {
    await delay(320);
    const outletId = String(payload.outlet_id || payload.outletId || "").trim();
    const quantity = Number(payload.quantity);
    const status = payload.status || "active";
    const outlet = outletMap.get(outletId);

    if (!outlet) {
      throw new Error("Outlet meja wajib dipilih.");
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new Error("Jumlah meja wajib bilangan bulat antara 1 sampai 100.");
    }
    if (!["active", "inactive"].includes(status)) {
      throw new Error("Status meja tidak valid.");
    }

    const generated = generateTableNumbers({
      existingNumbers: data.tables.filter((table) => table.outlet_id === outletId).map((table) => table.number),
      fallbackPrefix: alphabeticPrefix(
        Math.max(
          0,
          data.outlets.findIndex((item) => item.id === outletId)
        )
      ),
      quantity
    });
    const nextTableId = createIdGenerator("table", data.tables);
    const tables = generated.numbers.map((number) => ({
      id: nextTableId(),
      outlet_id: outletId,
      number,
      status
    }));

    data.tables.push(...tables);
    logEntityActivity("table/batch_create", {
      actorId: payload.created_by || payload.createdBy,
      outletId,
      module: "table",
      entityType: "table_batch",
      entityId: tables[0].id,
      description: `${tables.length} meja dibuat (${generated.first_number}–${generated.last_number}).`,
      metadata: {
        count: tables.length,
        first_number: generated.first_number,
        last_number: generated.last_number,
        status,
        table_ids: tables.map((table) => table.id)
      }
    });
    rebuildIndexes();

    return clone({
      count: tables.length,
      first_number: generated.first_number,
      last_number: generated.last_number,
      tables: tables.map((table) => ({
        ...table,
        outlet,
        outlet_name: outlet.name
      }))
    });
  },

  async getTableDetail(tableId) {
    await delay();
    const table = getTableRows("all").find((item) => item.id === tableId);

    if (!table) {
      throw new Error("Meja tidak ditemukan.");
    }

    return clone(table);
  },

  async updateTable(tableId, payload) {
    await delay(320);
    const table = data.tables.find((item) => item.id === tableId);

    if (!table) {
      throw new Error("Meja tidak ditemukan.");
    }

    const tablePayload = normalizeTablePayload(payload, tableId);
    table.outlet_id = tablePayload.outlet_id;
    table.number = tablePayload.number;
    table.status = tablePayload.status;
    logEntityActivity("table/update", {
      module: "table",
      entityType: "table",
      entity: table,
      description: `Meja ${table.number} diperbarui.`,
      metadata: { status: table.status }
    });
    rebuildIndexes();

    return clone(getTableRows("all").find((item) => item.id === tableId));
  },

  async toggleTableStatus(tableId) {
    await delay(260);
    const table = data.tables.find((item) => item.id === tableId);

    if (!table) {
      throw new Error("Meja tidak ditemukan.");
    }

    table.status = table.status === "active" ? "inactive" : "active";
    logEntityActivity("table/toggle_status", {
      module: "table",
      entityType: "table",
      entity: table,
      description: `Status meja ${table.number} menjadi ${table.status}.`,
      metadata: { status: table.status }
    });
    rebuildIndexes();

    return clone(getTableRows("all").find((item) => item.id === tableId));
  },

  async getCategoryDetail(categoryId) {
    await delay();
    const category = getCategoryRows().find((item) => item.id === categoryId);

    if (!category) {
      throw new Error("Kategori tidak ditemukan.");
    }

    return clone(category);
  },

  async createCategory(payload) {
    await delay(320);
    const nextSortOrder = data.categories.reduce((max, category) => Math.max(max, Number(category.sort_order || 0)), 0) + 1;
    const categoryPayload = normalizeCategoryPayload(payload, null, nextSortOrder);
    const category = {
      id: createSequentialId("cat", data.categories),
      ...categoryPayload
    };

    data.categories.push(category);
    logEntityActivity("product_category/create", {
      module: "product_category",
      entityType: "category",
      entity: category,
      description: `Kategori produk ${category.name} dibuat.`,
      metadata: { sort_order: category.sort_order, status: category.status }
    });
    rebuildIndexes();

    return clone(getCategoryRows().find((item) => item.id === category.id));
  },

  async updateCategory(categoryId, payload) {
    await delay(320);
    const category = data.categories.find((item) => item.id === categoryId);

    if (!category) {
      throw new Error("Kategori tidak ditemukan.");
    }

    const categoryPayload = normalizeCategoryPayload(payload, categoryId, category.sort_order);
    category.name = categoryPayload.name;
    category.sort_order = categoryPayload.sort_order;
    category.status = categoryPayload.status;
    logEntityActivity("product_category/update", {
      module: "product_category",
      entityType: "category",
      entity: category,
      description: `Kategori produk ${category.name} diperbarui.`,
      metadata: { sort_order: category.sort_order, status: category.status }
    });
    rebuildIndexes();

    return clone(getCategoryRows().find((item) => item.id === categoryId));
  },

  async toggleCategoryStatus(categoryId) {
    await delay(260);
    const category = data.categories.find((item) => item.id === categoryId);

    if (!category) {
      throw new Error("Kategori tidak ditemukan.");
    }

    category.status = category.status === "active" ? "inactive" : "active";
    logEntityActivity("product_category/toggle_status", {
      module: "product_category",
      entityType: "category",
      entity: category,
      description: `Status kategori produk ${category.name} menjadi ${category.status}.`,
      metadata: { status: category.status }
    });
    rebuildIndexes();

    return clone(getCategoryRows().find((item) => item.id === categoryId));
  },

  async createExpenseCategory(payload) {
    await delay(320);
    const nextSortOrder = data.expense_categories.reduce((max, category) => Math.max(max, Number(category.sort_order || 0)), 0) + 1;
    const categoryPayload = normalizeExpenseCategoryPayload(payload, null, nextSortOrder);
    const category = {
      id: createSequentialId("expense_cat", data.expense_categories),
      ...categoryPayload
    };

    data.expense_categories.push(category);
    logEntityActivity("expense_category/create", {
      module: "expense_category",
      entityType: "expense_category",
      entity: category,
      description: `Nama pengeluaran operasional ${category.name} dibuat.`,
      metadata: {
        account_code: category.account_code,
        sort_order: category.sort_order,
        status: category.status
      }
    });
    rebuildIndexes();

    return clone(getExpenseCategoryRows().find((item) => item.id === category.id));
  },

  async getExpenseCategoryDetail(categoryId) {
    await delay();
    const category = getExpenseCategoryRows().find((item) => item.id === categoryId);

    if (!category) {
      throw new Error("Nama pengeluaran operasional tidak ditemukan.");
    }

    return clone(category);
  },

  async updateExpenseCategory(categoryId, payload) {
    await delay(320);
    const category = data.expense_categories.find((item) => item.id === categoryId);

    if (!category) {
      throw new Error("Nama pengeluaran operasional tidak ditemukan.");
    }

    const categoryPayload = normalizeExpenseCategoryPayload(payload, categoryId, category.sort_order);
    category.name = categoryPayload.name;
    category.account_code = categoryPayload.account_code;
    category.sort_order = categoryPayload.sort_order;
    category.status = categoryPayload.status;
    logEntityActivity("expense_category/update", {
      module: "expense_category",
      entityType: "expense_category",
      entity: category,
      description: `Nama pengeluaran operasional ${category.name} diperbarui.`,
      metadata: {
        account_code: category.account_code,
        sort_order: category.sort_order,
        status: category.status
      }
    });
    rebuildIndexes();

    return clone(getExpenseCategoryRows().find((item) => item.id === categoryId));
  },

  async toggleExpenseCategoryStatus(categoryId) {
    await delay(260);
    const category = data.expense_categories.find((item) => item.id === categoryId);

    if (!category) {
      throw new Error("Nama pengeluaran operasional tidak ditemukan.");
    }

    category.status = category.status === "active" ? "inactive" : "active";
    logEntityActivity("expense_category/toggle_status", {
      module: "expense_category",
      entityType: "expense_category",
      entity: category,
      description: `Status nama pengeluaran operasional ${category.name} menjadi ${category.status}.`,
      metadata: { status: category.status }
    });
    rebuildIndexes();

    return clone(getExpenseCategoryRows().find((item) => item.id === categoryId));
  },

  async correctExpenseAmount(expenseId, payload = {}) {
    await delay(260);
    const expense = data.expenses.find((item) => item.id === expenseId);

    if (!expense) {
      throw new Error("Pengeluaran tidak ditemukan.");
    }

    const correctionPayload = normalizeExpenseCorrectionPayload(payload);
    const previousAmount = Number(expense.amount || 0);
    const correctedBy = payload.corrected_by || payload.correctedBy || data.users[0]?.id || null;

    expense.previous_amount = previousAmount;
    expense.amount = correctionPayload.amount;
    expense.correction_note = correctionPayload.correction_note;
    expense.corrected_at = new Date().toISOString();
    expense.corrected_by = correctedBy;

    logAdminActivity("update", {
      actorId: correctedBy,
      outletId: expense.outlet_id,
      module: "expense",
      entityType: "expense",
      entityId: expense.id,
      description: `Admin koreksi pengeluaran ${expense.category}`,
      metadata: {
        previous_amount: previousAmount,
        new_amount: correctionPayload.amount,
        correction_note: correctionPayload.correction_note
      }
    });

    return clone(getExpenseRows(expense.outlet_id).find((item) => item.id === expense.id));
  },

  async approveExpense(expenseId, payload = {}) {
    await delay(260);
    const expense = data.expenses.find((item) => item.id === expenseId);
    const approvedBy = payload.approved_by || payload.approvedBy || data.users[0]?.id || null;

    if (!expense) {
      throw new Error("Pengeluaran tidak ditemukan.");
    }
    if ((expense.status || "approved") !== "pending") {
      throw new Error("Hanya pengeluaran pending yang bisa di-approve.");
    }

    expense.status = "approved";
    expense.approved_at = new Date().toISOString();
    expense.approved_by = approvedBy;
    expense.rejected_at = null;
    expense.rejected_by = null;
    expense.rejection_note = "";

    createActivityLog({
      actor_user_id: approvedBy,
      outlet_id: expense.outlet_id,
      source: "admin_web",
      module: "expense",
      action: "approve",
      entity_type: "expense",
      entity_id: expense.id,
      description: `Admin approve pengeluaran ${expense.category}.`,
      metadata_json: {
        category: expense.category,
        amount: Number(expense.amount || 0),
        expense_date: expense.expense_date
      },
      created_at: expense.approved_at
    });
    rebuildIndexes();

    return clone(getExpenseRows(expense.outlet_id).find((item) => item.id === expense.id));
  },

  async rejectExpense(expenseId, payload = {}) {
    await delay(260);
    const expense = data.expenses.find((item) => item.id === expenseId);
    const rejectedBy = payload.rejected_by || payload.rejectedBy || data.users[0]?.id || null;
    const rejectionNote = String(payload.reason || payload.rejection_note || payload.rejectionNote || "").trim();

    if (!expense) {
      throw new Error("Pengeluaran tidak ditemukan.");
    }
    if ((expense.status || "approved") !== "pending") {
      throw new Error("Hanya pengeluaran pending yang bisa di-reject.");
    }
    if (!rejectionNote) {
      throw new Error("Alasan reject wajib diisi.");
    }

    expense.status = "rejected";
    expense.rejected_at = new Date().toISOString();
    expense.rejected_by = rejectedBy;
    expense.rejection_note = rejectionNote;
    expense.approved_at = null;
    expense.approved_by = null;

    createActivityLog({
      actor_user_id: rejectedBy,
      outlet_id: expense.outlet_id,
      source: "admin_web",
      module: "expense",
      action: "reject",
      entity_type: "expense",
      entity_id: expense.id,
      description: `Admin reject pengeluaran ${expense.category}.`,
      metadata_json: {
        category: expense.category,
        amount: Number(expense.amount || 0),
        expense_date: expense.expense_date,
        reason: rejectionNote
      },
      created_at: expense.rejected_at
    });
    rebuildIndexes();

    return clone(getExpenseRows(expense.outlet_id).find((item) => item.id === expense.id));
  },

  async correctTransactionItems(transactionId, payload = {}) {
    await delay(320);
    const transaction = data.transactions.find((item) => item.id === transactionId);
    const reason = String(payload.reason || "").trim();
    const updatedBy = payload.updated_by || payload.updatedBy || data.users[0]?.id || null;
    if (!transaction) throw new Error("Transaksi tidak ditemukan.");
    if (!reason) throw new Error("Alasan koreksi transaksi wajib diisi.");
    if (!["paid", "refunded", "cancelled"].includes(transaction.status)) throw new Error("Status transaksi tidak mendukung koreksi item.");
    if (!Array.isArray(payload.items) || !payload.items.length) {
      throw new Error("Minimal satu item transaksi wajib dipertahankan. Gunakan Cancel untuk membatalkan seluruh transaksi.");
    }
    const expectedStatus = String(payload.expected_status || payload.expectedStatus || "");
    const rawExpectedUpdatedAt = payload.expected_updated_at || payload.expectedUpdatedAt;
    if (!expectedStatus || !rawExpectedUpdatedAt) throw new Error("Versi transaksi wajib dikirim ulang sebelum koreksi.");
    const expectedUpdatedAt = normalizeMobileDate(rawExpectedUpdatedAt);
    const currentUpdatedAt = normalizeMobileDate(transaction.updated_at || transaction.transaction_date);
    if (transaction.status !== expectedStatus || expectedUpdatedAt !== currentUpdatedAt) {
      const error = new Error("Transaksi sudah berubah. Muat ulang data sebelum mengoreksi kembali.");
      error.status = 409;
      error.code = "TRANSACTION_VERSION_CONFLICT";
      throw error;
    }

    const oldItems = data.transaction_items.filter((item) => item.transaction_id === transaction.id);
    const beforeSnapshot = {
      items: clone(oldItems),
      subtotal: Number(transaction.subtotal || 0),
      discount: Number(transaction.discount || 0),
      discount_id: transaction.discount_id || null,
      discount_type: transaction.discount_type || null,
      discount_value: Number(transaction.discount_value || 0),
      discount_name: transaction.discount_name || null,
      tax: Number(transaction.tax || 0),
      total: Number(transaction.total || 0),
      payment: null,
      customer_points_earned: Number(transaction.customer_points_earned || 0)
    };
    const oldItemById = new Map(oldItems.map((item) => [item.id, item]));
    const requestedExistingIds = payload.items.map((item) => item.id).filter(Boolean);
    if (new Set(requestedExistingIds).size !== requestedExistingIds.length) throw new Error("Baris item transaksi tidak boleh duplikat.");
    if (requestedExistingIds.some((id) => !oldItemById.has(id))) throw new Error("Item lama tidak berasal dari transaksi ini.");

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
      const productId = String(row.product_id || row.productId || "");
      const product = data.products.find((item) => item.id === productId && item.status === "active");
      const price = data.product_prices.find((item) => item.product_id === productId && item.outlet_id === transaction.outlet_id && item.status === "active" && Number(item.price || 0) > 0);
      if (!product || !price) throw new Error(`Produk baru baris ${index + 1} tidak aktif atau belum memiliki harga outlet.`);
      const variantIds = [...new Set((row.variant_ids || row.variantIds || []).map((id) => String(id)).filter(Boolean))];
      const selectedVariants = variantIds.map((variantId) => {
        const variant = data.product_variants.find((item) => item.id === variantId && item.product_id === productId && item.status === "active");
        if (!variant) throw new Error("Varian produk baru tidak aktif atau tidak valid.");
        return {
          id: variant.id,
          product_id: variant.product_id,
          name: variant.name
        };
      });
      return {
        id: `trx_item_correction_${Date.now()}_${index}`,
        transaction_id: transaction.id,
        product_id: productId,
        quantity,
        unit_price: Number(price.price || 0),
        subtotal: quantity * Number(price.price || 0),
        metadata_json: { selected_variants: selectedVariants },
        is_new: true
      };
    });
    const hasDiscountType = Object.prototype.hasOwnProperty.call(payload, "discount_type") || Object.prototype.hasOwnProperty.call(payload, "discountType");
    const hasDiscountValue = Object.prototype.hasOwnProperty.call(payload, "discount_value") || Object.prototype.hasOwnProperty.call(payload, "discountValue");
    let discountCorrection = {
      type: transaction.discount_type || null,
      value: Number(transaction.discount_value || 0),
      name: transaction.discount_name || (Number(transaction.discount || 0) > 0 ? "Diskon Manual" : null),
      id: transaction.discount_id || null,
      fallbackDiscount: Number(transaction.discount || 0)
    };
    if (hasDiscountType || hasDiscountValue) {
      const rawType = String(payload.discount_type ?? payload.discountType ?? "").trim().toLowerCase();
      const type = rawType === "percent" || rawType === "nominal" ? rawType : null;
      const rawValue = Math.max(0, Number(payload.discount_value ?? payload.discountValue ?? 0));
      const value = type === "percent" ? Math.min(100, Math.round(rawValue)) : Math.round(rawValue);
      discountCorrection = type && value > 0
        ? { type, value, name: "Diskon Manual", id: null, fallbackDiscount: 0 }
        : { type: null, value: 0, name: null, id: null, fallbackDiscount: 0 };
    }
    const totals = calculateTransactionCorrectionTotals({
      items: desiredItems,
      discountType: discountCorrection.type,
      discountValue: discountCorrection.value,
      fallbackDiscount: discountCorrection.fallbackDiscount,
      tax: transaction.tax
    });
    const payment = data.payments.find((item) => item.transaction_id === transaction.id);
    if (!payment) throw new Error("Data pembayaran transaksi tidak ditemukan.");
    beforeSnapshot.payment = {
      amount: Number(payment.amount || 0),
      change_amount: Number(payment.change_amount || 0)
    };
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
    const compositions = data.product_compositions.filter((item) => productIds.includes(item.product_id));
    const materialDeltas = isPaid ? calculateMaterialDeltas(oldItems, desiredItems, compositions) : [];
    const stockChanges = materialDeltas.map((delta) => {
      const material = materialMap.get(delta.material_id);
      let stock = data.raw_material_stocks.find((item) => item.outlet_id === transaction.outlet_id && item.material_id === delta.material_id);
      const previousQuantity = Number(stock?.quantity || 0);
      const nextQuantity = roundQuantity(previousQuantity - delta.deduction_delta);
      if (!stock) {
        stock = {
          id: createSequentialId("stock", data.raw_material_stocks),
          outlet_id: transaction.outlet_id,
          material_id: delta.material_id,
          quantity: 0,
          unit: material?.unit || "",
          last_purchase_price: Number(material?.last_purchase_price || 0),
          last_purchase_date: material?.last_purchase_date || null,
          stock_value: 0
        };
        data.raw_material_stocks.push(stock);
      }
      stock.quantity = nextQuantity;
      stock.unit = material?.unit || stock.unit;
      stock.stock_value = Math.round(nextQuantity * Number(stock.last_purchase_price || 0));
      return {
        ...delta,
        previous_stock: previousQuantity,
        next_stock: nextQuantity
      };
    });

    let pointChange = null;
    if (isPaid && transaction.customer_id) {
      const customer = customerMap.get(transaction.customer_id);
      if (customer) {
        pointChange = calculatePointCorrection({
          total: totals.total,
          previousEarned: transaction.customer_points_earned,
          currentBalance: customer.points
        });
        customer.points = pointChange.next_balance;
      }
    }

    data.transaction_items = [...data.transaction_items.filter((item) => item.transaction_id !== transaction.id), ...desiredItems.map(({ is_new: _isNew, ...item }) => item)];
    Object.assign(transaction, totals, {
      discount_id: discountCorrection.id,
      discount_type: totals.discount > 0 ? discountCorrection.type : null,
      discount_value: totals.discount > 0 ? discountCorrection.value : 0,
      discount_name: totals.discount > 0 ? discountCorrection.name : null,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
      correction_reason: reason
    });
    if (pointChange) {
      transaction.customer_points_earned = pointChange.earned;
      transaction.customer_points_after = Number(transaction.customer_points_before || 0) + pointChange.earned;
    }
    if (isPaid) Object.assign(payment, paymentAfter);

    createActivityLog({
      actor_user_id: updatedBy,
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
        before: beforeSnapshot,
        after: {
          items: desiredItems,
          ...totals,
          discount_id: transaction.discount_id,
          discount_type: transaction.discount_type,
          discount_value: transaction.discount_value,
          discount_name: transaction.discount_name,
          payment: paymentAfter
        },
        stock_changes: stockChanges,
        point_change: pointChange
      }
    });
    rebuildIndexes();
    persistMockData();
    return clone(enrichTransaction(transaction));
  },

  async refundTransaction(transactionId, payload = {}) {
    await delay(320);
    const transaction = data.transactions.find((item) => item.id === transactionId);
    const reason = String(payload.reason || "").trim();
    const refundedBy = payload.refunded_by || payload.refundedBy || data.users[0]?.id || null;

    if (!transaction) {
      throw new Error("Transaksi tidak ditemukan.");
    }
    if (transaction.status !== "paid") {
      throw new Error("Hanya transaksi paid yang bisa di-refund.");
    }
    if (data.transaction_refunds.some((item) => item.transaction_id === transaction.id && item.status !== "cancelled")) {
      throw new Error("Transaksi ini sudah pernah di-refund.");
    }
    if (!reason) {
      throw new Error("Alasan refund wajib diisi.");
    }

    const payment = data.payments.find((item) => item.transaction_id === transaction.id);
    const restoredStock = applyTransactionStockReturn(transaction);
    const refund = {
      id: createSequentialId("refund", data.transaction_refunds),
      transaction_id: transaction.id,
      outlet_id: transaction.outlet_id,
      refund_amount: Number(transaction.total || 0),
      payment_method: payment?.method || "unknown",
      reason,
      refunded_by: refundedBy,
      refunded_at: new Date().toISOString(),
      status: "active"
    };

    transaction.status = "refunded";
    data.transaction_refunds.unshift(refund);

    createActivityLog({
      actor_user_id: refundedBy,
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
        restored_stock: [...restoredStock.entries()].map(([material_id, quantity]) => ({ material_id, quantity }))
      }
    });

    rebuildIndexes();
    return clone(enrichTransaction(transaction));
  },

  async cancelTransaction(transactionId, payload = {}) {
    await delay(320);
    const transaction = data.transactions.find((item) => item.id === transactionId);
    const reason = String(payload.reason || "").trim();
    const cancelledBy = payload.cancelled_by || payload.cancelledBy || data.users[0]?.id || null;

    if (!transaction) {
      throw new Error("Transaksi tidak ditemukan.");
    }
    if (transaction.status !== "paid") {
      throw new Error("Hanya transaksi paid yang bisa di-cancel.");
    }
    if (!reason) {
      throw new Error("Alasan cancel wajib diisi.");
    }

    const restoredStock = applyTransactionStockReturn(transaction);
    transaction.status = "cancelled";
    transaction.cancel_reason = reason;
    transaction.cancelled_by = cancelledBy;
    transaction.cancelled_at = new Date().toISOString();
    transaction.stock_cancelled = true;
    transaction.stock_cancelled_at = transaction.cancelled_at;

    createActivityLog({
      actor_user_id: cancelledBy,
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
        restored_stock: [...restoredStock.entries()].map(([material_id, quantity]) => ({ material_id, quantity }))
      }
    });

    rebuildIndexes();
    return clone(enrichTransaction(transaction));
  },

  async createPaymentMethod(payload) {
    await delay(320);
    const nextSortOrder = (data.payment_methods || []).reduce((max, method) => Math.max(max, Number(method.sort_order || 0)), 0) + 1;
    const methodPayload = normalizePaymentMethodPayload(payload, null, nextSortOrder);
    const method = {
      id: createSequentialId("payment_method", data.payment_methods),
      ...methodPayload
    };

    data.payment_methods.push(method);
    logEntityActivity("payment_method/create", {
      module: "payment_method",
      entityType: "payment_method",
      entity: method,
      description: `Metode pembayaran ${method.name} dibuat.`,
      metadata: {
        code: method.code,
        account_code: method.account_code,
        status: method.status
      }
    });
    rebuildIndexes();

    return clone(getPaymentMethodRows().find((item) => item.id === method.id));
  },

  async updatePaymentMethod(methodId, payload) {
    await delay(320);
    const method = data.payment_methods.find((item) => item.id === methodId);

    if (!method) {
      throw new Error("Metode pembayaran tidak ditemukan.");
    }

    const methodPayload = normalizePaymentMethodPayload(payload, methodId, method.sort_order);
    method.name = methodPayload.name;
    method.code = methodPayload.code;
    method.account_code = methodPayload.account_code;
    method.sort_order = methodPayload.sort_order;
    method.status = methodPayload.status;
    logEntityActivity("payment_method/update", {
      module: "payment_method",
      entityType: "payment_method",
      entity: method,
      description: `Metode pembayaran ${method.name} diperbarui.`,
      metadata: {
        code: method.code,
        account_code: method.account_code,
        status: method.status
      }
    });
    rebuildIndexes();

    return clone(getPaymentMethodRows().find((item) => item.id === methodId));
  },

  async togglePaymentMethodStatus(methodId) {
    await delay(260);
    const method = data.payment_methods.find((item) => item.id === methodId);

    if (!method) {
      throw new Error("Metode pembayaran tidak ditemukan.");
    }

    method.status = method.status === "active" ? "inactive" : "active";
    logEntityActivity("payment_method/toggle_status", {
      module: "payment_method",
      entityType: "payment_method",
      entity: method,
      description: `Status metode pembayaran ${method.name} menjadi ${method.status}.`,
      metadata: { code: method.code, status: method.status }
    });
    rebuildIndexes();

    return clone(getPaymentMethodRows().find((item) => item.id === methodId));
  },

  async createFinancialAccount(payload) {
    await delay(320);
    const nextSortOrder = (data.financial_accounts || []).reduce((max, account) => Math.max(max, Number(account.sort_order || 0)), 0) + 1;
    const accountPayload = normalizeFinancialAccountPayload(payload, null, nextSortOrder);
    const account = {
      id: createSequentialId("account", data.financial_accounts),
      ...accountPayload
    };

    data.financial_accounts.push(account);
    logEntityActivity("financial_account/create", {
      module: "financial_account",
      entityType: "financial_account",
      entity: account,
      description: `Akun laporan [${account.code}] ${account.name} dibuat.`,
      metadata: {
        code: account.code,
        report_group: account.report_group,
        normal_balance: account.normal_balance
      }
    });
    rebuildIndexes();

    return clone(getFinancialAccountRows().find((item) => item.id === account.id));
  },

  async updateFinancialAccount(accountId, payload) {
    await delay(320);
    const account = data.financial_accounts.find((item) => item.id === accountId);

    if (!account) {
      throw new Error("Akun laporan tidak ditemukan.");
    }

    const accountPayload = normalizeFinancialAccountPayload(payload, accountId, account.sort_order);
    account.code = accountPayload.code;
    account.name = accountPayload.name;
    account.report_group = accountPayload.report_group;
    account.normal_balance = accountPayload.normal_balance;
    account.sort_order = accountPayload.sort_order;
    account.status = accountPayload.status;
    logEntityActivity("financial_account/update", {
      module: "financial_account",
      entityType: "financial_account",
      entity: account,
      description: `Akun laporan [${account.code}] ${account.name} diperbarui.`,
      metadata: {
        code: account.code,
        report_group: account.report_group,
        normal_balance: account.normal_balance,
        status: account.status
      }
    });
    rebuildIndexes();

    return clone(getFinancialAccountRows().find((item) => item.id === accountId));
  },

  async toggleFinancialAccountStatus(accountId) {
    await delay(260);
    const account = data.financial_accounts.find((item) => item.id === accountId);

    if (!account) {
      throw new Error("Akun laporan tidak ditemukan.");
    }

    account.status = account.status === "active" ? "inactive" : "active";
    logEntityActivity("financial_account/toggle_status", {
      module: "financial_account",
      entityType: "financial_account",
      entity: account,
      description: `Status akun laporan [${account.code}] ${account.name} menjadi ${account.status}.`,
      metadata: { code: account.code, status: account.status }
    });
    rebuildIndexes();

    return clone(getFinancialAccountRows().find((item) => item.id === accountId));
  },

  async createFinanceEntryGroup(payload) {
    await delay(320);
    const groupPayload = normalizeFinanceEntryGroupPayload(payload, null);
    const group = {
      id: createSequentialId("finance_group", data.finance_entry_groups || []),
      ...groupPayload,
      created_at: new Date().toISOString()
    };

    data.finance_entry_groups.push(group);
    logAdminActivity("finance_group/create", {
      outletId: group.outlet_id,
      module: "finance_group",
      entityType: "finance_group",
      entityId: group.id,
      description: `Pos Keuangan ${group.name} dibuat.`,
      metadata: {
        account_code: group.account_code,
        group: group.group,
        outlet_id: group.outlet_id
      }
    });
    rebuildIndexes();

    return clone(getFinanceEntryGroupRows().find((item) => item.id === group.id));
  },

  async updateFinanceEntryGroup(groupId, payload) {
    await delay(320);
    const group = getFinanceEntryGroupById(groupId);

    if (!group) {
      throw new Error("Pos Keuangan tidak ditemukan.");
    }

    const previousGroup = clone(group);
    const groupPayload = normalizeFinanceEntryGroupPayload(payload, groupId);
    group.name = groupPayload.name;
    group.account_code = groupPayload.account_code;
    group.group = groupPayload.group;
    group.outlet_id = groupPayload.outlet_id;
    group.note = groupPayload.note;
    group.status = groupPayload.status;

    data.balance_sheet_entries
      .filter((entry) => entry.finance_group_id === group.id)
      .forEach((entry) => {
        entry.name = group.name;
        entry.account_code = group.account_code;
        entry.group = group.group;
        entry.outlet_id = group.outlet_id;
      });

    logAdminActivity("finance_group/update", {
      outletId: group.outlet_id,
      module: "finance_group",
      entityType: "finance_group",
      entityId: group.id,
      description: `Pos Keuangan ${group.name} dikoreksi.`,
      metadata: {
        previous: previousGroup,
        next: groupPayload
      }
    });
    rebuildIndexes();

    return clone(getFinanceEntryGroupRows().find((item) => item.id === group.id));
  },

  async toggleFinanceEntryGroupStatus(groupId) {
    await delay(260);
    const group = getFinanceEntryGroupById(groupId);

    if (!group) {
      throw new Error("Pos Keuangan tidak ditemukan.");
    }

    const previousStatus = group.status;
    group.status = group.status === "active" ? "inactive" : "active";
    logAdminActivity("finance_group/toggle_status", {
      outletId: group.outlet_id,
      module: "finance_group",
      entityType: "finance_group",
      entityId: group.id,
      description: `Status Pos Keuangan ${group.name} menjadi ${group.status}.`,
      metadata: {
        previous_status: previousStatus,
        status: group.status
      }
    });
    rebuildIndexes();

    return clone(getFinanceEntryGroupRows().find((item) => item.id === group.id));
  },

  async createFinanceEntry(payload) {
    await delay(320);
    const entryPayload = normalizeFinanceEntryPayload(payload, null);
    findOrCreateFinanceEntryGroupForEntry(entryPayload);
    const entry = {
      id: createSequentialId("finance_entry", data.balance_sheet_entries),
      ...entryPayload
    };

    data.balance_sheet_entries.push(entry);
    logAdminActivity("finance_transaction/create", {
      outletId: entry.outlet_id,
      module: "finance_transaction",
      entityType: "finance_transaction",
      entityId: entry.id,
      description: `Transaksi keuangan ${entry.name} dibuat.`,
      metadata: {
        finance_group_id: entry.finance_group_id,
        account_code: entry.account_code,
        group: entry.group,
        movement_type: entry.movement_type,
        amount: entry.amount,
        entry_date: entry.entry_date
      }
    });
    rebuildIndexes();

    return clone(getFinanceEntryRows().find((item) => item.id === entry.id));
  },

  async updateFinanceEntry(entryId, payload) {
    await delay(320);
    const entry = data.balance_sheet_entries.find((item) => item.id === entryId);

    if (!entry) {
      throw new Error("Transaksi keuangan tidak ditemukan.");
    }

    const previousEntry = clone(entry);
    const entryPayload = normalizeFinanceEntryPayload(payload, entryId);
    findOrCreateFinanceEntryGroupForEntry(entryPayload);
    entry.finance_group_id = entryPayload.finance_group_id;
    entry.account_code = entryPayload.account_code;
    entry.name = entryPayload.name;
    entry.group = entryPayload.group;
    entry.movement_type = entryPayload.movement_type;
    entry.amount = entryPayload.amount;
    entry.entry_date = entryPayload.entry_date;
    entry.outlet_id = entryPayload.outlet_id;
    entry.note = entryPayload.note;
    entry.status = entryPayload.status;
    logAdminActivity("finance_transaction/update", {
      outletId: entry.outlet_id,
      module: "finance_transaction",
      entityType: "finance_transaction",
      entityId: entry.id,
      description: `Transaksi keuangan ${entry.name} dikoreksi.`,
      metadata: {
        previous: {
          account_code: previousEntry.account_code,
          finance_group_id: previousEntry.finance_group_id,
          group: previousEntry.group,
          movement_type: previousEntry.movement_type,
          amount: previousEntry.amount,
          entry_date: previousEntry.entry_date,
          outlet_id: previousEntry.outlet_id,
          status: previousEntry.status
        },
        next: {
          account_code: entry.account_code,
          finance_group_id: entry.finance_group_id,
          group: entry.group,
          movement_type: entry.movement_type,
          amount: entry.amount,
          entry_date: entry.entry_date,
          outlet_id: entry.outlet_id,
          status: entry.status
        }
      }
    });
    rebuildIndexes();

    return clone(getFinanceEntryRows().find((item) => item.id === entryId));
  },

  async toggleFinanceEntryStatus(entryId) {
    await delay(260);
    const entry = data.balance_sheet_entries.find((item) => item.id === entryId);

    if (!entry) {
      throw new Error("Transaksi keuangan tidak ditemukan.");
    }

    const previousStatus = entry.status;
    entry.status = entry.status === "active" ? "inactive" : "active";
    logAdminActivity("finance_transaction/toggle_status", {
      outletId: entry.outlet_id,
      module: "finance_transaction",
      entityType: "finance_transaction",
      entityId: entry.id,
      description: `Status transaksi keuangan ${entry.name} menjadi ${entry.status}.`,
      metadata: {
        finance_group_id: entry.finance_group_id,
        previous_status: previousStatus,
        status: entry.status
      }
    });
    rebuildIndexes();

    return clone(getFinanceEntryRows().find((item) => item.id === entryId));
  },

  async createReserveFund(payload) {
    await delay(320);
    const entryPayload = normalizeFinanceEntryPayload(
      {
        ...payload,
        group: "reserve_fund",
        account_code: payload.account_code || payload.accountCode || "1431"
      },
      null
    );
    const entry = {
      id: createSequentialId("finance_entry", data.balance_sheet_entries),
      ...entryPayload
    };

    data.balance_sheet_entries.push(entry);
    logEntityActivity("reserve_fund/create", {
      outletId: entry.outlet_id,
      module: "reserve_fund",
      entityType: "finance_entry",
      entity: entry,
      description: `Mutasi dana cadangan ${entry.name} dibuat.`,
      metadata: {
        account_code: entry.account_code,
        movement_type: entry.movement_type,
        amount: entry.amount,
        entry_date: entry.entry_date
      }
    });
    rebuildIndexes();

    return clone(getReserveFundRows().find((item) => item.id === entry.id));
  },

  async updateReserveFund(entryId, payload) {
    await delay(320);
    const entry = data.balance_sheet_entries.find((item) => item.id === entryId && isReserveFundAccount(getFinancialAccountByCode(item.account_code)));

    if (!entry) {
      throw new Error("Mutasi dana cadangan tidak ditemukan.");
    }

    const entryPayload = normalizeFinanceEntryPayload(
      {
        ...payload,
        group: "reserve_fund",
        account_code: payload.account_code || payload.accountCode || entry.account_code || "1431"
      },
      entryId
    );
    entry.account_code = entryPayload.account_code;
    entry.name = entryPayload.name;
    entry.group = entryPayload.group;
    entry.movement_type = entryPayload.movement_type;
    entry.amount = entryPayload.amount;
    entry.entry_date = entryPayload.entry_date;
    entry.outlet_id = entryPayload.outlet_id;
    entry.note = entryPayload.note;
    entry.status = entryPayload.status;
    logEntityActivity("reserve_fund/update", {
      outletId: entry.outlet_id,
      module: "reserve_fund",
      entityType: "finance_entry",
      entity: entry,
      description: `Mutasi dana cadangan ${entry.name} diperbarui.`,
      metadata: {
        account_code: entry.account_code,
        movement_type: entry.movement_type,
        amount: entry.amount,
        entry_date: entry.entry_date,
        status: entry.status
      }
    });
    rebuildIndexes();

    return clone(getReserveFundRows().find((item) => item.id === entryId));
  },

  async toggleReserveFundStatus(entryId) {
    await delay(260);
    const entry = data.balance_sheet_entries.find((item) => item.id === entryId && isReserveFundAccount(getFinancialAccountByCode(item.account_code)));

    if (!entry) {
      throw new Error("Mutasi dana cadangan tidak ditemukan.");
    }

    entry.status = entry.status === "active" ? "inactive" : "active";
    logEntityActivity("reserve_fund/toggle_status", {
      outletId: entry.outlet_id,
      module: "reserve_fund",
      entityType: "finance_entry",
      entity: entry,
      description: `Status mutasi dana cadangan ${entry.name} menjadi ${entry.status}.`,
      metadata: { status: entry.status }
    });
    rebuildIndexes();

    return clone(getReserveFundRows().find((item) => item.id === entryId));
  },

  async createDiscount(payload) {
    await delay(320);
    const discountPayload = normalizeDiscountPayload(payload, null);
    const { outlet_ids: outletIds, ...discountFields } = discountPayload;
    const discount = {
      id: createSequentialId("discount", data.discounts),
      ...discountFields
    };

    data.discounts.push(discount);
    syncDiscountOutlets(discount.id, outletIds);
    logAdminActivity("discount/create", {
      module: "discount",
      entityType: "discount",
      entityId: discount.id,
      description: `Discount ${discount.name} dibuat.`,
      metadata: { outlet_ids: outletIds }
    });
    rebuildIndexes();

    return clone(getDiscountRows().find((item) => item.id === discount.id));
  },

  async updateDiscount(discountId, payload) {
    await delay(320);
    const discount = data.discounts.find((item) => item.id === discountId);

    if (!discount) {
      throw new Error("Discount tidak ditemukan.");
    }

    const discountPayload = normalizeDiscountPayload(payload, discountId);
    const { outlet_ids: outletIds, ...discountFields } = discountPayload;
    discount.name = discountPayload.name;
    discount.type = discountFields.type;
    discount.value = discountFields.value;
    discount.starts_at = discountFields.starts_at;
    discount.ends_at = discountFields.ends_at;
    discount.status = discountFields.status;
    syncDiscountOutlets(discount.id, outletIds);
    logAdminActivity("discount/update", {
      module: "discount",
      entityType: "discount",
      entityId: discount.id,
      description: `Discount ${discount.name} diperbarui.`,
      metadata: { outlet_ids: outletIds }
    });
    rebuildIndexes();

    return clone(getDiscountRows().find((item) => item.id === discountId));
  },

  async toggleDiscountStatus(discountId) {
    await delay(260);
    const discount = data.discounts.find((item) => item.id === discountId);

    if (!discount) {
      throw new Error("Discount tidak ditemukan.");
    }

    discount.status = discount.status === "active" ? "inactive" : "active";
    logAdminActivity("discount/toggle_status", {
      module: "discount",
      entityType: "discount",
      entityId: discount.id,
      description: `Status discount ${discount.name} menjadi ${discount.status}.`
    });
    rebuildIndexes();

    return clone(getDiscountRows().find((item) => item.id === discountId));
  },

  async getPosDiscounts({ outletId } = {}) {
    await delay(180);
    if (!outletMap.has(outletId)) {
      throw new Error("Outlet discount tidak ditemukan.");
    }
    return clone(getDiscountRows().filter((discount) => (discount.outlet_ids || []).includes(outletId)));
  },

  async createPosDiscount(payload, createdBy = null) {
    await delay(320);
    const outletId = String(payload.outlet_id || payload.outletId || "").trim();
    const pinResult = await this.verifyReportPin(payload.report_pin || payload.reportPin || "", createdBy);
    if (!pinResult.valid) {
      throw new Error("PIN laporan tidak valid.");
    }
    if (!outletMap.has(outletId)) {
      throw new Error("Outlet discount tidak ditemukan.");
    }

    const discountPayload = normalizeDiscountPayload({ ...payload, outlet_ids: [outletId] }, null);
    const { outlet_ids: outletIds, ...discountFields } = discountPayload;
    const discount = {
      id: createSequentialId("discount", data.discounts),
      ...discountFields
    };

    data.discounts.push(discount);
    syncDiscountOutlets(discount.id, outletIds);
    createActivityLog({
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
    rebuildIndexes();

    return clone(getDiscountRows().find((item) => item.id === discount.id));
  },

  async updatePosDiscount(discountId, payload, updatedBy = null) {
    await delay(320);
    const outletId = String(payload.outlet_id || payload.outletId || "").trim();
    const pinResult = await this.verifyReportPin(payload.report_pin || payload.reportPin || "", updatedBy);
    if (!pinResult.valid) {
      throw new Error("PIN laporan tidak valid.");
    }
    if (!outletMap.has(outletId)) {
      throw new Error("Outlet discount tidak ditemukan.");
    }

    const discount = data.discounts.find((item) => item.id === discountId);
    if (!discount) {
      throw new Error("Discount tidak ditemukan.");
    }
    if (!discountAppliesToOutlet(discount, outletId)) {
      throw new Error("Discount ini tidak tersedia untuk outlet aktif.");
    }

    const previous = withDiscountOutlets(discount);
    const discountPayload = normalizeDiscountPayload({ ...payload, outlet_ids: [outletId] }, discountId);
    const { outlet_ids: outletIds, ...discountFields } = discountPayload;
    discount.name = discountPayload.name;
    discount.type = discountFields.type;
    discount.value = discountFields.value;
    discount.starts_at = discountFields.starts_at;
    discount.ends_at = discountFields.ends_at;
    discount.status = discountFields.status;
    syncDiscountOutlets(discount.id, outletIds);
    createActivityLog({
      actor_user_id: updatedBy,
      outlet_id: outletId,
      source: "kasir_app",
      module: "discount",
      action: "update_from_kasir",
      entity_type: "discount",
      entity_id: discount.id,
      description: `Kasir memperbarui discount ${discount.name}.`,
      metadata_json: {
        outlet_id: outletId,
        previous: previous
          ? {
              name: previous.name,
              type: previous.type,
              value: previous.value,
              starts_at: previous.starts_at,
              ends_at: previous.ends_at,
              status: previous.status
            }
          : null,
        next: {
          name: discount.name,
          type: discount.type,
          value: discount.value,
          starts_at: discount.starts_at,
          ends_at: discount.ends_at,
          status: discount.status
        }
      }
    });
    rebuildIndexes();

    return clone(getDiscountRows().find((item) => item.id === discountId));
  },

  async createMaterialCategory(payload) {
    await delay(320);
    const nextSortOrder = data.raw_material_categories.reduce((max, category) => Math.max(max, Number(category.sort_order || 0)), 0) + 1;
    const categoryPayload = normalizeMaterialCategoryPayload(payload, null, nextSortOrder);
    const category = {
      id: createSequentialId("raw_mat_cat", data.raw_material_categories),
      ...categoryPayload
    };

    data.raw_material_categories.push(category);
    logEntityActivity("material_category/create", {
      module: "material_category",
      entityType: "raw_material_category",
      entity: category,
      description: `Kategori Harga Pokok Produksi ${category.name} dibuat.`,
      metadata: {
        type: category.type,
        account_code: category.account_code,
        status: category.status
      }
    });
    rebuildIndexes();

    return clone(getMaterialCategoryRows().find((item) => item.id === category.id));
  },

  async getMaterialCategoryDetail(categoryId) {
    await delay();
    const category = getMaterialCategoryRows().find((item) => item.id === categoryId);

    if (!category) {
      throw new Error("Kategori harga pokok produksi tidak ditemukan.");
    }

    return clone(category);
  },

  async updateMaterialCategory(categoryId, payload) {
    await delay(320);
    const category = data.raw_material_categories.find((item) => item.id === categoryId);

    if (!category) {
      throw new Error("Kategori harga pokok produksi tidak ditemukan.");
    }

    const categoryPayload = normalizeMaterialCategoryPayload(payload, categoryId, category.sort_order);
    category.name = categoryPayload.name;
    category.type = categoryPayload.type;
    category.account_code = categoryPayload.account_code;
    category.sort_order = categoryPayload.sort_order;
    category.status = categoryPayload.status;

    data.raw_materials = data.raw_materials.map((material) =>
      material.category_id === categoryId
        ? {
            ...material,
            type: categoryPayload.type,
            account_code: categoryPayload.account_code
          }
        : material
    );
    logEntityActivity("material_category/update", {
      module: "material_category",
      entityType: "raw_material_category",
      entity: category,
      description: `Kategori Harga Pokok Produksi ${category.name} diperbarui.`,
      metadata: {
        type: category.type,
        account_code: category.account_code,
        status: category.status
      }
    });
    rebuildIndexes();

    return clone(getMaterialCategoryRows().find((item) => item.id === categoryId));
  },

  async toggleMaterialCategoryStatus(categoryId) {
    await delay(260);
    const category = data.raw_material_categories.find((item) => item.id === categoryId);

    if (!category) {
      throw new Error("Kategori harga pokok produksi tidak ditemukan.");
    }

    category.status = category.status === "active" ? "inactive" : "active";
    logEntityActivity("material_category/toggle_status", {
      module: "material_category",
      entityType: "raw_material_category",
      entity: category,
      description: `Status kategori Harga Pokok Produksi ${category.name} menjadi ${category.status}.`,
      metadata: { type: category.type, status: category.status }
    });
    rebuildIndexes();

    return clone(getMaterialCategoryRows().find((item) => item.id === categoryId));
  },

  async createProductComposition(payload) {
    await delay(320);
    const compositionPayload = normalizeCompositionPayload(payload);
    const composition = {
      id: createSequentialId("comp", data.product_compositions),
      ...compositionPayload
    };

    data.product_compositions.push(composition);
    logEntityActivity("product_composition/create", {
      module: "product_composition",
      entityType: "product_composition",
      entity: composition,
      description: "Komposisi produk dibuat.",
      metadata: {
        product_id: composition.product_id,
        material_id: composition.material_id,
        quantity: composition.quantity,
        unit: composition.unit
      }
    });
    rebuildIndexes();

    return clone(getCompositionRows().find((item) => item.id === composition.id));
  },

  async updateProductComposition(compositionId, payload) {
    await delay(320);
    const composition = data.product_compositions.find((item) => item.id === compositionId);

    if (!composition) {
      throw new Error("Komposisi produk tidak ditemukan.");
    }

    const compositionPayload = normalizeCompositionPayload(payload, compositionId);
    composition.product_id = compositionPayload.product_id;
    composition.material_id = compositionPayload.material_id;
    composition.quantity = compositionPayload.quantity;
    composition.unit = compositionPayload.unit;
    logEntityActivity("product_composition/update", {
      module: "product_composition",
      entityType: "product_composition",
      entity: composition,
      description: "Komposisi produk diperbarui.",
      metadata: {
        product_id: composition.product_id,
        material_id: composition.material_id,
        quantity: composition.quantity,
        unit: composition.unit
      }
    });
    rebuildIndexes();

    return clone(getCompositionRows().find((item) => item.id === compositionId));
  },

  async deleteProductComposition(compositionId) {
    await delay(260);
    const composition = data.product_compositions.find((item) => item.id === compositionId);

    if (!composition) {
      throw new Error("Komposisi produk tidak ditemukan.");
    }

    data.product_compositions = data.product_compositions.filter((item) => item.id !== compositionId);
    logEntityActivity("product_composition/delete", {
      module: "product_composition",
      entityType: "product_composition",
      entity: composition,
      description: "Komposisi produk dihapus.",
      metadata: {
        product_id: composition.product_id,
        material_id: composition.material_id,
        quantity: composition.quantity,
        unit: composition.unit
      }
    });
    rebuildIndexes();

    return clone(composition);
  },

  async createRecord(entity, payload) {
    await delay(420);
    const record = {
      id: `${entity}_${Date.now()}`,
      ...payload,
      status: payload.status || "active"
    };
    logEntityActivity(`${entity}/create_record`, {
      module: entity,
      entityType: entity,
      entity: record,
      description: `Record ${entity} dibuat.`,
      metadata: { status: record.status }
    });
    return clone(record);
  },

  async getProductDetail(productId) {
    await delay();
    const product = getProductRows("all").find((item) => item.id === productId);

    if (!product) {
      throw new Error("Produk tidak ditemukan.");
    }

    return clone(product);
  },

  async createProduct(payload) {
    await delay(420);
    const sku = generateProductSku(payload.category_id);
    const name = String(payload.name || "").trim();

    if (!name || !payload.category_id || !categoryMap.has(payload.category_id)) {
      throw new Error("Nama produk dan kategori wajib diisi.");
    }

    if (data.products.some((product) => product.sku.toLowerCase() === sku.toLowerCase())) {
      throw new Error("SKU otomatis gagal dibuat unik.");
    }

    const productId = createSequentialId("product", data.products);
    const product = {
      id: productId,
      category_id: payload.category_id,
      sku,
      name,
      image_url: null,
      image_path: null,
      status: payload.status || "active"
    };

    data.products.push(product);

    const nextPriceId = createIdGenerator("price", data.product_prices);
    const priceRows = (payload.prices || [])
      .filter((price) => price.outlet_id && outletMap.has(price.outlet_id) && Number(price.price || 0) > 0)
      .map((price) => ({
        id: nextPriceId(),
        product_id: productId,
        outlet_id: price.outlet_id,
        price: Number(price.price || 0),
        status: price.status || "active"
      }));

    data.product_prices.push(...priceRows);

    const nextCompositionId = createIdGenerator("comp", data.product_compositions);
    const compositionRows = (payload.composition || [])
      .filter((item) => item.material_id && Number(item.quantity) > 0)
      .map((item) => {
        const material = materialMap.get(item.material_id);
        return {
          id: nextCompositionId(),
          product_id: productId,
          material_id: item.material_id,
          quantity: Number(item.quantity),
          unit: item.unit || material?.unit || ""
        };
      });

    data.product_compositions.push(...compositionRows);
    data.product_variants.push(...normalizeProductVariantsPayload(productId, payload.variants || []));
    logEntityActivity("product/create", {
      module: "product",
      entityType: "product",
      entity: product,
      description: `Produk ${product.name} dibuat.`,
      metadata: {
        sku: product.sku,
        category_id: product.category_id,
        price_count: priceRows.length,
        composition_count: compositionRows.length,
        variant_count: (payload.variants || []).length,
        status: product.status
      }
    });
    rebuildIndexes();

    return clone(getProductRows("all").find((item) => item.id === productId));
  },

  async updateProduct(productId, payload) {
    await delay(420);
    const product = data.products.find((item) => item.id === productId);

    if (!product) {
      throw new Error("Produk tidak ditemukan.");
    }

    const name = String(payload.name || "").trim();

    if (!name || !payload.category_id || !categoryMap.has(payload.category_id)) {
      throw new Error("Nama produk dan kategori wajib diisi.");
    }

    product.name = name;
    product.category_id = payload.category_id;
    product.status = payload.status || "active";

    const existingPrices = data.product_prices.filter((price) => price.product_id === productId);
    const existingPriceByOutlet = new Map(existingPrices.map((price) => [price.outlet_id, price]));
    const nextPriceId = createIdGenerator("price", data.product_prices);

    const nextPrices = (payload.prices || [])
      .filter((price) => price.outlet_id && outletMap.has(price.outlet_id) && Number(price.price || 0) > 0)
      .map((price) => {
        const existingPrice = existingPriceByOutlet.get(price.outlet_id);
        return {
          id: existingPrice?.id || nextPriceId(),
          product_id: productId,
          outlet_id: price.outlet_id,
          price: Number(price.price || 0),
          status: price.status || "active"
        };
      });

    data.product_prices = [...data.product_prices.filter((price) => price.product_id !== productId), ...nextPrices];

    data.product_compositions = data.product_compositions.filter((item) => item.product_id !== productId);
    const nextCompositionId = createIdGenerator("comp", data.product_compositions);
    const nextComposition = (payload.composition || [])
      .filter((item) => item.material_id && Number(item.quantity) > 0)
      .map((item) => {
        const material = materialMap.get(item.material_id);
        return {
          id: nextCompositionId(),
          product_id: productId,
          material_id: item.material_id,
          quantity: Number(item.quantity),
          unit: item.unit || material?.unit || ""
        };
      });

    data.product_compositions.push(...nextComposition);
    data.product_variants = [...data.product_variants.filter((variant) => variant.product_id !== productId), ...normalizeProductVariantsPayload(productId, payload.variants || [])];
    logEntityActivity("product/update", {
      module: "product",
      entityType: "product",
      entity: product,
      description: `Produk ${product.name} diperbarui.`,
      metadata: {
        sku: product.sku,
        category_id: product.category_id,
        price_count: nextPrices.length,
        composition_count: nextComposition.length,
        variant_count: (payload.variants || []).length,
        status: product.status
      }
    });
    rebuildIndexes();

    return clone(getProductRows("all").find((item) => item.id === productId));
  },

  async toggleProductStatus(productId) {
    await delay(260);
    const product = data.products.find((item) => item.id === productId);

    if (!product) {
      throw new Error("Produk tidak ditemukan.");
    }

    product.status = product.status === "active" ? "inactive" : "active";
    logEntityActivity("product/toggle_status", {
      module: "product",
      entityType: "product",
      entity: product,
      description: `Status produk ${product.name} menjadi ${product.status}.`,
      metadata: { sku: product.sku, status: product.status }
    });
    rebuildIndexes();

    return clone(getProductRows("all").find((item) => item.id === productId));
  },

  async uploadProductImage(productId, file) {
    await delay(220);
    const product = data.products.find((item) => item.id === productId);

    if (!product) {
      if (file?.path) deleteLocalProductImage(file.path);
      throw new Error("Produk tidak ditemukan.");
    }

    if (product.image_path) {
      deleteLocalProductImage(product.image_path);
    }

    product.image_url = productImageUrlFromFile(file);
    product.image_path = path.relative(process.cwd(), file.path);
    logEntityActivity("product/upload_image", {
      module: "product",
      entityType: "product",
      entity: product,
      description: `Gambar produk ${product.name} diupload.`,
      metadata: { image_url: product.image_url }
    });
    rebuildIndexes();

    return clone(getProductRows("all").find((item) => item.id === productId));
  },

  async deleteProductImage(productId) {
    await delay(180);
    const product = data.products.find((item) => item.id === productId);

    if (!product) {
      throw new Error("Produk tidak ditemukan.");
    }

    if (product.image_path) {
      deleteLocalProductImage(product.image_path);
    }

    product.image_url = null;
    product.image_path = null;
    logEntityActivity("product/delete_image", {
      module: "product",
      entityType: "product",
      entity: product,
      description: `Gambar produk ${product.name} dihapus.`
    });
    rebuildIndexes();

    return clone(getProductRows("all").find((item) => item.id === productId));
  },

  async createMaterial(payload) {
    await delay(360);
    const name = String(payload.name || "").trim();
    const unit = String(payload.unit || "").trim();
    const lowStockThreshold = Number(payload.low_stock_threshold || 0);
    const type = String(payload.type || "hpp").trim();
    const categoryId = payload.category_id || data.raw_material_categories.find((category) => category.type === type)?.id;
    const category = materialCategoryMap.get(categoryId);
    const accountCode = String(category?.account_code || (type === "biaya" ? "6000" : "5002")).trim();

    if (!name || !unit || lowStockThreshold < 0 || !["hpp", "biaya"].includes(type) || !category || category.type !== type) {
      throw new Error("Nama, unit, type, kategori, dan threshold harga pokok produksi wajib valid.");
    }
    requireFinancialAccount(accountCode, [type === "biaya" ? "expense" : "cogs"]);

    if (data.raw_materials.some((material) => material.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("Nama harga pokok produksi sudah digunakan.");
    }

    const materialId = createSequentialId("material", data.raw_materials);
    const material = {
      id: materialId,
      name,
      unit,
      type,
      category_id: categoryId,
      account_code: accountCode,
      low_stock_threshold: lowStockThreshold,
      status: payload.status || "active"
    };

    data.raw_materials.push(material);

    logEntityActivity("material/create", {
      module: "material",
      entityType: "raw_material",
      entity: material,
      description: `Harga Pokok Produksi ${material.name} dibuat.`,
      metadata: {
        type: material.type,
        category_id: material.category_id,
        account_code: material.account_code,
        unit: material.unit,
        status: material.status
      }
    });
    rebuildIndexes();

    return clone(getMaterialRows().find((item) => item.id === materialId));
  },

  async updateMaterial(materialId, payload) {
    await delay(360);
    const material = data.raw_materials.find((item) => item.id === materialId);

    if (!material) {
      throw new Error("Harga Pokok Produksi tidak ditemukan.");
    }

    const name = String(payload.name || "").trim();
    const unit = String(payload.unit || "").trim();
    const lowStockThreshold = Number(payload.low_stock_threshold || 0);
    const type = String(payload.type || material.type || "hpp").trim();
    const categoryId = payload.category_id || material.category_id || data.raw_material_categories.find((category) => category.type === type)?.id;
    const category = materialCategoryMap.get(categoryId);
    const accountCode = String(category?.account_code || (type === "biaya" ? "6000" : "5002")).trim();

    if (!name || !unit || lowStockThreshold < 0 || !["hpp", "biaya"].includes(type) || !category || category.type !== type) {
      throw new Error("Nama, unit, type, kategori, dan threshold harga pokok produksi wajib valid.");
    }
    requireFinancialAccount(accountCode, [type === "biaya" ? "expense" : "cogs"]);

    if (data.raw_materials.some((item) => item.id !== materialId && item.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("Nama harga pokok produksi sudah digunakan.");
    }

    material.name = name;
    material.unit = unit;
    material.type = type;
    material.category_id = categoryId;
    material.account_code = accountCode;
    material.low_stock_threshold = lowStockThreshold;
    material.status = payload.status || "active";

    data.raw_material_stocks = data.raw_material_stocks.map((stock) => (stock.material_id === materialId ? { ...stock, unit } : stock));
    data.product_compositions = data.product_compositions.map((composition) => (composition.material_id === materialId ? { ...composition, unit } : composition));

    logEntityActivity("material/update", {
      module: "material",
      entityType: "raw_material",
      entity: material,
      description: `Harga Pokok Produksi ${material.name} diperbarui.`,
      metadata: {
        type: material.type,
        category_id: material.category_id,
        account_code: material.account_code,
        unit: material.unit,
        status: material.status
      }
    });
    rebuildIndexes();

    return clone(getMaterialRows().find((item) => item.id === materialId));
  },

  async toggleMaterialStatus(materialId) {
    await delay(260);
    const material = data.raw_materials.find((item) => item.id === materialId);

    if (!material) {
      throw new Error("Harga Pokok Produksi tidak ditemukan.");
    }

    material.status = material.status === "active" ? "inactive" : "active";
    logEntityActivity("material/toggle_status", {
      module: "material",
      entityType: "raw_material",
      entity: material,
      description: `Status Harga Pokok Produksi ${material.name} menjadi ${material.status}.`,
      metadata: { type: material.type, status: material.status }
    });
    rebuildIndexes();

    return clone(getMaterialRows().find((item) => item.id === materialId));
  },

  async createUnit(payload) {
    await delay(320);
    const name = String(payload.name || "").trim();
    const code = String(payload.code || name).trim();

    if (!name || !code) {
      throw new Error("Nama dan kode unit wajib diisi.");
    }

    if (units.some((unit) => unit.code.toLowerCase() === code.toLowerCase())) {
      throw new Error("Kode unit sudah digunakan.");
    }

    const unit = {
      id: createSequentialId("unit", units),
      name,
      code,
      status: payload.status || "active"
    };

    units.push(unit);
    data.units = units;
    logEntityActivity("unit/create", {
      module: "unit",
      entityType: "unit",
      entity: unit,
      description: `Unit ${unit.name} dibuat.`,
      metadata: { code: unit.code, status: unit.status }
    });

    return clone(getUnitRows().find((item) => item.id === unit.id));
  },

  async updateUnit(unitId, payload) {
    await delay(320);
    const unit = units.find((item) => item.id === unitId);

    if (!unit) {
      throw new Error("Unit tidak ditemukan.");
    }

    const name = String(payload.name || "").trim();
    const code = String(payload.code || name).trim();

    if (!name || !code) {
      throw new Error("Nama dan kode unit wajib diisi.");
    }

    if (units.some((item) => item.id !== unitId && item.code.toLowerCase() === code.toLowerCase())) {
      throw new Error("Kode unit sudah digunakan.");
    }

    const previousCode = unit.code;
    unit.name = name;
    unit.code = code;
    unit.status = payload.status || "active";
    data.units = units;

    if (previousCode !== code) {
      data.raw_materials = data.raw_materials.map((material) => (material.unit === previousCode ? { ...material, unit: code } : material));
      data.raw_material_stocks = data.raw_material_stocks.map((stock) => (stock.unit === previousCode ? { ...stock, unit: code } : stock));
      data.product_compositions = data.product_compositions.map((composition) => (composition.unit === previousCode ? { ...composition, unit: code } : composition));
      rebuildIndexes();
    }
    logEntityActivity("unit/update", {
      module: "unit",
      entityType: "unit",
      entity: unit,
      description: `Unit ${unit.name} diperbarui.`,
      metadata: {
        previous_code: previousCode,
        code: unit.code,
        status: unit.status
      }
    });

    return clone(getUnitRows().find((item) => item.id === unitId));
  },

  async toggleUnitStatus(unitId) {
    await delay(260);
    const unit = units.find((item) => item.id === unitId);

    if (!unit) {
      throw new Error("Unit tidak ditemukan.");
    }

    unit.status = unit.status === "active" ? "inactive" : "active";
    data.units = units;
    logEntityActivity("unit/toggle_status", {
      module: "unit",
      entityType: "unit",
      entity: unit,
      description: `Status unit ${unit.name} menjadi ${unit.status}.`,
      metadata: { code: unit.code, status: unit.status }
    });

    return clone(getUnitRows().find((item) => item.id === unitId));
  },

  async getSupplierDetail(supplierId) {
    await delay();
    const supplier = getSupplierRows().find((item) => item.id === supplierId);

    if (!supplier) {
      throw new Error("Supplier tidak ditemukan.");
    }

    return clone(supplier);
  },

  async createSupplier(payload) {
    await delay(320);
    const name = String(payload.name || "").trim();
    const phone = String(payload.phone || "").trim();
    const status = payload.status || "active";

    if (!name || phone.length < 6) {
      throw new Error("Nama supplier dan nomor telepon wajib diisi.");
    }

    if (!["active", "inactive"].includes(status)) {
      throw new Error("Status supplier tidak valid.");
    }

    if (data.suppliers.some((supplier) => supplier.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("Nama supplier sudah digunakan.");
    }

    const supplier = {
      id: createSequentialId("supplier", data.suppliers),
      name,
      phone,
      status
    };

    data.suppliers.push(supplier);
    logEntityActivity("supplier/create", {
      module: "supplier",
      entityType: "supplier",
      entity: supplier,
      description: `Supplier ${supplier.name} dibuat.`,
      metadata: { phone: supplier.phone, status: supplier.status }
    });
    rebuildIndexes();

    return clone(getSupplierRows().find((item) => item.id === supplier.id));
  },

  async updateSupplier(supplierId, payload) {
    await delay(320);
    const supplier = data.suppliers.find((item) => item.id === supplierId);

    if (!supplier) {
      throw new Error("Supplier tidak ditemukan.");
    }

    const name = String(payload.name || "").trim();
    const phone = String(payload.phone || "").trim();
    const status = payload.status || "active";

    if (!name || phone.length < 6) {
      throw new Error("Nama supplier dan nomor telepon wajib diisi.");
    }

    if (!["active", "inactive"].includes(status)) {
      throw new Error("Status supplier tidak valid.");
    }

    if (data.suppliers.some((item) => item.id !== supplierId && item.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("Nama supplier sudah digunakan.");
    }

    supplier.name = name;
    supplier.phone = phone;
    supplier.status = status;
    logEntityActivity("supplier/update", {
      module: "supplier",
      entityType: "supplier",
      entity: supplier,
      description: `Supplier ${supplier.name} diperbarui.`,
      metadata: { phone: supplier.phone, status: supplier.status }
    });
    rebuildIndexes();

    return clone(getSupplierRows().find((item) => item.id === supplierId));
  },

  async toggleSupplierStatus(supplierId) {
    await delay(260);
    const supplier = data.suppliers.find((item) => item.id === supplierId);

    if (!supplier) {
      throw new Error("Supplier tidak ditemukan.");
    }

    supplier.status = supplier.status === "active" ? "inactive" : "active";
    logEntityActivity("supplier/toggle_status", {
      module: "supplier",
      entityType: "supplier",
      entity: supplier,
      description: `Status supplier ${supplier.name} menjadi ${supplier.status}.`,
      metadata: { status: supplier.status }
    });
    rebuildIndexes();

    return clone(getSupplierRows().find((item) => item.id === supplierId));
  },

  async createPurchase(payload) {
    await delay(420);
    const purchasePayload = normalizePurchasePayload(payload, {
      source: payload.source || "admin_web",
      defaultStatus: payload.status || "pending"
    });
    const duplicate = purchasePayload.batch_id ? data.purchases.find((item) => item.batch_id === purchasePayload.batch_id) : null;
    if (duplicate) return clone(getPurchaseRows("all").find((item) => item.id === duplicate.id));

    const purchase = {
      id: createSequentialId("purchase", data.purchases),
      ...purchasePayload
    };

    data.purchases.unshift(purchase);
    if (purchase.status === "approved") {
      applyApprovedPurchaseStock(purchase);
    }
    createActivityLog({
      actor_user_id: purchase.created_by,
      outlet_id: purchase.outlet_id,
      source: purchase.source,
      module: "purchase",
      action: "create_batch",
      entity_type: "purchase",
      entity_id: purchase.id,
      description: `Pembelian harga pokok produksi ${purchase.status}`,
      metadata: {
        total: purchase.total,
        item_count: purchase.items.length,
        payment_type: purchase.payment_type
      }
    });
    rebuildIndexes();

    return clone(getPurchaseRows("all").find((item) => item.id === purchase.id));
  },

  async createPosPurchaseBatch(payload, createdBy) {
    await delay(300);
    return this.createPurchase({
      ...payload,
      source: "kasir_app",
      status: "pending",
      created_by: createdBy
    });
  },

  async updatePosPurchaseBatch(purchaseId, payload = {}, updatedBy) {
    await delay(300);
    const purchase = data.purchases.find((item) => item.id === purchaseId);
    if (!purchase) throw new Error("Pembelian tidak ditemukan.");
    if (purchase.status !== "pending") {
      throw new Error("Pembelian sudah diproses admin dan tidak bisa diedit dari APK.");
    }
    return this.updatePurchase(purchaseId, {
      ...payload,
      outlet_id: purchase.outlet_id,
      outletId: purchase.outlet_id,
      source: purchase.source || "kasir_app",
      status: "pending",
      updated_by: updatedBy,
      activity_source: "kasir_app"
    });
  },

  async updatePurchase(purchaseId, payload = {}) {
    await delay(420);
    const purchase = data.purchases.find((item) => item.id === purchaseId);
    if (!purchase) throw new Error("Pembelian tidak ditemukan.");

    const previousStatus = purchase.status;
    const previousTotal = Number(purchase.total || 0);
    const normalized = normalizePurchasePayload(
      {
        ...payload,
        source: purchase.source || payload.source || "admin_web",
        status: previousStatus === "rejected" ? "pending" : previousStatus,
        batch_id: purchase.batch_id || payload.batch_id || payload.batchId || null,
        created_by: purchase.created_by || payload.created_by || payload.createdBy || null
      },
      {
        source: purchase.source || "admin_web",
        defaultStatus: previousStatus === "rejected" ? "pending" : previousStatus
      }
    );

    if (previousStatus === "approved") {
      reverseApprovedPurchaseStock(purchase);
    }

    purchase.outlet_id = normalized.outlet_id;
    purchase.supplier_id = normalized.supplier_id;
    purchase.purchase_date = normalized.purchase_date;
    purchase.status = normalized.status;
    purchase.payment_type = normalized.payment_type;
    purchase.source = normalized.source;
    purchase.batch_id = normalized.batch_id;
    purchase.note = normalized.note;
    purchase.total = normalized.total;
    purchase.items = normalized.items;
    purchase.updated_by = payload.updated_by || payload.updatedBy || null;
    purchase.updated_at = new Date().toISOString();

    if (previousStatus === "rejected") {
      purchase.rejection_note = "";
      purchase.rejected_by = null;
      purchase.rejected_at = null;
    }

    if (purchase.status === "approved") {
      applyApprovedPurchaseStock(purchase);
    }
    refreshMaterialLastPurchasePrices();
    createActivityLog({
      actor_user_id: purchase.updated_by,
      outlet_id: purchase.outlet_id,
      source: payload.activity_source || "admin_web",
      module: "purchase",
      action: "update",
      entity_type: "purchase",
      entity_id: purchase.id,
      description: payload.activity_source === "kasir_app" ? "Kasir edit pembelian harga pokok produksi" : "Admin edit pembelian harga pokok produksi",
      metadata_json: {
        previous_status: previousStatus,
        next_status: purchase.status,
        previous_total: previousTotal,
        next_total: purchase.total,
        item_count: purchase.items.length
      }
    });
    rebuildIndexes();

    return clone(getPurchaseRows("all").find((item) => item.id === purchase.id));
  },

  async getPosMaterialStocks({ outletIds = "", materialIds = "" } = {}) {
    await delay(180);
    const outletIdList = parsePosQueryList(outletIds).filter((outletId) => outletMap.has(outletId));
    const materialIdList = parsePosQueryList(materialIds);
    const activeMaterialIds = (materialIdList.length ? materialIdList : data.raw_materials.map((material) => material.id)).filter((materialId) => materialMap.has(materialId)).filter((materialId) => materialMap.get(materialId)?.status !== "inactive");

    return clone(outletIdList.flatMap((outletId) => activeMaterialIds.map((materialId) => buildPosMaterialStockSnapshot(materialId, outletId))));
  },

  async getPosProductFavorites({ outletId } = {}, userId) {
    await delay(120);
    const productIds = (data.pos_product_favorites || [])
      .filter((favorite) => favorite.user_id === userId && favorite.outlet_id === outletId)
      .map((favorite) => favorite.product_id)
      .filter((productId) => {
        const product = productMap.get(productId);
        if (!product || product.status === "inactive") return false;
        return (data.product_prices || []).some((price) => price.product_id === productId && price.outlet_id === outletId && price.status !== "inactive" && Number(price.price || 0) > 0);
      });

    return clone({
      outlet_id: outletId,
      product_ids: [...new Set(productIds)]
    });
  },

  async updatePosProductFavorites(payload = {}, userId) {
    await delay(220);
    const outletId = payload.outlet_id || payload.outletId;
    const user = userMap.get(userId);
    const outlet = outletMap.get(outletId);
    if (!user || user.status === "inactive") throw new Error("User kasir tidak valid.");
    if (!outlet || outlet.status === "inactive") throw new Error("Outlet tidak valid.");

    const allowedOutletIds = getUserOutletIds(userId);
    if (!allowedOutletIds.includes(outletId)) throw new Error("Outlet tidak tersedia untuk user ini.");

    const submittedIds = [...new Set((payload.product_ids || payload.productIds || []).map((id) => String(id)))];
    const validProductIds = [];
    for (const productId of submittedIds) {
      const product = productMap.get(productId);
      const hasActivePrice = (data.product_prices || []).some((price) => price.product_id === productId && price.outlet_id === outletId && price.status !== "inactive" && Number(price.price || 0) > 0);
      if (!product || product.status === "inactive" || !hasActivePrice) {
        throw new Error("Produk favorit harus aktif dan tersedia di outlet ini.");
      }
      validProductIds.push(productId);
    }

    data.pos_product_favorites = (data.pos_product_favorites || []).filter((favorite) => !(favorite.user_id === userId && favorite.outlet_id === outletId));
    const now = new Date().toISOString();
    validProductIds.forEach((productId) => {
      data.pos_product_favorites.push({
        user_id: userId,
        outlet_id: outletId,
        product_id: productId,
        created_at: now
      });
    });
    createActivityLog({
      actor_user_id: userId,
      outlet_id: outletId,
      source: "kasir_app",
      module: "product_favorite",
      action: "update",
      entity_type: "product_favorite",
      entity_id: outletId,
      description: "Kasir memperbarui favorit produk.",
      metadata: { count: validProductIds.length }
    });
    rebuildIndexes();
    return clone({ outlet_id: outletId, product_ids: validProductIds });
  },

  async getPosPurchases({ outletId = "all", from, to, status } = {}) {
    await delay(220);
    return clone(
      getPurchaseRows(outletId)
        .filter((purchase) => (!status || purchase.status === status) && withinDateRange(purchase.purchase_date, from, to))
        .sort((a, b) => new Date(b.purchase_date) - new Date(a.purchase_date))
    );
  },

  async approvePurchase(purchaseId, payload = {}) {
    await delay(320);
    const purchase = data.purchases.find((item) => item.id === purchaseId);
    if (!purchase) throw new Error("Pembelian tidak ditemukan.");
    if (purchase.status !== "pending") throw new Error("Hanya pembelian pending yang bisa di-approve.");

    purchase.status = "approved";
    purchase.approved_by = payload.approved_by || payload.approvedBy || null;
    purchase.approved_at = new Date().toISOString();
    applyApprovedPurchaseStock(purchase);
    createActivityLog({
      actor_user_id: purchase.approved_by,
      outlet_id: purchase.outlet_id,
      source: "admin_web",
      module: "purchase",
      action: "approve",
      entity_type: "purchase",
      entity_id: purchase.id,
      description: "Admin approve pembelian harga pokok produksi",
      metadata: { total: purchase.total, item_count: purchase.items.length }
    });
    rebuildIndexes();
    return clone(getPurchaseRows("all").find((item) => item.id === purchase.id));
  },

  async rejectPurchase(purchaseId, payload = {}) {
    await delay(320);
    const purchase = data.purchases.find((item) => item.id === purchaseId);
    if (!purchase) throw new Error("Pembelian tidak ditemukan.");
    if (purchase.status !== "pending") throw new Error("Hanya pembelian pending yang bisa di-reject.");

    const rejectionNote = String(payload.rejection_note || payload.rejectionNote || "").trim();
    if (!rejectionNote) throw new Error("Alasan reject pembelian wajib diisi.");

    purchase.status = "rejected";
    purchase.rejection_note = rejectionNote;
    purchase.rejected_by = payload.approved_by || payload.rejected_by || payload.rejectedBy || null;
    purchase.rejected_at = new Date().toISOString();
    createActivityLog({
      actor_user_id: purchase.rejected_by,
      outlet_id: purchase.outlet_id,
      source: "admin_web",
      module: "purchase",
      action: "reject",
      entity_type: "purchase",
      entity_id: purchase.id,
      description: "Admin reject pembelian harga pokok produksi",
      metadata: { total: purchase.total, reason: rejectionNote }
    });
    rebuildIndexes();
    return clone(getPurchaseRows("all").find((item) => item.id === purchase.id));
  },

  async createStockTransfer(payload) {
    await delay(420);
    const transferPayload = normalizeTransferPayload(payload, {
      createdBy: payload.requested_by || payload.requestedBy,
      source: payload.source || "admin_web",
      defaultStatus: payload.status || "pending"
    });
    const duplicate = transferPayload.batch_id ? data.stock_transfers.find((item) => item.batch_id === transferPayload.batch_id) : null;
    if (duplicate) return clone(getTransferRows("all").find((item) => item.id === duplicate.id));

    const transfer = {
      id: createSequentialId("transfer", data.stock_transfers),
      ...transferPayload
    };

    data.stock_transfers.unshift(transfer);
    if (transfer.status === "approved") {
      for (const item of transfer.items || []) {
        const material = materialMap.get(item.material_id);
        const fromStock = ensureStockRow(transfer.from_outlet_id, item.material_id);
        const toStock = ensureStockRow(transfer.to_outlet_id, item.material_id);
        const quantity = Number(item.quantity || 0);
        if (Number(fromStock.quantity || 0) < quantity) {
          throw new Error("Stok outlet asal tidak mencukupi.");
        }
        fromStock.quantity = Number((Number(fromStock.quantity || 0) - quantity).toFixed(3));
        toStock.quantity = Number((Number(toStock.quantity || 0) + quantity).toFixed(3));
        fromStock.unit = material?.unit || item.unit;
        toStock.unit = material?.unit || item.unit;
      }
      transfer.approved_by = payload.approved_by || data.users[0]?.id;
    }
    const createAction = transfer.loan_return_for_transfer_id ? "create_loan_return" : normalizeTransferType(transfer.transfer_type) === "loan" ? "create_loan" : "create_request";
    createActivityLog({
      actor_user_id: transfer.requested_by,
      outlet_id: transfer.from_outlet_id,
      source: transfer.source,
      module: "transfer",
      action: createAction,
      entity_type: "stock_transfer",
      entity_id: transfer.id,
      description: transfer.loan_return_for_transfer_id ? "Kasir input pengembalian pinjaman harga pokok produksi" : normalizeTransferType(transfer.transfer_type) === "loan" ? "Kasir input pinjaman harga pokok produksi" : "Kasir input request transfer harga pokok produksi",
      metadata_json: {
        item_count: transfer.items.length,
        from_outlet_id: transfer.from_outlet_id,
        to_outlet_id: transfer.to_outlet_id,
        transfer_type: normalizeTransferType(transfer.transfer_type),
        loan_return_for_transfer_id: transfer.loan_return_for_transfer_id || null
      }
    });
    rebuildIndexes();

    return clone(getTransferRows("all").find((item) => item.id === transfer.id));
  },

  async createPosTransferRequest(payload, createdBy) {
    await delay(300);
    return this.createStockTransfer({
      ...payload,
      source: "kasir_app",
      status: "pending",
      requested_by: createdBy
    });
  },

  async getPosTransfers({ outletId = "all", from, to, status } = {}) {
    await delay(220);
    return clone(
      getTransferRows(outletId)
        .filter((transfer) => (!status || transfer.status === status) && withinDateRange(transfer.transfer_date, from, to))
        .sort((a, b) => new Date(b.transfer_date) - new Date(a.transfer_date))
    );
  },

  async updateStockTransfer(transferId, payload = {}) {
    await delay(360);
    const transfer = data.stock_transfers.find((item) => item.id === transferId);

    if (!transfer) throw new Error("Transfer stok tidak ditemukan.");
    if (transfer.status !== "pending") throw new Error("Hanya transfer pending yang bisa diedit.");

    const previous = {
      from_outlet_id: transfer.from_outlet_id,
      to_outlet_id: transfer.to_outlet_id,
      item_count: transfer.items?.length || 0
    };
    const transferPayload = normalizeTransferPayload(
      {
        ...payload,
        id: transfer.id,
        status: "pending",
        source: transfer.source,
        requested_by: transfer.requested_by,
        batch_id: transfer.batch_id,
        loan_return_for_transfer_id: transfer.loan_return_for_transfer_id || payload.loan_return_for_transfer_id || payload.loanReturnForTransferId || null
      },
      {
        createdBy: transfer.requested_by,
        source: transfer.source || "admin_web",
        defaultStatus: "pending"
      }
    );

    transfer.from_outlet_id = transferPayload.from_outlet_id;
    transfer.to_outlet_id = transferPayload.to_outlet_id;
    transfer.transfer_type = transferPayload.transfer_type;
    transfer.loan_return_for_transfer_id = transferPayload.loan_return_for_transfer_id;
    transfer.transfer_date = transferPayload.transfer_date;
    transfer.note = transferPayload.note;
    transfer.items = transferPayload.items;
    transfer.status = "pending";
    transfer.rejection_note = "";

    createActivityLog({
      actor_user_id: payload.updated_by || payload.updatedBy || data.users[0]?.id,
      outlet_id: transfer.from_outlet_id,
      source: "admin_web",
      module: "transfer",
      action: "update",
      entity_type: "stock_transfer",
      entity_id: transfer.id,
      description: "Admin edit transfer harga pokok produksi",
      metadata_json: {
        previous,
        next: {
          from_outlet_id: transfer.from_outlet_id,
          to_outlet_id: transfer.to_outlet_id,
          transfer_type: normalizeTransferType(transfer.transfer_type),
          loan_return_for_transfer_id: transfer.loan_return_for_transfer_id || null,
          item_count: transfer.items?.length || 0
        }
      }
    });
    rebuildIndexes();

    return clone(getTransferRows("all").find((item) => item.id === transfer.id));
  },

  async approveStockTransfer(transferId, payload = {}) {
    await delay(360);
    const transfer = data.stock_transfers.find((item) => item.id === transferId);

    if (!transfer) throw new Error("Transfer stok tidak ditemukan.");
    if (transfer.status !== "pending") throw new Error("Transfer stok sudah diproses.");
    if (transfer.loan_return_for_transfer_id) {
      validateLoanReturn({
        loanTransferId: transfer.loan_return_for_transfer_id,
        fromOutletId: transfer.from_outlet_id,
        toOutletId: transfer.to_outlet_id,
        items: transfer.items || [],
        excludeTransferId: transfer.id,
        includePending: false
      });
    }

    for (const item of transfer.items || []) {
      const material = materialMap.get(item.material_id);
      const fromStock = ensureStockRow(transfer.from_outlet_id, item.material_id);
      const toStock = ensureStockRow(transfer.to_outlet_id, item.material_id);
      const quantity = Number(item.quantity || 0);
      if (Number(fromStock.quantity || 0) < quantity) {
        throw new Error("Stok outlet asal tidak mencukupi.");
      }
      fromStock.quantity = Number((Number(fromStock.quantity || 0) - quantity).toFixed(3));
      toStock.quantity = Number((Number(toStock.quantity || 0) + quantity).toFixed(3));
      fromStock.unit = material?.unit || item.unit;
      toStock.unit = material?.unit || item.unit;
    }

    transfer.status = "approved";
    transfer.approved_by = payload.approved_by || data.users[0]?.id;
    const approveAction = transfer.loan_return_for_transfer_id ? "loan_return_approved" : "approve";
    createActivityLog({
      actor_user_id: transfer.approved_by,
      outlet_id: transfer.to_outlet_id,
      source: "admin_web",
      module: "transfer",
      action: approveAction,
      entity_type: "stock_transfer",
      entity_id: transfer.id,
      description: transfer.loan_return_for_transfer_id ? "Admin approve pengembalian pinjaman harga pokok produksi" : "Admin approve transfer harga pokok produksi",
      metadata_json: {
        item_count: transfer.items?.length || 0,
        from_outlet_id: transfer.from_outlet_id,
        to_outlet_id: transfer.to_outlet_id,
        transfer_type: normalizeTransferType(transfer.transfer_type),
        loan_return_for_transfer_id: transfer.loan_return_for_transfer_id || null
      }
    });
    rebuildIndexes();

    return clone(getTransferRows("all").find((item) => item.id === transfer.id));
  },

  async rejectStockTransfer(transferId, payload = {}) {
    await delay(300);
    const transfer = data.stock_transfers.find((item) => item.id === transferId);

    if (!transfer) throw new Error("Transfer stok tidak ditemukan.");
    if (transfer.status !== "pending") throw new Error("Transfer stok sudah diproses.");

    transfer.status = "rejected";
    transfer.approved_by = payload.approved_by || data.users[0]?.id;
    transfer.rejection_note = payload.note || payload.rejection_note || "";
    createActivityLog({
      actor_user_id: transfer.approved_by,
      outlet_id: transfer.to_outlet_id,
      source: "admin_web",
      module: "transfer",
      action: "reject",
      entity_type: "stock_transfer",
      entity_id: transfer.id,
      description: "Admin reject transfer harga pokok produksi",
      metadata_json: {
        reason: transfer.rejection_note,
        item_count: transfer.items?.length || 0
      }
    });
    rebuildIndexes();

    return clone(getTransferRows("all").find((item) => item.id === transfer.id));
  },

  async createStockOpname(payload) {
    await delay(420);
    const outletId = payload.outlet_id;
    const materialId = payload.material_id;
    const actualQuantity = Number(payload.actual_quantity);
    const material = materialMap.get(materialId);

    if (!outletMap.has(outletId) || !material || Number.isNaN(actualQuantity) || actualQuantity < 0) {
      throw new Error("Outlet, produk, dan qty fisik wajib valid.");
    }

    const stock = ensureStockRow(outletId, materialId);
    const systemQuantity = Number(stock.quantity || 0);
    const difference = Number((systemQuantity - actualQuantity).toFixed(3));
    stock.quantity = Number(actualQuantity.toFixed(3));
    stock.unit = material.unit;

    const opname = {
      id: createSequentialId("opname", data.stock_opnames),
      outlet_id: outletId,
      material_id: materialId,
      system_quantity: systemQuantity,
      actual_quantity: stock.quantity,
      unit: material.unit,
      difference,
      status: getOpnameStatus(difference),
      note: getOpnameNote(difference),
      created_by: payload.created_by || data.users[0]?.id,
      opname_date: payload.opname_date || "2026-04-30"
    };

    data.stock_opnames.unshift(opname);
    logEntityActivity("stock_opname/create", {
      actorId: opname.created_by,
      outletId: opname.outlet_id,
      module: "stock_opname",
      entityType: "stock_opname",
      entity: opname,
      description: `Stock opname ${material.name} disimpan.`,
      metadata: {
        material_id: opname.material_id,
        system_quantity: opname.system_quantity,
        actual_quantity: opname.actual_quantity,
        difference: opname.difference,
        status: opname.status,
        opname_date: opname.opname_date
      }
    });
    rebuildIndexes();

    return clone(getOpnameRows("all").find((item) => item.id === opname.id));
  },

  async createStockOpnameBatch(payload) {
    await delay(520);
    const outletId = payload.outlet_id;
    const date = payload.opname_date;
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const outlet = outletMap.get(outletId);

    if (!outlet || !date || !rows.length) {
      throw new Error("Outlet, tanggal, dan baris opname wajib valid.");
    }

    const batchId = createOpnameBatchId();
    const createdRows = [];
    const purchaseTotals = getDailyPurchaseTotals(outletId, date);
    const transferBreakdown = getDailyTransferBreakdown(outletId, date);
    const salesTotals = getDailySalesMaterialTotals(outletId, date);

    for (const row of rows) {
      const material = materialMap.get(row.material_id);
      const actualQuantity = Number(row.actual_quantity);
      const damageQuantity = Number(row.damage_quantity || 0);

      if (!material || Number.isNaN(actualQuantity) || actualQuantity < 0 || Number.isNaN(damageQuantity) || damageQuantity < 0) {
        throw new Error("Produk, qty fisik, dan qty rusak wajib valid.");
      }

      const stock = ensureStockRow(outletId, material.id);
      const purchaseQuantity = roundQuantity(purchaseTotals.get(material.id) || 0);
      const transferInQuantity = roundQuantity(transferBreakdown.inTotals.get(material.id) || 0);
      const transferOutQuantity = roundQuantity(transferBreakdown.outTotals.get(material.id) || 0);
      const salesQuantity = roundQuantity(salesTotals.get(material.id) || 0);
      const fallbackOpeningQuantity = roundQuantity(Number(stock.quantity || 0) - purchaseQuantity - transferInQuantity + transferOutQuantity + salesQuantity);
      const openingQuantity = roundQuantity(row.opening_quantity ?? fallbackOpeningQuantity);
      const physicalQuantity = roundQuantity(actualQuantity);
      const unitPrice = Number(row.unit_price || getLatestMaterialPrice(material.id, outletId, date));
      const calculated = calculateStockOpname({
        openingQuantity,
        purchaseQuantity,
        transferInQuantity,
        transferOutQuantity,
        salesQuantity,
        damageQuantity,
        actualQuantity: physicalQuantity,
        unitPrice
      });

      stock.quantity = physicalQuantity;
      stock.unit = material.unit;

      const opname = {
        id: createSequentialId("opname", data.stock_opnames),
        batch_id: batchId,
        outlet_id: outletId,
        material_id: material.id,
        ...calculated,
        unit: material.unit,
        unit_price: unitPrice,
        status: calculated.status,
        note: getOpnameNote(calculated.difference),
        created_by: payload.created_by || data.users[0]?.id,
        opname_date: date
      };

      data.stock_opnames.unshift(opname);
      createdRows.push(opname);
    }

    logEntityActivity("stock_opname/create_batch", {
      actorId: payload.created_by || payload.createdBy || data.users[0]?.id,
      outletId,
      module: "stock_opname",
      entityType: "stock_opname_batch",
      entityId: batchId,
      description: `Batch stock opname ${outlet.name} disimpan.`,
      metadata: {
        batch_id: batchId,
        opname_date: date,
        item_count: createdRows.length,
        total_loss_amount: createdRows.reduce((total, item) => total + Number(item.loss_amount || 0), 0)
      }
    });
    rebuildIndexes();

    return clone({
      batch_id: batchId,
      outlet: outletMap.get(outletId),
      opname_date: date,
      rows: getOpnameRows("all").filter((item) => item.batch_id === batchId),
      total_items: createdRows.length,
      total_loss_amount: createdRows.reduce((total, item) => total + Number(item.loss_amount || 0), 0)
    });
  },

  async createPosStockOpnameRequest(payload = {}, requestedBy) {
    await delay(320);
    const outletId = payload.outlet_id || payload.outletId;
    const date = payload.opname_date || payload.opnameDate || normalizeMobileDateOnly(payload.date, new Date());
    const rows = Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.items) ? payload.items : [];
    const outlet = outletMap.get(outletId);

    if (!outlet || !date || !rows.length) {
      throw new Error("Outlet, tanggal, dan item opname wajib valid.");
    }
    const store = getOpnameRequestStore();
    const batchId = payload.batch_id || payload.batchId || payload.local_id || payload.localId || createOpnameBatchId();
    const duplicate = batchId ? store.find((item) => item.batch_id === batchId) : null;
    if (duplicate) return clone(enrichOpnameRequest(duplicate));
    const selectedMaterialIds = getSelectedOpnameMaterialIds(outletId);
    const requestedMaterialIds = rows.map((row) => row.material_id || row.materialId);
    if (requestedMaterialIds.some((materialId) => !selectedMaterialIds.has(materialId))) {
      throw new Error("Item request tidak termasuk pilihan Stock Opname APK untuk outlet ini. Muat ulang worksheet.");
    }

    const request = {
      id: createSequentialId("opname_request", store),
      batch_id: batchId,
      outlet_id: outletId,
      opname_date: date,
      status: "pending",
      source: "kasir_app",
      note: payload.note || "",
      requested_by: requestedBy || payload.requested_by || payload.requestedBy || data.users[0]?.id || null,
      created_at: new Date().toISOString(),
      items: rows.map((row) => normalizeOpnameRequestItem(row, outletId, date))
    };

    store.unshift(request);
    createActivityLog({
      actor_user_id: request.requested_by,
      outlet_id: outletId,
      source: "kasir_app",
      module: "stock_opname",
      action: "create_request",
      entity_type: "stock_opname_request",
      entity_id: request.id,
      description: `Kasir input request stock opname ${outlet.name}.`,
      metadata_json: {
        batch_id: request.batch_id,
        opname_date: request.opname_date,
        item_count: request.items.length,
        total_loss_amount: request.items.reduce((total, item) => total + Number(item.loss_amount || 0), 0)
      }
    });
    rebuildIndexes();

    return clone(enrichOpnameRequest(request));
  },

  async updatePosStockOpnameRequest(requestId, payload = {}, updatedBy = null) {
    await delay(320);
    const request = getOpnameRequestStore().find((item) => item.id === requestId || item.batch_id === requestId);
    if (!request) {
      const error = new Error("Request stock opname tidak ditemukan.");
      error.status = 404;
      throw error;
    }
    if (request.status !== "pending") {
      const error = new Error("Hanya request opname pending yang bisa diedit.");
      error.status = 409;
      throw error;
    }
    if (!updatedBy || String(request.requested_by || "") !== String(updatedBy)) {
      const error = new Error("Request opname hanya dapat diedit oleh pembuatnya.");
      error.status = 403;
      throw error;
    }
    const outletId = payload.outlet_id || payload.outletId;
    if (outletId !== request.outlet_id) throw new Error("Outlet request opname tidak boleh diubah.");
    const rows = Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.items) ? payload.items : [];
    if (!rows.length) throw new Error("Minimal satu item opname wajib diisi.");
    const selectedMaterialIds = getSelectedOpnameMaterialIds(outletId);
    const snapshotIds = new Set((request.items || []).map((item) => item.material_id));
    const requestedMaterialIds = rows.map((row) => row.material_id || row.materialId);
    if (requestedMaterialIds.some((materialId) => !selectedMaterialIds.has(materialId) && !snapshotIds.has(materialId))) {
      throw new Error("Item edit tidak termasuk pilihan outlet atau snapshot request sebelumnya.");
    }
    const previousDate = request.opname_date;
    const date = payload.opname_date || payload.opnameDate || normalizeMobileDateOnly(payload.operationalAt || payload.date, request.opname_date);
    request.opname_date = date;
    request.note = payload.note || "";
    request.items = rows.map((row) =>
      normalizeOpnameRequestItem(row, outletId, date, {
        allowInactiveMaterialIds: snapshotIds
      })
    );
    request.updated_by = updatedBy;
    request.updated_at = new Date().toISOString();
    createActivityLog({
      actor_user_id: updatedBy,
      outlet_id: outletId,
      source: "kasir_app",
      module: "stock_opname",
      action: "update_request",
      entity_type: "stock_opname_request",
      entity_id: request.id,
      description: `Request opname ${request.id} diperbarui sebelum approval.`,
      metadata_json: {
        previous_date: previousDate,
        next_date: date,
        item_count: request.items.length
      }
    });
    rebuildIndexes();
    return clone(enrichOpnameRequest(request));
  },

  async approveStockOpnameRequest(requestId, payload = {}) {
    await delay(360);
    const request = getOpnameRequestStore().find((item) => item.id === requestId);
    if (!request) throw new Error("Request stock opname tidak ditemukan.");
    if (request.status !== "pending") throw new Error("Hanya request pending yang bisa di-approve.");

    const batchId = request.batch_id || createOpnameBatchId();
    const createdRows = [];
    for (const item of request.items || []) {
      const material = materialMap.get(item.material_id);
      if (!material) throw new Error("Produk opname tidak ditemukan.");

      const stock = ensureStockRow(request.outlet_id, item.material_id);
      const physicalQuantity = roundQuantity(item.actual_quantity);
      const realSystemQuantity = roundQuantity(item.real_system_quantity ?? item.system_quantity);
      const difference = roundQuantity(realSystemQuantity - physicalQuantity);
      const unitPrice = Number(item.unit_price || getLatestMaterialPrice(item.material_id, request.outlet_id, request.opname_date));
      const opname = {
        id: createSequentialId("opname", data.stock_opnames),
        batch_id: batchId,
        request_id: request.id,
        outlet_id: request.outlet_id,
        material_id: item.material_id,
        opening_quantity: roundQuantity(item.opening_quantity),
        incoming_quantity: roundQuantity(item.incoming_quantity),
        transfer_quantity: roundQuantity(item.transfer_quantity),
        transfer_out_quantity: roundQuantity(item.transfer_out_quantity),
        damage_quantity: roundQuantity(item.damage_quantity),
        computed_sales_quantity: roundQuantity(item.computed_sales_quantity),
        system_quantity: realSystemQuantity,
        actual_quantity: physicalQuantity,
        unit: material.unit,
        unit_price: unitPrice,
        difference,
        status: getOpnameStatus(difference),
        loss_amount: Math.max(difference, 0) * unitPrice,
        note: getOpnameNote(difference),
        created_by: request.requested_by || payload.approved_by || payload.approvedBy || data.users[0]?.id,
        approved_by: payload.approved_by || payload.approvedBy || null,
        opname_date: request.opname_date,
        source: request.source || "kasir_app"
      };

      stock.quantity = physicalQuantity;
      stock.unit = material.unit;
      data.stock_opnames.unshift(opname);
      createdRows.push(opname);
    }

    request.status = "approved";
    request.approved_by = payload.approved_by || payload.approvedBy || null;
    request.approved_at = new Date().toISOString();
    request.batch_id = batchId;
    createActivityLog({
      actor_user_id: request.approved_by,
      outlet_id: request.outlet_id,
      source: "admin_web",
      module: "stock_opname",
      action: "approve_request",
      entity_type: "stock_opname_request",
      entity_id: request.id,
      description: "Admin approve request stock opname dari APK.",
      metadata_json: {
        batch_id: batchId,
        opname_date: request.opname_date,
        item_count: createdRows.length,
        total_loss_amount: createdRows.reduce((total, item) => total + Number(item.loss_amount || 0), 0)
      }
    });
    rebuildIndexes();

    return clone(enrichOpnameRequest(request));
  },

  async rejectStockOpnameRequest(requestId, payload = {}) {
    await delay(300);
    const request = getOpnameRequestStore().find((item) => item.id === requestId);
    if (!request) throw new Error("Request stock opname tidak ditemukan.");
    if (request.status !== "pending") throw new Error("Hanya request pending yang bisa di-reject.");

    const rejectionNote = String(payload.rejection_note || payload.rejectionNote || "").trim();
    if (!rejectionNote) throw new Error("Alasan reject stock opname wajib diisi.");

    request.status = "rejected";
    request.rejection_note = rejectionNote;
    request.rejected_by = payload.rejected_by || payload.rejectedBy || payload.approved_by || payload.approvedBy || null;
    request.rejected_at = new Date().toISOString();
    createActivityLog({
      actor_user_id: request.rejected_by,
      outlet_id: request.outlet_id,
      source: "admin_web",
      module: "stock_opname",
      action: "reject_request",
      entity_type: "stock_opname_request",
      entity_id: request.id,
      description: "Admin reject request stock opname dari APK.",
      metadata_json: {
        reason: rejectionNote,
        opname_date: request.opname_date,
        item_count: (request.items || []).length
      }
    });
    rebuildIndexes();

    return clone(enrichOpnameRequest(request));
  },

  async getPosHistory({ outletId = "all", from, to, paymentMethod = "all" } = {}) {
    await delay(180);
    const transactions = getTransactionRows({ outletId, from, to }).filter((transaction) => {
      if (!paymentMethod || paymentMethod === "all") return true;
      return transaction.payment?.method === paymentMethod;
    });
    return clone(transactions.map(transactionToMobile));
  },

  async getPosReports({ outletId = "all", from, to } = {}) {
    await delay(200);
    const transactions = getTransactionRows({ outletId, from, to }).filter((transaction) => transaction.status === "paid");
    const purchases = getPurchaseRows(outletId).filter((purchase) => withinDateRange(purchase.purchase_date, from, to));
    const approvedPurchases = purchases.filter((purchase) => purchase.status === "approved");
    const expenses = getExpenseRows(outletId).filter((expense) => withinDateRange(expense.expense_date, from, to));
    const approvedExpenses = expenses.filter(isApprovedExpense);
    const paymentTotals = getPaymentMethodRows().reduce((totals, method) => {
      totals[method.code] = 0;
      return totals;
    }, {});
    transactions.forEach((transaction) => {
      const method = transaction.payment?.method || "cash";
      paymentTotals[method] = (paymentTotals[method] || 0) + Number(transaction.total || 0);
    });
    const revenue = transactions.reduce((total, transaction) => total + Number(transaction.total || 0), 0);
    const discountTotal = transactions.reduce((total, transaction) => total + Number(transaction.discount || 0), 0);
    const expenseTotal = approvedExpenses.reduce((total, expense) => total + Number(expense.amount || 0), 0);
    const accountingProfitLoss = buildProfitLossReport({
      outletId,
      transactions,
      purchases: approvedPurchases,
      expenses: approvedExpenses,
      from,
      to
    });

    return clone({
      revenue,
      transaction_count: transactions.length,
      discount_total: discountTotal,
      expense_total: expenseTotal,
      net_total: revenue - expenseTotal,
      payment_totals: paymentTotals,
      sales_by_day: getDailySales(transactions, from, to),
      accounting_profit_loss: accountingProfitLoss,
      transactions: transactions.map(transactionToMobile),
      expenses: expenses.map(expenseToMobile)
    });
  },

  async getPosExpenses({ outletId = "all", from, to } = {}) {
    await delay(180);
    return clone(
      getExpenseRows(outletId)
        .filter((expense) => withinDateRange(expense.expense_date, from, to))
        .map(expenseToMobile)
    );
  },

  async getPosCustomers({ outletId = "all", keyword = "" } = {}) {
    await delay(160);
    return clone(
      getCustomerRows(outletId, keyword)
        .filter((customer) => customer.status !== "inactive")
        .map(customerToMobile)
    );
  },

  async createPosCustomer(payload) {
    await delay(220);
    const outletId = String(mobileValue(payload, "outletId", "outlet_id", "") || "");
    const phone = String(mobileValue(payload, "phone", "phone", "") || "").trim();
    const name = String(mobileValue(payload, "name", "name", "") || "").trim();

    if (!outletMap.has(outletId) || !name || phone.length < 6) {
      throw new Error("Outlet, nama customer, dan nomor HP wajib valid.");
    }

    const normalizePhone = (value) =>
      String(value || "")
        .replace(/[^0-9+]/g, "")
        .trim();
    const existing = data.customers.find((customer) => customer.outlet_id === outletId && normalizePhone(customer.phone) === normalizePhone(phone));
    if (existing) {
      throw new Error(`Nomor HP sudah terdaftar atas nama ${existing.name}. Pilih customer tersebut dari daftar, atau gunakan nomor lain.`);
    }

    const customer = {
      id: createSequentialId("customer", data.customers),
      outlet_id: outletId,
      name,
      phone,
      barcode: createCustomerBarcode(outletId),
      points: 0,
      status: "active",
      registered_at: new Date().toISOString().slice(0, 10)
    };
    data.customers.push(customer);
    createActivityLog({
      actor_user_id: mobileValue(payload, "createdBy", "created_by", null),
      outlet_id: outletId,
      source: "kasir_app",
      module: "customer",
      action: "customer/create",
      entity_type: "customer",
      entity_id: customer.id,
      description: `Kasir membuat customer ${customer.name}.`,
      metadata_json: { phone: customer.phone, barcode: customer.barcode }
    });
    rebuildIndexes();
    return customerToMobile(customer);
  },

  async getOpenBills({ outletId = "all" } = {}) {
    await delay(180);
    return clone(getOpenBillRows(outletId));
  },

  async upsertOpenBill(payload) {
    await delay(260);
    const normalized = normalizeOpenBillPayload(payload);
    const occupied = normalized.serviceType === "dine_in" ? data.open_bills.find((bill) => bill.serviceType === "dine_in" && bill.outletId === normalized.outletId && bill.tableNumber === normalized.tableNumber && bill.id !== normalized.id && bill.orderNumber !== normalized.orderNumber) : null;
    if (occupied) {
      throw new Error("Meja sudah terpakai oleh open bill lain.");
    }

    const index = data.open_bills.findIndex((bill) => bill.id === normalized.id || bill.orderNumber === normalized.orderNumber);
    if (index >= 0) {
      data.open_bills[index] = {
        ...data.open_bills[index],
        ...normalized,
        createdAt: data.open_bills[index].createdAt || normalized.createdAt,
        synced: true
      };
      createActivityLog({
        actor_user_id: data.open_bills[index].cashierId,
        outlet_id: data.open_bills[index].outletId,
        source: "kasir_app",
        module: "open_bill",
        action: "update",
        entity_type: "open_bill",
        entity_id: data.open_bills[index].id,
        description: `Kasir memperbarui open bill ${data.open_bills[index].orderNumber || data.open_bills[index].tableNumber || data.open_bills[index].serviceType}`,
        metadata_json: {
          total: data.open_bills[index].total,
          serviceType: data.open_bills[index].serviceType,
          tableNumber: data.open_bills[index].tableNumber
        }
      });
      return clone(data.open_bills[index]);
    }

    normalized.customerPrintedItems = normalized.customerPrintedItems || [];
    normalized.kitchenPrintedItems = normalized.kitchenPrintedItems || [];
    data.open_bills.unshift(normalized);
    createActivityLog({
      actor_user_id: normalized.cashierId,
      outlet_id: normalized.outletId,
      source: "kasir_app",
      module: "open_bill",
      action: "create",
      entity_type: "open_bill",
      entity_id: normalized.id,
      description: `Kasir membuat open bill ${normalized.orderNumber || normalized.tableNumber || normalized.serviceType}`,
      metadata_json: {
        total: normalized.total,
        serviceType: normalized.serviceType,
        tableNumber: normalized.tableNumber
      }
    });
    return clone(normalized);
  },

  async updateOpenBillPrintCheckpoint(openBillId, payload = {}, actorUserId = null) {
    await delay(180);
    const bill = data.open_bills.find((item) => item.id === openBillId && item.status !== "closed");
    if (!bill) throw new Error("Open bill tidak ditemukan.");
    const template = String(payload.template || "");
    if (!["customer_order", "kitchen_order"].includes(template)) {
      throw new Error("Template checkpoint print tidak valid.");
    }
    const items = normalizeMobileItems(payload.items || []);
    if (template === "customer_order") bill.customerPrintedItems = items;
    else bill.kitchenPrintedItems = items;
    bill.updatedAt = new Date().toISOString();
    bill.synced = true;
    createActivityLog({
      actor_user_id: actorUserId || bill.cashierId,
      outlet_id: bill.outletId,
      source: "kasir_app",
      module: "open_bill",
      action: "print_checkpoint",
      entity_type: "open_bill",
      entity_id: bill.id,
      description: `Checkpoint print ${bill.orderNumber} diperbarui`,
      metadata_json: { template, item_count: items.length }
    });
    return clone(bill);
  },

  async deleteOpenBill(openBillId) {
    await delay(220);
    const before = data.open_bills.length;
    data.open_bills = data.open_bills.filter((bill) => bill.id !== openBillId && bill.orderNumber !== openBillId);
    createActivityLog({
      source: "kasir_app",
      module: "open_bill",
      action: "delete",
      entity_type: "open_bill",
      entity_id: openBillId,
      description: `Kasir menghapus open bill ${openBillId}`
    });
    return clone({
      id: openBillId,
      deleted: before !== data.open_bills.length || true
    });
  },

  async createPosTransaction(payload, createdBy) {
    await delay(300);
    const transaction = createTransactionFromMobilePayload(payload, createdBy);
    createActivityLog({
      actor_user_id: transaction.cashierId || createdBy,
      outlet_id: transaction.outletId,
      source: "kasir_app",
      module: "transaction",
      action: "checkout",
      entity_type: "transaction",
      entity_id: transaction.id,
      description: `Kasir checkout transaksi ${transaction.orderNumber}`,
      metadata_json: {
        total: transaction.total,
        paymentMethod: transaction.paymentMethod,
        itemCount: transaction.items?.length || 0
      }
    });
    return clone(transaction);
  },

  async createPosExpense(payload, createdBy) {
    await delay(240);
    const expense = createExpenseFromMobilePayload(payload, createdBy);
    createActivityLog({
      actor_user_id: createdBy,
      outlet_id: expense.outletId,
      source: "kasir_app",
      module: "expense",
      action: "create",
      entity_type: "expense",
      entity_id: expense.id,
      description: `Kasir input pengeluaran ${expense.category}`,
      metadata_json: { amount: expense.amount, category: expense.category }
    });
    return expense;
  },

  async updatePosExpense(expenseId, payload, updatedBy) {
    await delay(240);
    const expense = updateExpenseFromMobilePayload(expenseId, payload, updatedBy);
    createActivityLog({
      actor_user_id: updatedBy,
      outlet_id: expense.outletId,
      source: "kasir_app",
      module: "expense",
      action: "update",
      entity_type: "expense",
      entity_id: expense.id,
      description: `Kasir edit pengeluaran ${expense.category}`,
      metadata_json: { amount: expense.amount, category: expense.category }
    });
    return expense;
  },

  async createActivityLog(payload) {
    await delay(120);
    return clone(createActivityLog(payload));
  },

  async createActivityLogs(payloads = []) {
    await delay(180);
    const rows = (Array.isArray(payloads) ? payloads : []).map((payload) => createActivityLog(payload));
    return clone({
      synced: rows.length,
      accepted_event_ids: rows.map((row) => row.client_event_id).filter(Boolean),
      logs: rows
    });
  },

  async verifyReportPin(pin, actorUserId = null) {
    await delay(180);
    const security = getAppSecuritySettings();
    const submittedPin = String(pin || "").trim();
    const valid = security.report_pin_enabled === false || submittedPin === String(data.app_security?.report_pin || "000000");
    createActivityLog({
      actor_user_id: actorUserId,
      source: "kasir_app",
      module: "report_pin",
      action: "verify",
      entity_type: "app_security",
      entity_id: "report_pin",
      description: valid ? "Kasir berhasil verifikasi PIN laporan" : "Kasir gagal verifikasi PIN laporan",
      metadata_json: { valid }
    });
    return clone({ valid });
  },

  async getActivityLogs(filters = {}) {
    await delay(160);
    const rows = getActivityLogRows(filters);
    const paginated = filters.paginated === true || filters.paginated === "true" || filters.paginated === "1";
    if (!paginated) return clone(rows);
    const page = Math.max(1, Number(filters.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(filters.pageSize) || 50));
    return clone({
      rows: rows.slice((page - 1) * pageSize, page * pageSize),
      pagination: {
        page,
        page_size: pageSize,
        total: rows.length,
        total_pages: Math.ceil(rows.length / pageSize)
      }
    });
  },

  getStaticData() {
    return data;
  },

  getProductPrice
};

module.exports = withPersistence(adminMockApi);
