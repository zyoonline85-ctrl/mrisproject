import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/app_models.dart';
import '../repositories/catalog_repository.dart';
import '../repositories/pos_repository.dart';
import '../utils/table_number_sort.dart';

class CatalogProvider extends ChangeNotifier {
  CatalogProvider({CatalogRepository? repository})
      : _repository = repository ?? CatalogRepository();

  final CatalogRepository _repository;
  static const _customerStorageKey = 'barokah_pos_customers';
  static const _printSetupStorageKey = 'barokah_pos_print_setup';
  static const _defaultPrintSettings = PrintSettings(
    printerName: 'Printer Kasir Utama',
    printerStatus: 'active',
    mode: 'single_printer',
  );
  static const _defaultPrintTemplates = [
    PrintTemplate(
        key: 'customer_order', label: 'Customer Order Copy', enabled: true),
    PrintTemplate(key: 'kitchen_order', label: 'Kitchen Order', enabled: true),
    PrintTemplate(
        key: 'bill_receipt',
        label: 'Bill / Receipt',
        enabled: true,
        footerText: 'Terima kasih'),
  ];
  String _selectedCategoryId = 'all';
  String _keyword = '';
  bool _loading = false;
  bool _refreshingCustomers = false;
  bool _submittingCustomer = false;
  String? _errorMessage;
  String _lastSyncLabel = 'backend';
  List<Outlet> _outlets = const [];
  List<Outlet> _transferOutlets = const [];
  List<CashierUser> _cashiers = const [];
  List<ProductCategory> _categories = const [];
  List<ExpenseCategory> _expenseCategories = const [];
  List<PaymentMethod> _paymentMethods = PaymentMethod.defaults;
  List<Discount> _discounts = const [];
  List<RawMaterialCategory> _rawMaterialCategories = const [];
  List<RawMaterial> _rawMaterials = const [];
  List<Supplier> _suppliers = const [];
  List<Product> _products = const [];
  List<Customer> _customers = const [];
  List<DiningTable> _tables = const [];
  PrintSettings _printSettings = _defaultPrintSettings;
  PrintSettings _snapshotPrintSettings = _defaultPrintSettings;
  List<PrintTemplate> _printTemplates = _defaultPrintTemplates;
  AppSecuritySettings _appSecurity = const AppSecuritySettings();

  String get selectedCategoryId => _selectedCategoryId;
  bool get loading => _loading;
  bool get refreshingCustomers => _refreshingCustomers;
  bool get submittingCustomer => _submittingCustomer;
  String? get errorMessage => _errorMessage;
  String get lastSyncLabel => _lastSyncLabel;
  List<Outlet> get outlets => _outlets;
  List<Outlet> get transferOutlets =>
      _transferOutlets.isEmpty ? _outlets : _transferOutlets;
  List<CashierUser> get cashiers => _cashiers;
  List<ProductCategory> get categories {
    final categories = List<ProductCategory>.from(_categories);
    categories.sort((a, b) {
      final byOrder = a.sortOrder.compareTo(b.sortOrder);
      if (byOrder != 0) return byOrder;
      return a.name.toLowerCase().compareTo(b.name.toLowerCase());
    });
    return categories;
  }

  PrintSettings get printSettings => _printSettings;
  List<PrintTemplate> get printTemplates => List.unmodifiable(_printTemplates);
  AppSecuritySettings get appSecurity => _appSecurity;
  List<ExpenseCategory> get expenseCategories {
    final categories = _expenseCategories
        .where((category) => category.status == 'active')
        .toList();
    categories.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
    return categories;
  }

  List<PaymentMethod> get paymentMethods {
    final methods = _paymentMethods.where((method) => method.isActive).toList();
    methods.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
    return methods.isEmpty ? PaymentMethod.defaults : methods;
  }

  PaymentMethod get defaultPaymentMethod {
    final methods = paymentMethods;
    return methods.firstWhere(
      (method) => method.code == 'cash',
      orElse: () => methods.first,
    );
  }

