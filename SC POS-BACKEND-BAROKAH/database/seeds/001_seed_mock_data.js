const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { defaultRolePermissions, permissionCatalog } = require("../../src/config/permission-catalog");

const seedPath = path.join(__dirname, "data", "pos-barokah-admin-demo.json");
const fallbackSeedPath = path.join(__dirname, "data", "pos-barokah-admin-demo-bak.json");
let data = null;

const seedMode = String(process.env.SEED_MODE || "clean").toLowerCase();

function getDemoSeedData() {
  if (!data) {
    const readableSeedPath = fs.existsSync(seedPath) ? seedPath : fallbackSeedPath;
    data = JSON.parse(fs.readFileSync(readableSeedPath, "utf8"));
  }
  return data;
}

function setCleanSeedData() {
  data = {
    metadata: {},
    design_tokens: {},
    app_security: { report_pin_enabled: true, report_pin: "000000" },
    roles: [
      { id: "role_owner", name: "Owner", description: "Akses penuh sistem" },
      { id: "role_admin", name: "Admin", description: "Operasional admin" },
      { id: "role_cashier", name: "Kasir", description: "Akses APK kasir" }
    ],
    outlets: [
      {
        id: "outlet_001",
        name: "Barokah Pusat",
        code: "BKP",
        address: "Alamat outlet utama",
        phone: null,
        status: "active",
        opened_at: null
      }
    ],
    users: [
      {
        id: "user_001",
        name: "Owner Barokah",
        username: "owner",
        email: "owner@barokah.local",
        role_id: "role_owner",
        status: "active"
      }
    ],
    categories: [],
    raw_material_categories: null,
    units: null,
    expense_categories: [],
    print_settings: {
      printer_name: "Printer Kasir Utama",
      printer_status: "active",
      mode: "single_printer"
    },
    print_templates: [
      { key: "customer_order", label: "Customer Order Copy", enabled: true, footer_text: "" },
      { key: "kitchen_order", label: "Kitchen Order", enabled: true, footer_text: "" },
      { key: "bill_receipt", label: "Bill / Receipt", enabled: true, footer_text: "Terima kasih" }
    ],
    payment_methods: null,
    financial_accounts: null
  };
  return data;
}

const seedTables = [
  "report_snapshots",
  "balance_sheet_entries",
  "financial_accounts",
  "activity_logs",
  "pos_product_favorites",
  "product_variants",
  "discount_outlets",
  "discounts",
  "expenses",
  "transaction_refunds",
  "payments",
  "payment_methods",
  "transaction_items",
  "transactions",
  "print_templates",
  "print_settings",
  "expense_categories",
  "dining_tables",
  "stock_opname_material_selections",
  "stock_opnames",
  "stock_transfer_items",
  "stock_transfers",
  "raw_material_stocks",
  "purchase_items",
  "purchases",
  "suppliers",
  "product_compositions",
  "raw_materials",
  "units",
  "raw_material_categories",
  "product_prices",
  "products",
  "categories",
  "customers",
  "user_outlets",
  "users",
  "outlets",
  "roles",
  "permissions",
  "metadata"
];

async function insertRows(knex, tableName, rows) {
  if (!rows.length) return;
  await knex.batchInsert(tableName, rows, 100);
}

async function clearSeedTables(knex) {
  await knex.raw("SET FOREIGN_KEY_CHECKS = 0");
  for (const tableName of seedTables) {
    const exists = await knex.schema.hasTable(tableName);
    if (exists) await knex(tableName).del();
  }
  await knex.raw("SET FOREIGN_KEY_CHECKS = 1");
}

function jsonValue(value) {
  return JSON.stringify(value ?? null);
}

function stockOpnameMaterialSelectionRows() {
  return (data.outlets || [])
    .filter((outlet) => outlet.status !== "inactive")
    .flatMap((outlet) =>
      (data.raw_materials || [])
        .filter((material) => material.status !== "inactive")
        .map((material) => ({ outlet_id: outlet.id, material_id: material.id, selected_by: null }))
    );
}

