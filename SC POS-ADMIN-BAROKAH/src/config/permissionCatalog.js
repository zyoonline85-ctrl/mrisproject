export const permissionGroups = [
  { key: "dashboard", label: "Dashboard" },
  { key: "master", label: "Master Data" },
  { key: "inventory", label: "Inventory" },
  { key: "reports", label: "Laporan" },
  { key: "finance", label: "Finance" },
  { key: "settings", label: "Pengaturan" },
  { key: "apk", label: "APK Kasir" }
];

export const actionLabels = {
  view: "Lihat",
  create: "Tambah",
  update: "Edit",
  toggle_status: "Aktif/Nonaktif",
  manage_price: "Kelola Harga",
  manage_composition: "Kelola Komposisi",
  generate_barcode: "Generate Barcode",
  print_barcode: "Print Barcode",
  reset_password: "Reset Password",
  detail: "Detail",
  purchase: "Pembelian",
  transfer: "Transfer",
  opname: "Opname",
  export: "Export",
  approve: "Approve",
  reject: "Reject",
  refund: "Refund",
  cancel: "Cancel",
  delete: "Hapus",
  print: "Print"
};

export const permissionCatalog = [
  { key: "dashboard", group: "dashboard", label: "Dashboard", route: "/dashboard", actions: ["view"] },
  {
    key: "master.products",
    group: "master",
    label: "Produk",
    route: "/master-data/produk",
    actions: ["view", "create", "update", "toggle_status", "manage_price", "manage_composition"]
  },
  {
    key: "master.categories",
    group: "master",
    label: "Kategori Produk",
    route: "/master-data/kategori-produk",
    actions: ["view", "create", "update", "toggle_status"]
  },
  {
    key: "master.expense_categories",
    group: "master",
    label: "Nama Pengeluaran Operasional",
    route: "/master-data/kategori-pengeluaran",
    actions: ["view", "create", "update", "toggle_status"]
  },
  {
    key: "master.payment_methods",
    group: "master",
    label: "Metode Pembayaran",
    route: "/master-data/metode-pembayaran",
    actions: ["view", "create", "update", "toggle_status"]
  },
  {
    key: "master.discounts",
    group: "master",
    label: "Discount",
    route: "/master-data/discount",
    actions: ["view", "create", "update", "toggle_status"]
  },
  {
    key: "master.customers",
    group: "master",
    label: "Customer",
    route: "/master-data/customer",
    actions: ["view", "create", "update", "toggle_status", "generate_barcode", "print_barcode"]
  },
  {
    key: "master.tables",
    group: "master",
    label: "Meja",
    route: "/master-data/meja",
    actions: ["view", "create", "update", "toggle_status"]
  },
  {
    key: "master.users",
    group: "master",
    label: "User & Permission",
    route: "/master-data/user-permission",
    actions: ["view", "create", "update", "toggle_status", "reset_password"]
  },
  { key: "master.outlets", group: "master", label: "Outlet", route: "/master-data/outlet", actions: ["view", "create", "update", "toggle_status"] },
  {
    key: "master.suppliers",
    group: "master",
    label: "Supplier",
    route: "/master-data/supplier",
    actions: ["view", "create", "update", "toggle_status"]
  },
  {
    key: "master.materials",
    group: "master",
    label: "Harga Pokok Produksi",
    route: "/master-data/bahan-baku",
    actions: ["view", "create", "update", "toggle_status"]
  },
  {
    key: "master.material_categories",
    group: "master",
    label: "Kategori Harga Pokok Produksi",
    route: "/master-data/kategori-bahan-baku",
    actions: ["view", "create", "update", "toggle_status"]
  },
  {
    key: "master.units",
    group: "master",
    label: "Satuan / Unit",
    route: "/master-data/satuan-unit",
    actions: ["view", "create", "update", "toggle_status"]
  },
  {
    key: "master.imports",
    group: "master",
    label: "Import Data",
    route: "/master-data/import-data",
    actions: ["view", "create"]
  },
  {
    key: "inventory.stocks",
    group: "inventory",
    label: "Stok Harga Pokok Produksi",
    route: "/inventory/stok-bahan-baku",
    actions: ["view", "detail", "purchase", "transfer", "opname"]
  },
  {
    key: "inventory.purchases",
    group: "inventory",
    label: "Pembelian Harga Pokok Produksi",
    route: "/inventory/pembelian-bahan-baku",
    actions: ["view", "create", "update", "approve", "reject"]
  },
  { key: "inventory.transfers", group: "inventory", label: "Transfer Stok", route: "/inventory/transfer-stok", actions: ["view", "create", "update", "approve", "reject"] },
  {
    key: "inventory.opnames",
    group: "inventory",
    label: "Stock Opname Harga Pokok Produksi",
    route: "/inventory/stock-opname-bahan-baku",
    actions: ["view", "create", "export"]
  },
  { key: "reports.sales", group: "reports", label: "Penjualan", route: "/laporan/penjualan", actions: ["view", "export"] },
  {
    key: "reports.transactions",
    group: "reports",
    label: "Riwayat Transaksi",
    route: "/laporan/riwayat-transaksi",
    actions: ["view", "export", "update", "refund", "cancel"]
  },
  { key: "reports.profit_loss", group: "reports", label: "Laba Rugi", route: "/laporan/laba-rugi", actions: ["view", "export"] },
  { key: "reports.balance_sheet", group: "reports", label: "Neraca", route: "/laporan/neraca", actions: ["view", "export"] },
  { key: "reports.purchases", group: "reports", label: "Pembelian", route: "/laporan/pembelian", actions: ["view", "export"] },
  { key: "reports.expenses", group: "reports", label: "Pengeluaran", route: "/laporan/pengeluaran", actions: ["view", "export", "update", "approve", "reject"] },
  { key: "reports.activity_logs", group: "reports", label: "Log Aktivitas", route: "/laporan/log-aktivitas", actions: ["view", "export"] },
  { key: "finance.accounts", group: "finance", label: "Master Akun", route: "/finance/master-akun", actions: ["view", "create", "update", "toggle_status"] },
  { key: "finance.entries", group: "finance", label: "Entry Keuangan", route: "/finance/entry-keuangan", actions: ["view", "create", "update", "toggle_status"] },
  { key: "settings.permissions", group: "settings", label: "Permission Matrix", route: "/pengaturan/permission-matrix", actions: ["view", "create", "update", "delete"] },
  { key: "settings.printing", group: "settings", label: "Print", route: "/pengaturan/print", actions: ["view", "update"] },
  { key: "settings.app_security", group: "settings", label: "Keamanan APK", route: "/pengaturan/keamanan-apk", actions: ["view", "update"] },
  { key: "settings.profile", group: "settings", label: "Profil Akun", route: "/pengaturan/profil-akun", actions: ["view"] },
  { key: "apk.sales", group: "apk", label: "Kasir / Penjualan", route: "apk://kasir", actions: ["view", "create", "update", "cancel", "print"] },
  { key: "apk.history", group: "apk", label: "Riwayat Transaksi", route: "apk://riwayat", actions: ["view", "print"] },
  { key: "apk.purchases", group: "apk", label: "Pembelian", route: "apk://pembelian", actions: ["view", "create", "update"] },
  { key: "apk.transfers", group: "apk", label: "Transfer", route: "apk://transfer", actions: ["view", "create"] },
  { key: "apk.opnames", group: "apk", label: "Stock Opname", route: "apk://opname", actions: ["view", "create", "update"] },
  { key: "apk.expenses", group: "apk", label: "Pengeluaran", route: "apk://expense", actions: ["view", "create", "update"] },
  { key: "apk.reports", group: "apk", label: "Laporan", route: "apk://laporan", actions: ["view", "export"] },
  { key: "apk.printing", group: "apk", label: "Pengaturan Print", route: "apk://print", actions: ["view", "update", "print"] }
];

