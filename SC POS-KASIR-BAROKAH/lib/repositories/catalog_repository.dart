import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/app_models.dart';
import '../services/api_client.dart';

class CatalogSnapshot {
  const CatalogSnapshot({
    required this.outlets,
    required this.transferOutlets,
    required this.cashiers,
    required this.categories,
    required this.expenseCategories,
    required this.paymentMethods,
    required this.discounts,
    required this.rawMaterialCategories,
    required this.rawMaterials,
    required this.suppliers,
    required this.products,
    required this.customers,
    required this.tables,
    required this.printSettings,
    required this.printTemplates,
    required this.appSecurity,
    required this.generatedAt,
  });

  final List<Outlet> outlets;
  final List<Outlet> transferOutlets;
  final List<CashierUser> cashiers;
  final List<ProductCategory> categories;
  final List<ExpenseCategory> expenseCategories;
  final List<PaymentMethod> paymentMethods;
  final List<Discount> discounts;
  final List<RawMaterialCategory> rawMaterialCategories;
  final List<RawMaterial> rawMaterials;
  final List<Supplier> suppliers;
  final List<Product> products;
  final List<Customer> customers;
  final List<DiningTable> tables;
  final PrintSettings printSettings;
  final List<PrintTemplate> printTemplates;
  final AppSecuritySettings appSecurity;
  final String generatedAt;
}

class CatalogRepository {
  static const String _cacheKey = 'barokah_pos_last_catalog_snapshot';

  Future<CatalogSnapshot> loadSnapshot() async {
    try {
      final response = Map<String, dynamic>.from(
          await ApiClient.instance.get('/mobile/catalog'));
      await _saveCache(response);
      return _fromJson(response);
    } on ApiException catch (error) {
      if (error.isUnauthorized) rethrow;
      final cached = await _loadCache();
      if (cached != null) return _fromJson(cached);
    } catch (_) {
      final cached = await _loadCache();
      if (cached != null) return _fromJson(cached);
    }

    throw const ApiException(
        'Butuh koneksi backend pertama kali untuk mengambil catalog.');
  }

