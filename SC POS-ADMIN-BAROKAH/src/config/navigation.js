import {
  BarChart3,
  Armchair,
  Boxes,
  ClipboardCheck,
  CreditCard,
  Database,
  FileBarChart,
  FileText,
  FileUp,
  LayoutDashboard,
  PackageOpen,
  Printer,
  ReceiptText,
  ShieldCheck,
  Settings,
  Store,
  Tags,
  Truck,
  UserCog,
  Users,
  ClipboardList
} from "lucide-react";

export const navigationGroups = [
  {
    label: "Dashboard",
    to: "/dashboard",
    icon: LayoutDashboard,
    permissionKey: "dashboard"
  },
  {
    label: "Master Data",
    base: "/master-data",
    icon: Database,
    children: [
      { label: "Produk", to: "/master-data/produk", icon: PackageOpen, permissionKey: "master.products" },
      { label: "Customer", to: "/master-data/customer", icon: Users, permissionKey: "master.customers" },
      { label: "Meja", to: "/master-data/meja", icon: Armchair, permissionKey: "master.tables" },
      { label: "User & Permission", to: "/master-data/user-permission", icon: UserCog, permissionKey: "master.users" },
      { label: "Outlet", to: "/master-data/outlet", icon: Store, permissionKey: "master.outlets" },
      { label: "Kategori Produk", to: "/master-data/kategori-produk", icon: Tags, permissionKey: "master.categories" },
      { label: "Biaya Lain Lain", to: "/master-data/kategori-pengeluaran", icon: ReceiptText, permissionKey: "master.expense_categories" },
      { label: "Metode Pembayaran", to: "/master-data/metode-pembayaran", icon: CreditCard, permissionKey: "master.payment_methods" },
      { label: "Supplier", to: "/master-data/supplier", icon: Truck, permissionKey: "master.suppliers" },
      { label: "Kategori Harga Pokok Produksi", to: "/master-data/kategori-bahan-baku", icon: Tags, permissionKey: "master.material_categories" },
      { label: "Harga Pokok Produksi", to: "/master-data/bahan-baku", icon: PackageOpen, permissionKey: "master.materials" },
      { label: "Satuan / Unit", to: "/master-data/satuan-unit", icon: Tags, permissionKey: "master.units" },
      { label: "Import Data", to: "/master-data/import-data", icon: FileUp, permissionKey: "master.imports" }
    ]
  },
  {
    label: "Inventory",
    base: "/inventory",
    icon: Boxes,
    children: [
      { label: "Stok Harga Pokok Produksi", to: "/inventory/stok-bahan-baku", icon: PackageOpen, permissionKey: "inventory.stocks" },
      { label: "Pembelian Harga Pokok Produksi", to: "/inventory/pembelian-bahan-baku", icon: ClipboardCheck, permissionKey: "inventory.purchases" },
      { label: "Transfer Stok", to: "/inventory/transfer-stok", icon: Truck, permissionKey: "inventory.transfers" },
      { label: "Stock Opname Harga Pokok Produksi", to: "/inventory/stock-opname-bahan-baku", icon: FileText, permissionKey: "inventory.opnames" }
    ]
  },
  {
    label: "Laporan",
    base: "/laporan",
    icon: BarChart3,
    children: [
      { label: "Penjualan", to: "/laporan/penjualan", icon: BarChart3, permissionKey: "reports.sales" },
      { label: "Riwayat Transaksi", to: "/laporan/riwayat-transaksi", icon: ReceiptText, permissionKey: "reports.transactions" },
      { label: "Invoice Penjualan", to: "/laporan/invoice-penjualan", icon: FileText, permissionKey: "reports.transactions" },
      { label: "Laba Rugi", to: "/laporan/laba-rugi", icon: FileBarChart, permissionKey: "reports.profit_loss" },
      { label: "Neraca", to: "/laporan/neraca", icon: FileText, permissionKey: "reports.balance_sheet" },
      { label: "Pembelian", to: "/laporan/pembelian", icon: ClipboardCheck, permissionKey: "reports.purchases" },
      { label: "Pengeluaran", to: "/laporan/pengeluaran", icon: ReceiptText, permissionKey: "reports.expenses" },
      { label: "Log Aktivitas", to: "/laporan/log-aktivitas", icon: FileText, permissionKey: "reports.activity_logs" },
      { label: "Persetujuan Laporan", to: "/laporan/persetujuan", icon: ClipboardCheck }
    ]
  },
  {
    label: "Finance",
    base: "/finance",
    icon: FileBarChart,
    children: [
      { label: "Master Akun", to: "/finance/master-akun", icon: FileBarChart, permissionKey: "finance.accounts" },
      { label: "Entry Keuangan", to: "/finance/entry-keuangan", icon: ReceiptText, permissionKey: "finance.entries" }
    ]
  },
  {
    label: "Pengaturan",
    base: "/pengaturan",
    icon: Settings,
    children: [
      { label: "Permission Matrix", to: "/pengaturan/permission-matrix", icon: UserCog, permissionKey: "settings.permissions" },
      { label: "Print", to: "/pengaturan/print", icon: Printer, permissionKey: "settings.printing" },
      { label: "Keamanan APK", to: "/pengaturan/keamanan-apk", icon: ShieldCheck, permissionKey: "settings.app_security" },
      { label: "Profil Akun", to: "/pengaturan/profil-akun", icon: Users, permissionKey: "settings.profile" }
    ]
  }
];

export function getFlatNavigation(groups = navigationGroups) {
  return groups.flatMap((item) => (item.children ? item.children : [item]));
}

export function getRouteTitle(pathname) {
  const exact = getFlatNavigation().find((item) => item.to === pathname);
  if (exact) return exact.label;

  const parent = navigationGroups.find((item) => item.base && pathname.startsWith(item.base));
  return parent?.label || "Dashboard";
}

export function isGroupActive(group, pathname) {
  if (group.to) return pathname === group.to;
  return group.base ? pathname.startsWith(group.base) : false;
}