  PaymentMethod? paymentMethodByCode(String code) {
    final normalizedCode = code.toLowerCase();
    for (final method in paymentMethods) {
      if (method.code == normalizedCode) return method;
    }
    return null;
  }

  String paymentLabel(String code) {
    final method = paymentMethodByCode(code);
    if (method != null) return method.name;
    return code.isEmpty ? '-' : code.toUpperCase();
  }

  List<Discount> get discounts {
    final items = _discounts.where((discount) => discount.isActive).toList();
    items.sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    return items;
  }

  List<Discount> discountsForOutlet(String outletId) => discounts
      .where((discount) => discount.appliesToOutlet(outletId))
      .toList();

  Discount? discountById(String? id) {
    if (id == null || id.isEmpty) return null;
    for (final discount in _discounts) {
      if (discount.id == id) return discount;
    }
    return null;
  }

  void upsertDiscount(Discount discount) {
    final index = _discounts.indexWhere((item) => item.id == discount.id);
    if (index >= 0) {
      _discounts = [
        ..._discounts.take(index),
        discount,
        ..._discounts.skip(index + 1),
      ];
    } else {
      _discounts = [..._discounts, discount];
    }
    notifyListeners();
  }

  void replaceDiscountsForOutlet(String outletId, List<Discount> discounts) {
    final nextIds = discounts.map((discount) => discount.id).toSet();
    _discounts = [
      ..._discounts.where((discount) {
        if (nextIds.contains(discount.id)) return false;
        return !discount.outletIds.contains(outletId);
      }),
      ...discounts,
    ];
    notifyListeners();
  }

  List<RawMaterialCategory> get rawMaterialCategories =>
      List.unmodifiable(_rawMaterialCategories
          .where((category) => category.status == 'active')
          .toList());

  List<RawMaterial> get rawMaterials {
    final materials =
        _rawMaterials.where((material) => material.status == 'active').toList();
    materials
        .sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    return materials;
  }

  List<Supplier> get suppliers {
    final suppliers =
        _suppliers.where((supplier) => supplier.status == 'active').toList();
    suppliers
        .sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    return suppliers;
  }

  List<Customer> get customers => _customers;
  Future<void> loadCatalog() async {
    _loading = true;
    _errorMessage = null;
    notifyListeners();
    final CatalogSnapshot snapshot;
    try {
      snapshot = await _repository.loadSnapshot();
    } catch (error) {
      _loading = false;
      _errorMessage = error.toString();
      notifyListeners();
      rethrow;
    }
    _outlets = snapshot.outlets;
    _transferOutlets = snapshot.transferOutlets;
    _cashiers = snapshot.cashiers;
    _categories = snapshot.categories;
    _expenseCategories = snapshot.expenseCategories;
    _paymentMethods = snapshot.paymentMethods.isEmpty
        ? PaymentMethod.defaults
        : snapshot.paymentMethods;
    _discounts = snapshot.discounts;
    _rawMaterialCategories = snapshot.rawMaterialCategories;
    _rawMaterials = snapshot.rawMaterials;
    _suppliers = snapshot.suppliers;
    _products = snapshot.products;
    final snapshotCustomers = snapshot.customers;
    final storedCustomers = await _loadStoredCustomers();
    _customers = _mergeCustomers(snapshotCustomers, storedCustomers);
    _tables = snapshot.tables;
    _snapshotPrintSettings = snapshot.printSettings;
    _printSettings = _snapshotPrintSettings;
    _printTemplates =
        _mergePrintTemplates(snapshot.printTemplates, _defaultPrintTemplates);
    _appSecurity = snapshot.appSecurity;
    await _applyStoredPrintSetup();
    _lastSyncLabel = snapshot.generatedAt;
    _loading = false;
    await _saveCustomers();
    notifyListeners();
  }