export function createFullPermissionMap() {
  return permissionCatalog.reduce((result, permission) => {
    result[permission.key] = [...permission.actions];
    return result;
  }, {});
}

export function createApkFullPermissionMap() {
  return permissionCatalog
    .filter((permission) => permission.group === "apk")
    .reduce((result, permission) => {
      result[permission.key] = [...permission.actions];
      return result;
    }, {});
}

export function hasApkAccess(roleOrPermissions) {
  const permissions = roleOrPermissions?.permissions || roleOrPermissions || {};
  return Object.entries(permissions).some(
    ([key, actions]) => key.startsWith("apk.") && Array.isArray(actions) && actions.includes("view")
  );
}

export function hasAdminAccess(roleOrPermissions) {
  const permissions = roleOrPermissions?.permissions || roleOrPermissions || {};
  return Object.entries(permissions).some(
    ([key, actions]) => !key.startsWith("apk.") && Array.isArray(actions) && actions.includes("view")
  );
}

export const defaultRolePermissions = {
  role_owner: createFullPermissionMap(),
  role_admin: {
    dashboard: ["view"],
    "master.products": ["view", "create", "update", "toggle_status", "manage_price", "manage_composition"],
    "master.categories": ["view", "create", "update", "toggle_status"],
    "master.expense_categories": ["view", "create", "update", "toggle_status"],
    "master.payment_methods": ["view", "create", "update", "toggle_status"],
    "master.discounts": ["view", "create", "update", "toggle_status"],
    "master.customers": ["view", "create", "update", "toggle_status", "generate_barcode", "print_barcode"],
    "master.tables": ["view", "create", "update", "toggle_status"],
    "master.users": ["view", "create", "update", "toggle_status", "reset_password"],
    "master.outlets": ["view", "create", "update", "toggle_status"],
    "master.suppliers": ["view", "create", "update", "toggle_status"],
    "master.materials": ["view", "create", "update", "toggle_status"],
    "master.material_categories": ["view", "create", "update", "toggle_status"],
    "master.units": ["view", "create", "update", "toggle_status"],
    "inventory.stocks": ["view", "detail", "purchase", "transfer", "opname"],
    "inventory.purchases": ["view", "create", "update", "approve", "reject"],
    "inventory.transfers": ["view", "create", "update", "approve", "reject"],
    "inventory.opnames": ["view", "create", "export"],
    "reports.sales": ["view", "export"],
    "reports.transactions": ["view", "export", "update", "refund", "cancel"],
    "reports.profit_loss": ["view", "export"],
    "reports.balance_sheet": ["view", "export"],
    "reports.purchases": ["view", "export"],
    "reports.expenses": ["view", "export", "update", "approve", "reject"],
    "reports.activity_logs": ["view", "export"],
    "finance.accounts": ["view", "create", "update", "toggle_status"],
    "finance.entries": ["view", "create", "update", "toggle_status"],
    "settings.permissions": ["view"],
    "settings.printing": ["view", "update"],
    "settings.app_security": ["view", "update"],
    "settings.profile": ["view"]
  },
  role_cashier: createApkFullPermissionMap()
};