function asNumber(value) {
  return Number(value || 0);
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
  { id: "payment_method_cash", name: "Cash", code: "cash", account_code: "1001", sort_order: 1, status: "active" },
  { id: "payment_method_transfer", name: "Transfer", code: "transfer", account_code: "1002", sort_order: 2, status: "active" },
  { id: "payment_method_qris", name: "QRIS", code: "qris", account_code: "1044", sort_order: 3, status: "active" },
  { id: "payment_method_gofood", name: "GoFood", code: "gofood", account_code: "1005", sort_order: 4, status: "active" }
];

const defaultUnits = [
  { id: "unit_kg", name: "Kilogram", code: "kg", sort_order: 1, status: "active" },
  { id: "unit_liter", name: "Liter", code: "liter", sort_order: 2, status: "active" },
  { id: "unit_botol", name: "Botol", code: "botol", sort_order: 3, status: "active" },
  { id: "unit_pcs", name: "Pieces", code: "pcs", sort_order: 4, status: "active" }
];

function unitRows() {
  return (data.units || defaultUnits).map((unit, index) => ({
    id: unit.id,
    name: unit.name || unit.code,
    code: unit.code || unit.name,
    sort_order: Number(unit.sort_order || index + 1),
    status: unit.status || "active"
  }));
}

const defaultFinancialAccounts = [
  { id: "account_1001", code: "1001", name: "Kas", report_group: "cash_bank", normal_balance: "debit", sort_order: 1, status: "active" },
  { id: "account_1002", code: "1002", name: "Bank", report_group: "cash_bank", normal_balance: "debit", sort_order: 2, status: "active" },
  { id: "account_1044", code: "1044", name: "QRIS / E-Wallet", report_group: "cash_bank", normal_balance: "debit", sort_order: 3, status: "active" },
  { id: "account_1005", code: "1005", name: "GoFood / Penjualan Online", report_group: "cash_bank", normal_balance: "debit", sort_order: 4, status: "active" },
  { id: "account_1201", code: "1201", name: "Kasbon Karyawan / Piutang", report_group: "other_current_asset", normal_balance: "debit", sort_order: 15, status: "active" },
  { id: "account_1301", code: "1301", name: "Persediaan", report_group: "inventory", normal_balance: "debit", sort_order: 20, status: "active" },
  { id: "account_1431", code: "1431", name: "Dana Cadangan", report_group: "other_current_asset", normal_balance: "debit", sort_order: 30, status: "active" },
  { id: "account_1501", code: "1501", name: "Aset Tetap", report_group: "fixed_asset", normal_balance: "debit", sort_order: 40, status: "active" },
  { id: "account_1510", code: "1510", name: "Aset Bergerak", report_group: "moving_asset", normal_balance: "debit", sort_order: 41, status: "active" },
  { id: "account_2001", code: "2001", name: "Hutang / Bon Pembelian", report_group: "liability", normal_balance: "credit", sort_order: 60, status: "active" },
  { id: "account_3001", code: "3001", name: "Modal Pemilik", report_group: "equity", normal_balance: "credit", sort_order: 80, status: "active" },
  { id: "account_3999", code: "3999", name: "Laba Ditahan / Penyeimbang", report_group: "equity", normal_balance: "credit", sort_order: 99, status: "active" },
  { id: "account_4001", code: "4001", name: "Pendapatan Usaha", report_group: "income", normal_balance: "credit", sort_order: 100, status: "active" },
  { id: "account_4002", code: "4002", name: "Diskon Penjualan", report_group: "income", normal_balance: "debit", sort_order: 101, status: "active" },
  { id: "account_5002", code: "5002", name: "Harga Pokok Penjualan", report_group: "cogs", normal_balance: "debit", sort_order: 200, status: "active" },
  { id: "account_6000", code: "6000", name: "Biaya Operasional", report_group: "expense", normal_balance: "debit", sort_order: 300, status: "active" },
  { id: "account_6005", code: "6005", name: "Biaya Listrik dan Gas", report_group: "expense", normal_balance: "debit", sort_order: 305, status: "active" },
  { id: "account_6011", code: "6011", name: "Kebersihan", report_group: "expense", normal_balance: "debit", sort_order: 311, status: "active" },
  { id: "account_6012", code: "6012", name: "Transport", report_group: "expense", normal_balance: "debit", sort_order: 312, status: "active" },
  { id: "account_6013", code: "6013", name: "Perawatan", report_group: "expense", normal_balance: "debit", sort_order: 313, status: "active" },
  { id: "account_6014", code: "6014", name: "Packaging", report_group: "expense", normal_balance: "debit", sort_order: 314, status: "active" },
  { id: "account_6015", code: "6015", name: "Gaji Harian", report_group: "expense", normal_balance: "debit", sort_order: 315, status: "active" },
  { id: "account_6016", code: "6016", name: "Lauk Karyawan", report_group: "expense", normal_balance: "debit", sort_order: 316, status: "active" },
  { id: "account_6017", code: "6017", name: "Laundry Karyawan", report_group: "expense", normal_balance: "debit", sort_order: 317, status: "active" },
  { id: "account_6018", code: "6018", name: "Sedekah Harian", report_group: "expense", normal_balance: "debit", sort_order: 318, status: "active" },
  { id: "account_6019", code: "6019", name: "Sewa Outlet", report_group: "expense", normal_balance: "debit", sort_order: 319, status: "active" },
  { id: "account_6020", code: "6020", name: "Uang Bonus", report_group: "expense", normal_balance: "debit", sort_order: 320, status: "active" },
  { id: "account_6021", code: "6021", name: "Uang Lembur", report_group: "expense", normal_balance: "debit", sort_order: 321, status: "active" },
  { id: "account_6022", code: "6022", name: "Insentif Visit Outlet", report_group: "expense", normal_balance: "debit", sort_order: 322, status: "active" },
  { id: "account_7010", code: "7010", name: "Pendapatan Lain-Lain", report_group: "other_income", normal_balance: "credit", sort_order: 400, status: "active" },
  { id: "account_8003", code: "8003", name: "Pengeluaran Lain-Lain", report_group: "other_expense", normal_balance: "debit", sort_order: 500, status: "active" }
];