  Future<void> _saveCache(Map<String, dynamic> json) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_cacheKey, jsonEncode(json));
  }

  Future<Map<String, dynamic>?> _loadCache() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_cacheKey);
    if (raw == null) return null;
    return Map<String, dynamic>.from(jsonDecode(raw));
  }

  CatalogSnapshot _fromJson(Map<String, dynamic> json) {
    final pricesByProduct = <String, Map<String, int>>{};
    for (final item
        in List<Map<String, dynamic>>.from(json['product_prices'] ?? [])) {
      final productId = item['product_id']?.toString() ?? '';
      final outletId = item['outlet_id']?.toString() ?? '';
      if (productId.isEmpty || outletId.isEmpty) continue;
      pricesByProduct.putIfAbsent(productId, () => <String, int>{})[outletId] =
          NumberParser.toInt(item['price']);
    }
    final categories = List<Map<String, dynamic>>.from(json['categories'] ?? [])
        .map(
          (item) => ProductCategory(
            id: item['id']?.toString() ?? '',
            name: item['name']?.toString() ?? '',
            sortOrder: NumberParser.toInt(item['sort_order']),
          ),
        )
        .where((category) => category.id.isNotEmpty)
        .toList();
    final categoryNameById = {
      for (final category in categories) category.id: category.name
    };
    final categorySortById = {
      for (final category in categories) category.id: category.sortOrder
    };
    final paymentMethods =
        List<Map<String, dynamic>>.from(json['payment_methods'] ?? [])
            .map(PaymentMethod.fromJson)
            .where((method) => method.id.isNotEmpty && method.code.isNotEmpty)
            .toList();
    final discounts = List<Map<String, dynamic>>.from(json['discounts'] ?? [])
        .map(Discount.fromJson)
        .where((discount) => discount.id.isNotEmpty && discount.name.isNotEmpty)
        .toList();
    final outlets = List<Map<String, dynamic>>.from(json['outlets'] ?? [])
        .map(
          (item) => Outlet(
            id: item['id']?.toString() ?? '',
            name: item['name']?.toString() ?? '',
            code: item['code']?.toString() ?? '',
            address: item['address']?.toString() ?? '',
            phone: item['phone']?.toString() ?? '',
          ),
        )
        .where((outlet) => outlet.id.isNotEmpty)
        .toList();
    final transferOutletJson =
        json['transfer_outlets'] ?? json['transferOutlets'];
    final transferOutlets = transferOutletJson == null
        ? outlets
        : List<Map<String, dynamic>>.from(transferOutletJson)
            .map(
              (item) => Outlet(
                id: item['id']?.toString() ?? '',
                name: item['name']?.toString() ?? '',
                code: item['code']?.toString() ?? '',
                address: item['address']?.toString() ?? '',
                phone: item['phone']?.toString() ?? '',
              ),
            )
            .where((outlet) => outlet.id.isNotEmpty)
            .toList();

    return CatalogSnapshot(
      outlets: outlets,
      transferOutlets: transferOutlets,
      cashiers: List<Map<String, dynamic>>.from(json['cashiers'] ?? [])
          .map(
            (item) {
              final rawPermissions = item['permissions'];
              final permissions = <String, List<String>>{};
              if (rawPermissions is Map) {
                for (final entry in rawPermissions.entries) {
                  if (entry.value is List) {
                    permissions[entry.key.toString()] =
                        List<dynamic>.from(entry.value as List)
                            .map((action) => action.toString())
                            .toList();
                  }
                }
              }
              return CashierUser(
                id: item['id']?.toString() ?? '',
                name: item['name']?.toString() ?? '',
                username: item['username']?.toString() ?? '',
                password: item['password']?.toString() ?? 'demo123',
                outletIds: List<dynamic>.from(item['outlet_ids'] ?? [])
                    .map((id) => id.toString())
                    .toList(),
                active: item['status']?.toString() != 'inactive',
                roleId: item['role_id']?.toString() ?? '',
                roleName: item['role_name']?.toString() ?? '',
                permissions: permissions,
              );
            },
          )
          .where((user) => user.id.isNotEmpty && user.outletIds.isNotEmpty)
          .toList(),
      categories: categories,
      expenseCategories:
          List<Map<String, dynamic>>.from(json['expense_categories'] ?? [])
              .map(
                (item) => ExpenseCategory(
                  id: item['id']?.toString() ?? '',
                  name: item['name']?.toString() ?? '',
                  sortOrder: NumberParser.toInt(item['sort_order']),
                  status: item['status']?.toString() ?? 'active',
                ),
              )
              .where((category) => category.id.isNotEmpty)
              .toList(),
      paymentMethods:
          paymentMethods.isEmpty ? PaymentMethod.defaults : paymentMethods,
      discounts: discounts,
      rawMaterialCategories:
          List<Map<String, dynamic>>.from(json['raw_material_categories'] ?? [])
              .map(
                (item) => RawMaterialCategory(
                  id: item['id']?.toString() ?? '',
                  name: item['name']?.toString() ?? '',
                  type: item['type']?.toString() ?? 'hpp',
                  status: item['status']?.toString() ?? 'active',
                ),
              )
              .where((category) => category.id.isNotEmpty)
              .toList(),
      rawMaterials: List<Map<String, dynamic>>.from(json['raw_materials'] ?? [])
          .map(
            (item) => RawMaterial(
              id: item['id']?.toString() ?? '',
              name: item['name']?.toString() ?? '',
              unit: item['unit']?.toString() ?? '',
              type: item['type']?.toString() ?? 'hpp',
              categoryId: item['category_id']?.toString() ?? '',
              status: item['status']?.toString() ?? 'active',
            ),
          )
          .where((material) => material.id.isNotEmpty)
          .toList(),
      suppliers: List<Map<String, dynamic>>.from(json['suppliers'] ?? [])
          .map(
            (item) => Supplier(
              id: item['id']?.toString() ?? '',
              name: item['name']?.toString() ?? '',
              phone: item['phone']?.toString() ?? '',
              status: item['status']?.toString() ?? 'active',
            ),
          )
          .where((supplier) => supplier.id.isNotEmpty)
          .toList(),
      products: List<Map<String, dynamic>>.from(json['products'] ?? [])
          .map(
            (item) {
              final productId = item['id']?.toString() ?? '';
              final variants = List<dynamic>.from(item['variants'] ?? const [])
                  .whereType<Map>()
                  .map((variant) => ProductVariant.fromJson(
                      Map<String, dynamic>.from(variant)))
                  .where((variant) =>
                      variant.id.isNotEmpty && variant.name.isNotEmpty)
                  .toList();
              return Product(
                id: productId,
                categoryId: item['category_id']?.toString() ?? '',
                sku: item['sku']?.toString() ?? '',
                name: item['name']?.toString() ?? '',
                imageUrl: item['image_url']?.toString() ??
                    item['imageUrl']?.toString() ??
                    '',
                categoryName:
                    categoryNameById[item['category_id']?.toString()] ?? '',
                categorySortOrder:
                    categorySortById[item['category_id']?.toString()] ?? 0,
                prices: pricesByProduct[productId] ?? const {},
                variants: variants,
              );
            },
          )
          .where((product) => product.id.isNotEmpty)
          .toList(),
      customers: List<Map<String, dynamic>>.from(json['customers'] ?? [])
          .map(
            (item) => Customer(
              id: item['id']?.toString() ?? '',
              outletId: item['outlet_id']?.toString() ?? '',
              name: item['name']?.toString() ?? '',
              phone: item['phone']?.toString() ?? '',
              barcode: item['barcode']?.toString() ?? '',
              points: NumberParser.toInt(item['points']),
            ),
          )
          .where((customer) => customer.id.isNotEmpty)
          .toList(),
      tables: List<Map<String, dynamic>>.from(json['tables'] ?? [])
          .map(
            (item) => DiningTable(
              id: item['id']?.toString() ?? '',
              outletId: item['outlet_id']?.toString() ?? '',
              number: item['number']?.toString() ?? '',
              status: item['status']?.toString() ?? 'active',
            ),
          )
          .where((table) => table.id.isNotEmpty)
          .toList(),
      printSettings: PrintSettings.fromJson(
          Map<String, dynamic>.from(json['print_settings'] ?? const {})),
      printTemplates:
          List<Map<String, dynamic>>.from(json['print_templates'] ?? [])
              .map((item) => PrintTemplate.fromJson(item))
              .where((template) => template.key.isNotEmpty)
              .toList(),
      appSecurity: AppSecuritySettings.fromJson(
          Map<String, dynamic>.from(json['app_security'] ?? const {})),
      generatedAt: json['generated_at']?.toString() ?? '',
    );
  }
}

class NumberParser {
  const NumberParser._();

  static int toInt(dynamic value) {
    if (value is int) return value;
    if (value is num) return value.round();
    return int.tryParse(value?.toString() ?? '') ?? 0;
  }
}