  Future<List<Customer>> _loadStoredCustomers() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_customerStorageKey);
    if (raw == null) return const [];
    final decoded = jsonDecode(raw) as List;
    return decoded
        .map((item) => Customer.fromJson(Map<String, dynamic>.from(item)))
        .where((customer) => customer.id.isNotEmpty)
        .toList();
  }

  List<Customer> _mergeCustomers(
      List<Customer> snapshotCustomers, List<Customer> storedCustomers) {
    final storedById = {
      for (final customer in storedCustomers) customer.id: customer
    };
    final result = snapshotCustomers.map((customer) {
      final stored = storedById[customer.id];
      return stored == null
          ? customer
          : customer.copyWith(points: stored.points);
    }).toList();
    final snapshotIds =
        snapshotCustomers.map((customer) => customer.id).toSet();
    result.addAll(storedCustomers
        .where((customer) => !snapshotIds.contains(customer.id)));
    result.sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    return result;
  }

  Future<void> _saveCustomers() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_customerStorageKey,
        jsonEncode(_customers.map((customer) => customer.toJson()).toList()));
  }

  List<PrintTemplate> _mergePrintTemplates(
      List<PrintTemplate> primary, List<PrintTemplate> fallback) {
    final primaryByKey = {
      for (final template in primary) template.key: template
    };
    return fallback.map((fallbackTemplate) {
      final template = primaryByKey[fallbackTemplate.key];
      if (template == null) return fallbackTemplate;
      return template.copyWith(
        label: template.label.isEmpty ? fallbackTemplate.label : template.label,
        enabled: template.enabled,
        footerText: template.footerText,
      );
    }).toList();
  }

  Future<void> _applyStoredPrintSetup() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_printSetupStorageKey);
    if (raw == null) return;
    final decoded = Map<String, dynamic>.from(jsonDecode(raw));
    _printSettings = PrintSettings.fromJson(
        Map<String, dynamic>.from(decoded['settings'] ?? const {}));
  }

  Future<void> _savePrintSetup() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
        _printSetupStorageKey,
        jsonEncode({
          'settings': _printSettings.toJson(),
        }));
  }

  Future<void> resetLocalPrintSetup() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_printSetupStorageKey);
    _printSettings = _snapshotPrintSettings;
    notifyListeners();
  }

  List<DiningTable> tablesForOutlet(String outletId) {
    final tables = _tables
        .where(
            (table) => table.outletId == outletId && table.status == 'active')
        .toList();
    tables.sort((a, b) => compareTableNumbers(a.number, b.number));
    return tables;
  }

  List<Customer> customersForOutlet(String outletId, {String keyword = ''}) {
    final query = keyword.trim().toLowerCase();
    return _customers.where((customer) {
      final matchOutlet = customer.outletId == outletId;
      final text = '${customer.name} ${customer.phone} ${customer.barcode}'
          .toLowerCase();
      return matchOutlet && (query.isEmpty || text.contains(query));
    }).toList();
  }

  Customer? customerById(String? customerId) {
    if (customerId == null) return null;
    for (final customer in _customers) {
      if (customer.id == customerId) return customer;
    }
    return null;
  }

  Future<void> fetchCustomers(String outletId, {String keyword = ''}) async {
    _refreshingCustomers = true;
    _errorMessage = null;
    notifyListeners();
    try {
      final customers = await const PosRepository()
          .getCustomers(outletId: outletId, keyword: keyword);
      _customers.removeWhere((customer) => customer.outletId == outletId);
      _customers.addAll(customers);
      _customers
          .sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
      await _saveCustomers();
    } catch (error) {
      _errorMessage = error.toString();
    } finally {
      _refreshingCustomers = false;
      notifyListeners();
    }
  }

  Future<Customer> addCustomer(
      {required Outlet outlet, required String name, String? phone}) async {
    final cleanName = name.trim();
    final cleanPhone = _normalizePhone(phone ?? '');
    if (cleanPhone.isNotEmpty) {
      for (final customer in _customers) {
        if (customer.outletId == outlet.id &&
            _normalizePhone(customer.phone) == cleanPhone) {
          throw Exception(
              'Nomor HP sudah terdaftar atas nama ${customer.name}. Pilih customer tersebut dari daftar, atau gunakan nomor lain.');
        }
      }
    }

    _submittingCustomer = true;
    _errorMessage = null;
    notifyListeners();
    try {
      final customer = await const PosRepository().createCustomer(
        outletId: outlet.id,
        name: cleanName,
        phone: cleanPhone.isEmpty ? null : cleanPhone,
      );
      _customers.add(customer);
      _customers
          .sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
      await _saveCustomers();
      return customer;
    } catch (error) {
      _errorMessage = error.toString();
      rethrow;
    } finally {
      _submittingCustomer = false;
      notifyListeners();
    }
  }

  Future<Customer?> addCustomerPoints(String? customerId, int points) async {
    if (customerId == null || points <= 0) return customerById(customerId);
    final index =
        _customers.indexWhere((customer) => customer.id == customerId);
    if (index < 0) return null;
    _customers[index] =
        _customers[index].copyWith(points: _customers[index].points + points);
    await _saveCustomers();
    notifyListeners();
    return _customers[index];
  }

  String _normalizePhone(String phone) =>
      phone.replaceAll(RegExp(r'[^0-9+]'), '').trim();

  bool printTemplateEnabled(String key) {
    for (final template in _printTemplates) {
      if (template.key == key) return template.enabled;
    }
    return true;
  }

  bool canPrintTemplate(String key) => printTemplateEnabled(key);

  String printFooterText(String key) {
    for (final template in _printTemplates) {
      if (template.key == key) return template.footerText;
    }
    return '';
  }

  Future<void> updatePrintSettings({
    String? printerName,
    String? printerStatus,
    String? paperSize,
  }) async {
    final cleanName = (printerName ?? _printSettings.printerName).trim();
    _printSettings = _printSettings.copyWith(
      printerName: cleanName.isEmpty ? 'Printer Kasir Utama' : cleanName,
      printerStatus: printerStatus == 'inactive' ? 'inactive' : 'active',
      paperSize: paperSize ?? _printSettings.paperSize,
    );
    await _savePrintSetup();
    notifyListeners();
  }

  Future<void> selectThermalPrinter(ThermalPrinterDevice printer) async {
    _printSettings = _printSettings.copyWith(
      printerName:
          printer.name.isEmpty ? _printSettings.printerName : printer.name,
      printerAddress: printer.address,
      printerStatus: 'active',
      paperSize: '58mm',
    );
    await _savePrintSetup();
    notifyListeners();
  }

  String categoryName(String categoryId) {
    for (final category in _categories) {
      if (category.id == categoryId) return category.name;
    }
    return '';
  }

  void selectCategory(String categoryId) {
    _selectedCategoryId = categoryId;
    notifyListeners();
  }

  void search(String value) {
    _keyword = value.toLowerCase();
    notifyListeners();
  }

  List<Product> productsForOutlet(String outletId,
      {Set<String> favoriteProductIds = const <String>{}}) {
    return _products.where((product) {
      final favoriteMode = _selectedCategoryId == 'favorites';
      final matchCategory = _selectedCategoryId == 'all' ||
          favoriteMode ||
          product.categoryId == _selectedCategoryId;
      final matchFavorite =
          !favoriteMode || favoriteProductIds.contains(product.id);
      final text = '${product.name} ${product.sku}'.toLowerCase();
      final matchKeyword = _keyword.isEmpty || text.contains(_keyword);
      return product.priceForOutlet(outletId) > 0 &&
          matchCategory &&
          matchFavorite &&
          matchKeyword;
    }).toList();
  }

  List<Product> printSampleProductsForOutlet(String outletId) {
    return _products
        .where((product) => product.priceForOutlet(outletId) > 0)
        .take(3)
        .toList();
  }
}