function rawMaterialRows() {
  const categories = data.raw_material_categories || defaultRawMaterialCategories;

  return data.raw_materials.map((material) => {
    const category = categories.find((item) => item.id === material.category_id) || categories.find((item) => item.type === (material.type || "hpp"));

    return {
      ...material,
      type: material.type || category?.type || "hpp",
      category_id: material.category_id || category?.id || "raw_mat_cat_hpp",
      account_code: category?.account_code || material.account_code || "5002"
    };
  });
}

function expenseCategoryRows() {
  return (data.expense_categories || []).map((category, index) => ({
    ...category,
    account_code: category.account_code || (index === 0 ? "6005" : `60${String(index + 10).padStart(2, "0")}`)
  }));
}

function cleanUsers({ adminHash }) {
  const userById = new Map((data.users || []).map((user) => [user.id, user]));
  const owner = userById.get("user_001") || {
    id: "user_001",
    name: "Owner Barokah",
    username: "owner",
    email: "owner@barokah.local",
    role_id: "role_owner",
    status: "active"
  };

  return [owner].map((user) => ({
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    password_hash: adminHash,
    pin_hash: null,
    role_id: user.role_id,
    status: user.status || "active",
    last_login_at: null,
    password_changed_at: null,
    password_reset_at: null
  }));
}

function cleanUserOutlets() {
  return ["user_001"].map((userId) => ({
    user_id: userId,
    outlet_id: "outlet_001"
  }));
}

function purchaseItemRows() {
  let counter = 1;
  return data.purchases.flatMap((purchase) =>
    (purchase.items || []).map((item) => ({
      id: `purchase_item_${String(counter++).padStart(3, "0")}`,
      purchase_id: purchase.id,
      material_id: item.material_id,
      quantity: asNumber(item.quantity),
      unit: item.unit,
      unit_price: asNumber(item.unit_price),
      subtotal: asNumber(item.subtotal)
    }))
  );
}

function transferItemRows() {
  let counter = 1;
  return data.stock_transfers.flatMap((transfer) =>
    (transfer.items || []).map((item) => ({
      id: `transfer_item_${String(counter++).padStart(3, "0")}`,
      transfer_id: transfer.id,
      material_id: item.material_id,
      quantity: asNumber(item.quantity),
      unit: item.unit
    }))
  );
}

