import '../models/app_models.dart';

class MockData {
  static const outlets = [
    Outlet(
        id: 'outlet_001',
        name: 'Barokah Pusat',
        code: 'BKP',
        address: 'Jl. Melati No. 12, Jakarta Selatan',
        phone: '021-555-0101'),
    Outlet(
        id: 'outlet_002',
        name: 'Barokah Cabang 2',
        code: 'BKC2',
        address: 'Jl. Kenanga No. 8, Depok',
        phone: '021-555-0202'),
  ];
  static const users = [
    CashierUser(
        id: 'user_004',
        name: 'Rina Lestari',
        username: 'kasir.pusat',
        password: 'demo123',
        outletIds: ['outlet_001', 'outlet_002'],
        active: true),
    CashierUser(
        id: 'user_005',
        name: 'Fajar Nugroho',
        username: 'kasir.cabang',
        password: 'demo123',
        outletIds: ['outlet_002'],
        active: true),
  ];
  static const categories = [
    ProductCategory(id: 'cat_001', name: 'Makanan'),
    ProductCategory(id: 'cat_002', name: 'Minuman'),
    ProductCategory(id: 'cat_003', name: 'Snack'),
    ProductCategory(id: 'cat_004', name: 'Paket'),
  ];
  static const expenseCategories = [
    ExpenseCategory(
        id: 'expense_cat_001',
        name: 'Operasional',
        sortOrder: 1,
        status: 'active'),
    ExpenseCategory(
        id: 'expense_cat_002',
        name: 'Kebersihan',
        sortOrder: 2,
        status: 'active'),
    ExpenseCategory(
        id: 'expense_cat_003',
        name: 'Transport',
        sortOrder: 3,
        status: 'active'),
    ExpenseCategory(
        id: 'expense_cat_004',
        name: 'Perawatan',
        sortOrder: 4,
        status: 'active'),
    ExpenseCategory(
        id: 'expense_cat_005',
        name: 'Packaging',
        sortOrder: 5,
        status: 'active'),
  ];
  static const printSettings = PrintSettings(
      printerName: 'Printer Kasir Utama',
      printerStatus: 'active',
      mode: 'single_printer_mock',
      paperSize: '58mm');
  static const printTemplates = [
    PrintTemplate(
        key: 'customer_order', label: 'Customer Order Copy', enabled: true),
    PrintTemplate(key: 'kitchen_order', label: 'Kitchen Order', enabled: false),
    PrintTemplate(
        key: 'bill_receipt',
        label: 'Bill / Receipt',
        enabled: true,
        footerText: 'Terima kasih'),
  ];
  static const products = [
    Product(
        id: 'product_001',
        categoryId: 'cat_001',
        sku: 'MKN-001',
        name: 'Nasi Goreng Barokah',
        prices: {'outlet_001': 25000, 'outlet_002': 26000}),
    Product(
        id: 'product_002',
        categoryId: 'cat_001',
        sku: 'MKN-002',
        name: 'Mie Goreng Spesial',
        prices: {'outlet_001': 23000, 'outlet_002': 24000}),
    Product(
        id: 'product_003',
        categoryId: 'cat_001',
        sku: 'MKN-003',
        name: 'Ayam Geprek',
        prices: {'outlet_001': 26000, 'outlet_002': 27000}),
    Product(
        id: 'product_004',
        categoryId: 'cat_001',
        sku: 'MKN-004',
        name: 'Ayam Bakar',
        prices: {'outlet_001': 30000, 'outlet_002': 31000}),
    Product(
        id: 'product_005',
        categoryId: 'cat_001',
        sku: 'MKN-005',
        name: 'Soto Ayam',
        prices: {'outlet_001': 22000, 'outlet_002': 23000}),
    Product(
        id: 'product_006',
        categoryId: 'cat_001',
        sku: 'MKN-006',
        name: 'Bakso Kuah',
        prices: {'outlet_001': 23000, 'outlet_002': 24000}),
    Product(
        id: 'product_007',
        categoryId: 'cat_001',
        sku: 'MKN-007',
        name: 'Nasi Ayam Penyet',
        prices: {'outlet_001': 28000, 'outlet_002': 29000}),
    Product(
        id: 'product_008',
        categoryId: 'cat_001',
        sku: 'MKN-008',
        name: 'Nasi Rendang',
        prices: {'outlet_001': 32000, 'outlet_002': 33000}),
    Product(
        id: 'product_009',
        categoryId: 'cat_001',
        sku: 'MKN-009',
        name: 'Lele Goreng',
        prices: {'outlet_001': 24000, 'outlet_002': 25000}),
    Product(
        id: 'product_010',
        categoryId: 'cat_004',
        sku: 'PKT-001',
        name: 'Paket Hemat 1',
        prices: {'outlet_001': 35000, 'outlet_002': 36000}),
    Product(
        id: 'product_011',
        categoryId: 'cat_002',
        sku: 'MNM-001',
        name: 'Es Teh Manis',
        prices: {'outlet_001': 6000, 'outlet_002': 7000}),
    Product(
        id: 'product_012',
        categoryId: 'cat_002',
        sku: 'MNM-002',
        name: 'Es Jeruk',
        prices: {'outlet_001': 10000, 'outlet_002': 11000}),
    Product(
        id: 'product_013',
        categoryId: 'cat_002',
        sku: 'MNM-003',
        name: 'Kopi Hitam',
        prices: {'outlet_001': 8000, 'outlet_002': 9000}),
    Product(
        id: 'product_014',
        categoryId: 'cat_002',
        sku: 'MNM-004',
        name: 'Kopi Susu',
        prices: {'outlet_001': 12000, 'outlet_002': 13000}),
    Product(
        id: 'product_015',
        categoryId: 'cat_002',
        sku: 'MNM-005',
        name: 'Air Mineral',
        prices: {'outlet_001': 5000, 'outlet_002': 6000}),
    Product(
        id: 'product_016',
        categoryId: 'cat_002',
        sku: 'MNM-006',
        name: 'Jus Alpukat',
        prices: {'outlet_001': 16000, 'outlet_002': 17000}),
    Product(
        id: 'product_017',
        categoryId: 'cat_002',
        sku: 'MNM-007',
        name: 'Teh Tarik',
        prices: {'outlet_001': 12000, 'outlet_002': 13000}),
    Product(
        id: 'product_018',
        categoryId: 'cat_003',
        sku: 'SNK-001',
        name: 'Pisang Goreng',
        prices: {'outlet_001': 15000, 'outlet_002': 16000}),
    Product(
        id: 'product_019',
        categoryId: 'cat_003',
        sku: 'SNK-002',
        name: 'Kentang Goreng',
        prices: {'outlet_001': 17000, 'outlet_002': 18000}),
    Product(
        id: 'product_020',
        categoryId: 'cat_003',
        sku: 'SNK-003',
        name: 'Roti Bakar Coklat',
        prices: {'outlet_001': 18000, 'outlet_002': 19000}),
  ];
  static const tables = [
    DiningTable(id: 'table_001', outletId: 'outlet_001', number: 'A1'),
    DiningTable(id: 'table_002', outletId: 'outlet_001', number: 'A2'),
    DiningTable(id: 'table_003', outletId: 'outlet_001', number: 'A3'),
    DiningTable(id: 'table_004', outletId: 'outlet_001', number: 'A4'),
    DiningTable(id: 'table_005', outletId: 'outlet_001', number: 'A5'),
    DiningTable(id: 'table_006', outletId: 'outlet_002', number: 'B1'),
    DiningTable(id: 'table_007', outletId: 'outlet_002', number: 'B2'),
    DiningTable(id: 'table_008', outletId: 'outlet_002', number: 'B3'),
    DiningTable(id: 'table_009', outletId: 'outlet_002', number: 'B4'),
    DiningTable(id: 'table_010', outletId: 'outlet_002', number: 'B5'),
  ];
  static const customers = [
    Customer(
        id: 'customer_001',
        outletId: 'outlet_001',
        name: 'Andi Wijaya',
        phone: '081210010001',
        barcode: 'CUST-BKP-0001'),
    Customer(
        id: 'customer_002',
        outletId: 'outlet_001',
        name: 'Budi Santoso',
        phone: '081210010002',
        barcode: 'CUST-BKP-0002'),
    Customer(
        id: 'customer_007',
        outletId: 'outlet_002',
        name: 'Nadia Putri',
        phone: '081220020001',
        barcode: 'CUST-BKC2-0001'),
    Customer(
        id: 'customer_008',
        outletId: 'outlet_002',
        name: 'Hendra Saputra',
        phone: '081220020002',
        barcode: 'CUST-BKC2-0002'),
  ];
}