function discountOutletRows() {
  return (data.discounts || []).flatMap((discount) => {
    const embeddedOutletIds = Array.isArray(discount.outlet_ids) ? discount.outlet_ids : [];
    const linkedOutletIds = (data.discount_outlets || [])
      .filter((row) => row.discount_id === discount.id)
      .map((row) => row.outlet_id);
    return [...new Set([...embeddedOutletIds, ...linkedOutletIds])].map((outletId) => ({
      discount_id: discount.id,
      outlet_id: outletId
    }));
  });
}

async function seedClean(knex) {
  setCleanSeedData();
  const adminHash = bcrypt.hashSync("admin123", 10);
  const reportPinHash = bcrypt.hashSync(String(data.app_security?.report_pin || "000000"), 10);

  await clearSeedTables(knex);

  await insertRows(knex, "metadata", [
    { key: "metadata", value: jsonValue(data.metadata || {}) },
    { key: "design_tokens", value: jsonValue(data.design_tokens || {}) },
    {
      key: "app_security",
      value: jsonValue({
        report_pin_enabled: data.app_security?.report_pin_enabled !== false,
        report_pin_hash: reportPinHash
      })
    }
  ]);

  await insertRows(
    knex,
    "permissions",
    permissionCatalog.map((permission) => ({
      key: permission.key,
      group: permission.group,
      label: permission.label,
      route: permission.route,
      actions: jsonValue(permission.actions)
    }))
  );

  await insertRows(
    knex,
    "roles",
    (data.roles || []).map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      permissions: jsonValue(defaultRolePermissions[role.id] || role.permissions || {})
    }))
  );

  const primaryOutlet =
    (data.outlets || []).find((outlet) => outlet.id === "outlet_001") ||
    {
      id: "outlet_001",
      name: "Barokah Pusat",
      code: "BKP",
      address: "Alamat outlet utama",
      phone: null,
      status: "active",
      opened_at: null
  };
  await insertRows(knex, "outlets", [primaryOutlet]);
  await insertRows(knex, "users", cleanUsers({ adminHash }));
  await insertRows(knex, "user_outlets", cleanUserOutlets());
  await insertRows(knex, "categories", data.categories || []);
  await insertRows(knex, "raw_material_categories", data.raw_material_categories || defaultRawMaterialCategories);
  await insertRows(knex, "units", unitRows());
  await insertRows(knex, "expense_categories", expenseCategoryRows());

  await insertRows(knex, "print_settings", [
    {
      id: "default",
      printer_name: data.print_settings?.printer_name || "Printer Kasir Utama",
      printer_status: data.print_settings?.printer_status || "active",
      mode: data.print_settings?.mode || "single_printer"
    }
  ]);
  await insertRows(knex, "print_templates", data.print_templates || []);
  await insertRows(knex, "payment_methods", data.payment_methods || defaultPaymentMethods);
  await insertRows(knex, "financial_accounts", data.financial_accounts || defaultFinancialAccounts);
}

async function seedDemo(knex) {
  getDemoSeedData();
  const adminHash = bcrypt.hashSync("admin123", 10);
  const cashierHash = bcrypt.hashSync("demo123", 10);

  await clearSeedTables(knex);

  await insertRows(knex, "metadata", [
    { key: "metadata", value: jsonValue(data.metadata) },
    { key: "design_tokens", value: jsonValue(data.design_tokens) },
    {
      key: "app_security",
      value: jsonValue({
        report_pin_enabled: data.app_security?.report_pin_enabled !== false,
        report_pin_hash: bcrypt.hashSync(String(data.app_security?.report_pin || "000000"), 10)
      })
    }
  ]);

  await insertRows(
    knex,
    "permissions",
    permissionCatalog.map((permission) => ({
      key: permission.key,
      group: permission.group,
      label: permission.label,
      route: permission.route,
      actions: jsonValue(permission.actions)
    }))
  );

  await insertRows(
    knex,
    "roles",
    data.roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      permissions: jsonValue(defaultRolePermissions[role.id] || role.permissions)
    }))
  );

  await insertRows(knex, "outlets", data.outlets);

  await insertRows(
    knex,
    "users",
    data.users.map((user) => ({
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      password_hash: user.role_id === "role_cashier" ? cashierHash : adminHash,
      pin_hash: user.role_id === "role_cashier" ? bcrypt.hashSync(user.cashier_pin || "000000", 10) : null,
      role_id: user.role_id,
      status: user.status,
      last_login_at: user.last_login_at || null,
      password_changed_at: user.password_changed_at || null,
      password_reset_at: user.password_reset_at || null
    }))
  );

  await insertRows(
    knex,
    "user_outlets",
    data.users.flatMap((user) =>
      (user.outlet_ids || []).map((outletId) => ({
        user_id: user.id,
        outlet_id: outletId
      }))
    )
  );

  await insertRows(
    knex,
    "customers",
    data.customers.map((customer) => ({
      ...customer,
      points: customer.points || 0
    }))
  );
  await insertRows(knex, "categories", data.categories);
  await insertRows(knex, "products", data.products);
  await insertRows(knex, "product_prices", data.product_prices);
  await insertRows(knex, "raw_material_categories", data.raw_material_categories || defaultRawMaterialCategories);
  await insertRows(knex, "units", unitRows());
  await insertRows(knex, "raw_materials", rawMaterialRows());
  await insertRows(knex, "stock_opname_material_selections", stockOpnameMaterialSelectionRows());
  await insertRows(knex, "product_compositions", data.product_compositions);
  await insertRows(knex, "suppliers", data.suppliers);

  await insertRows(
    knex,
    "purchases",
    data.purchases.map(({ items, ...purchase }) => purchase)
  );
  await insertRows(knex, "purchase_items", purchaseItemRows());
  await insertRows(knex, "raw_material_stocks", data.raw_material_stocks);

  await insertRows(
    knex,
    "stock_transfers",
    data.stock_transfers.map(({ items, ...transfer }) => transfer)
  );
  await insertRows(knex, "stock_transfer_items", transferItemRows());
  await insertRows(knex, "stock_opnames", data.stock_opnames);
  await insertRows(knex, "dining_tables", data.tables);
  await insertRows(knex, "expense_categories", expenseCategoryRows());

  await insertRows(knex, "print_settings", [
    {
      id: "default",
      printer_name: data.print_settings.printer_name,
      printer_status: data.print_settings.printer_status,
      mode: data.print_settings.mode
    }
  ]);
  await insertRows(knex, "print_templates", data.print_templates);

  await insertRows(knex, "transactions", data.transactions);
  await insertRows(knex, "transaction_items", data.transaction_items);
  await insertRows(knex, "payment_methods", data.payment_methods || defaultPaymentMethods);
  await insertRows(
    knex,
    "payments",
    data.payments.map((payment) => ({
      ...payment,
      payment_method_id: payment.payment_method_id || defaultPaymentMethods.find((item) => item.code === payment.method)?.id || null,
      change_amount: payment.change_amount || 0
    }))
  );
  await insertRows(knex, "transaction_refunds", data.transaction_refunds || []);
  await insertRows(knex, "expenses", data.expenses);
  await insertRows(
    knex,
    "discounts",
    (data.discounts || []).map(({ outlet_ids, outlets, ...discount }) => discount)
  );
  await insertRows(knex, "discount_outlets", discountOutletRows());
  await insertRows(knex, "product_variants", data.product_variants || []);
  await insertRows(knex, "pos_product_favorites", data.pos_product_favorites || []);
  await insertRows(knex, "activity_logs", data.activity_logs || []);
  await insertRows(knex, "financial_accounts", data.financial_accounts || defaultFinancialAccounts);
  await insertRows(knex, "balance_sheet_entries", data.balance_sheet_entries || []);

  await insertRows(
    knex,
    "report_snapshots",
    Object.entries(data.report_snapshots || {}).map(([key, payload]) => ({
      key,
      payload: jsonValue(payload)
    }))
  );
}

exports.seed = async function seed(knex) {
  if (seedMode === "demo") {
    await seedDemo(knex);
    return;
  }
  await seedClean(knex);
};
