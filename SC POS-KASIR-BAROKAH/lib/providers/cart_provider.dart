import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/app_models.dart';
import '../services/activity_log_service.dart';

class CartProvider extends ChangeNotifier {
  CartProvider() {
    loadCartFromLocal();
  }

  static const _cartCacheKey = 'barokah_pos_local_cart_v2';
  final ActivityLogService _activityLogs = const ActivityLogService();
  final List<CartItem> _items = [];
  String? _lastDineInTableNumber;
  String serviceType = 'dine_in';
  String? tableNumber;
  String? currentOpenBillId;
  String? currentOpenBillOrderNumber;
  String transactionNote = '';
  Customer? selectedCustomer;
  String? manualDiscountType;
  int manualDiscountValue = 0;

  List<CartItem> get items => List.unmodifiable(_items);
  bool get isEmpty => _items.isEmpty;
  int get itemCount => _items.fold(0, (total, item) => total + item.quantity);
  int get subtotal => _items.fold(0, (total, item) => total + item.subtotal);
  bool get hasManualDiscount =>
      manualDiscountType != null &&
      manualDiscountValue > 0 &&
      discountAmount > 0;
  String? get discountLabel => hasManualDiscount ? 'Diskon Manual' : null;
  int get discountAmount {
    if (subtotal <= 0 || manualDiscountValue <= 0) return 0;
    final type = manualDiscountType;
    if (type == 'percent') {
      final amount = ((subtotal * manualDiscountValue) / 100).round();
      return amount > subtotal ? subtotal : amount;
    }
    if (type == 'nominal') {
      return manualDiscountValue > subtotal ? subtotal : manualDiscountValue;
    }
    return 0;
  }

  int get total => totalAfterDiscount;
  int get totalAfterDiscount {
    final value = subtotal - discountAmount;
    return value < 0 ? 0 : value;
  }

  String _variantKey(List<ProductVariant> variants) {
    final ids = variants
        .map((variant) => variant.id)
        .where((id) => id.isNotEmpty)
        .toList()
      ..sort();
    return ids.join('|');
  }

  void addProduct(Product product, String outletId,
      {List<ProductVariant> selectedVariants = const []}) {
    final targetVariantKey = _variantKey(selectedVariants);
    final index = _items.indexWhere((item) =>
        item.product.id == product.id && item.variantKey == targetVariantKey);
    if (index >= 0) {
      _items[index] =
          _items[index].copyWith(quantity: _items[index].quantity + 1);
    } else {
      _items.add(CartItem(
          product: product,
          quantity: 1,
          unitPrice: product.priceForOutlet(outletId),
          selectedVariants: selectedVariants));
    }
    _activityLogs.record(
      outletId: outletId,
      module: 'cart',
      action: 'item_add',
      entityType: 'product',
      entityId: product.id,
      description: 'Menambah ${product.name} ke keranjang.',
      metadata: {
        'variant_count': selectedVariants.length,
        'item_count': itemCount
      },
    );
    _saveCartToLocal();
    notifyListeners();
  }

  void increase(String lineKey) {
    final index = _items.indexWhere((item) => item.lineKey == lineKey);
    if (index < 0) return;
    _items[index] =
        _items[index].copyWith(quantity: _items[index].quantity + 1);
    _activityLogs.record(
        module: 'cart',
        action: 'quantity_increase',
        entityType: 'cart_item',
        entityId: lineKey,
        description: 'Menambah qty item keranjang.',
        metadata: {'quantity': _items[index].quantity});
    _saveCartToLocal();
    notifyListeners();
  }

  void decrease(String lineKey) {
    final index = _items.indexWhere((item) => item.lineKey == lineKey);
    if (index < 0) return;
    final nextQty = _items[index].quantity - 1;
    if (nextQty <= 0) {
      _items.removeAt(index);
    } else {
      _items[index] = _items[index].copyWith(quantity: nextQty);
    }
    _activityLogs.record(
        module: 'cart',
        action: nextQty <= 0 ? 'item_remove' : 'quantity_decrease',
        entityType: 'cart_item',
        entityId: lineKey,
        description: nextQty <= 0
            ? 'Menghapus item dari keranjang.'
            : 'Mengurangi qty item keranjang.',
        metadata: {'quantity': nextQty < 0 ? 0 : nextQty});
    _saveCartToLocal();
    notifyListeners();
  }

  void setServiceType(String value) {
    final normalized = value == 'dine_in' ? 'dine_in' : 'takeaway';
    if (normalized == 'takeaway') {
      if (serviceType == 'dine_in' && tableNumber?.trim().isNotEmpty == true) {
        _lastDineInTableNumber = tableNumber;
      }
      tableNumber = null;
    } else if (tableNumber?.trim().isNotEmpty != true &&
        _lastDineInTableNumber?.trim().isNotEmpty == true) {
      tableNumber = _lastDineInTableNumber;
    }
    serviceType = normalized;
    _activityLogs.record(
        module: 'cart',
        action: 'service_type_select',
        entityType: 'service_type',
        entityId: normalized,
        description: 'Memilih tipe layanan $normalized.');
    _saveCartToLocal();
    notifyListeners();
  }

  void setTable(String? value) {
    tableNumber = value;
    if (value?.trim().isNotEmpty == true) {
      _lastDineInTableNumber = value;
    }
    _activityLogs.record(
        module: 'cart',
        action: 'table_select',
        entityType: 'table',
        entityId: value,
        description: 'Memilih meja transaksi.',
        metadata: {'table_number': value});
    _saveCartToLocal();
    notifyListeners();
  }

  void setCustomer(Customer? customer) {
    selectedCustomer = customer;
    _activityLogs.record(
        module: 'cart',
        action: 'customer_select',
        entityType: 'customer',
        entityId: customer?.id,
        description: customer == null
            ? 'Menghapus customer dari transaksi.'
            : 'Memilih customer transaksi.');
    _saveCartToLocal();
    notifyListeners();
  }

  void setManualDiscount(String? type, int value) {
    final normalizedType = type == 'percent' || type == 'nominal' ? type : null;
    if (normalizedType == null) {
      manualDiscountType = null;
      manualDiscountValue = 0;
      _activityLogs.record(
          module: 'cart',
          action: 'discount_remove',
          entityType: 'discount',
          description: 'Menghapus diskon manual.');
      _saveCartToLocal();
      notifyListeners();
      return;
    }
    manualDiscountType = normalizedType;
    manualDiscountValue = value <= 0
        ? 0
        : normalizedType == 'percent'
            ? value.clamp(1, 100).toInt()
            : value;
    _activityLogs.record(
        module: 'cart',
        action: 'discount_apply',
        entityType: 'discount',
        entityId: normalizedType,
        description: 'Menerapkan diskon manual.',
        metadata: {
          'discount_type': normalizedType,
          'discount_value': manualDiscountValue
        });
    _saveCartToLocal();
    notifyListeners();
  }

  void setTransactionNote(String value) {
    final next = value.length > 500 ? value.substring(0, 500) : value;
    if (transactionNote == next) return;
    transactionNote = next;
    _saveCartToLocal();
    notifyListeners();
  }

  void clearDiscount() {
    if (manualDiscountType == null && manualDiscountValue == 0) return;
    manualDiscountType = null;
    manualDiscountValue = 0;
    _activityLogs.record(
        module: 'cart',
        action: 'discount_remove',
        entityType: 'discount',
        description: 'Menghapus diskon manual.');
    _saveCartToLocal();
    notifyListeners();
  }

  void loadOpenBill(OpenBill bill, List<Product> products, Customer? customer) {
    final productMap = {for (final product in products) product.id: product};
    _items
      ..clear()
      ..addAll(bill.items.map((item) {
        final product = productMap[item.productId] ??
            Product(
                id: item.productId,
                categoryId: item.categoryId,
                sku: item.productId,
                name: item.productName,
                prices: {bill.outletId: item.unitPrice},
                categoryName: item.categoryName,
                categorySortOrder: item.categorySortOrder,
                variants: item.selectedVariants);
        return CartItem(
            product: product,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            selectedVariants: item.selectedVariants);
      }));
    serviceType = bill.serviceType;
    tableNumber = bill.tableNumber;
    _lastDineInTableNumber =
        bill.serviceType == 'dine_in' ? bill.tableNumber : null;
    currentOpenBillId = bill.id;
    currentOpenBillOrderNumber = bill.orderNumber;
    transactionNote = '';
    manualDiscountType = null;
    manualDiscountValue = 0;
    selectedCustomer = customer ??
        (bill.customerId == null
            ? null
            : Customer(
                id: bill.customerId!,
                outletId: bill.outletId,
                name: bill.customerName ?? '',
                phone: bill.customerPhone ?? '',
                barcode: '',
                points: bill.customerPoints));
    _saveCartToLocal();
    notifyListeners();
  }

  void attachOpenBill(OpenBill bill) {
    currentOpenBillId = bill.id;
    currentOpenBillOrderNumber = bill.orderNumber;
    serviceType = bill.serviceType;
    tableNumber = bill.tableNumber;
    if (bill.serviceType == 'dine_in') {
      _lastDineInTableNumber = bill.tableNumber;
    }
    _saveCartToLocal();
    notifyListeners();
  }

  void clear() {
    _items.clear();
    serviceType = 'dine_in';
    tableNumber = null;
    _lastDineInTableNumber = null;
    currentOpenBillId = null;
    currentOpenBillOrderNumber = null;
    transactionNote = '';
    selectedCustomer = null;
    manualDiscountType = null;
    manualDiscountValue = 0;
    _clearLocalCart();
    notifyListeners();
  }

  // --- Serialization & SharedPreferences Caching Helpers ---
  Map<String, dynamic> _productToJson(Product product) {
    return {
      'id': product.id,
      'categoryId': product.categoryId,
      'sku': product.sku,
      'name': product.name,
      'prices': product.prices,
      'categoryName': product.categoryName,
      'categorySortOrder': product.categorySortOrder,
      'imageUrl': product.imageUrl,
      'variants': product.variants.map((v) => v.toJson()).toList(),
    };
  }

  Product _productFromJson(Map<String, dynamic> json) {
    return Product(
      id: json['id']?.toString() ?? '',
      categoryId: json['categoryId']?.toString() ?? '',
      sku: json['sku']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      prices: Map<String, int>.from(json['prices'] ?? {}),
      categoryName: json['categoryName']?.toString() ?? '',
      categorySortOrder: json['categorySortOrder'] as int? ?? 0,
      imageUrl: json['imageUrl']?.toString() ?? '',
      variants: List<dynamic>.from(json['variants'] ?? [])
          .map((v) => ProductVariant.fromJson(Map<String, dynamic>.from(v)))
          .toList(),
    );
  }

  Map<String, dynamic> _cartItemToJson(CartItem item) {
    return {
      'product': _productToJson(item.product),
      'quantity': item.quantity,
      'unitPrice': item.unitPrice,
      'selectedVariants': item.selectedVariants.map((v) => v.toJson()).toList(),
    };
  }

  CartItem _cartItemFromJson(Map<String, dynamic> json) {
    return CartItem(
      product: _productFromJson(Map<String, dynamic>.from(json['product'])),
      quantity: json['quantity'] as int? ?? 1,
      unitPrice: json['unitPrice'] as int? ?? 0,
      selectedVariants: List<dynamic>.from(json['selectedVariants'] ?? [])
          .map((v) => ProductVariant.fromJson(Map<String, dynamic>.from(v)))
          .toList(),
    );
  }

  Future<void> _saveCartToLocal() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final data = {
        'items': _items.map((item) => _cartItemToJson(item)).toList(),
        'serviceType': serviceType,
        'tableNumber': tableNumber,
        '_lastDineInTableNumber': _lastDineInTableNumber,
        'currentOpenBillId': currentOpenBillId,
        'currentOpenBillOrderNumber': currentOpenBillOrderNumber,
        'transactionNote': transactionNote,
        'manualDiscountType': manualDiscountType,
        'manualDiscountValue': manualDiscountValue,
        'selectedCustomer': selectedCustomer != null ? {
          'id': selectedCustomer!.id,
          'outletId': selectedCustomer!.outletId,
          'name': selectedCustomer!.name,
          'phone': selectedCustomer!.phone,
          'barcode': selectedCustomer!.barcode,
          'points': selectedCustomer!.points,
        } : null,
      };
      await prefs.setString(_cartCacheKey, jsonEncode(data));
    } catch (e) {
      if (kDebugMode) print('Failed to save cart locally: $e');
    }
  }

  Future<void> loadCartFromLocal() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_cartCacheKey);
      if (raw == null || raw.isEmpty) return;
      final data = jsonDecode(raw) as Map<String, dynamic>;

      _items.clear();
      if (data['items'] is List) {
        final list = data['items'] as List;
        _items.addAll(list.map((item) => _cartItemFromJson(Map<String, dynamic>.from(item))));
      }
      serviceType = data['serviceType']?.toString() ?? 'dine_in';
      tableNumber = data['tableNumber']?.toString();
      _lastDineInTableNumber = data['_lastDineInTableNumber']?.toString();
      currentOpenBillId = data['currentOpenBillId']?.toString();
      currentOpenBillOrderNumber = data['currentOpenBillOrderNumber']?.toString();
      transactionNote = data['transactionNote']?.toString() ?? '';
      manualDiscountType = data['manualDiscountType']?.toString();
      manualDiscountValue = data['manualDiscountValue'] as int? ?? 0;
      if (data['selectedCustomer'] != null) {
        final cust = data['selectedCustomer'] as Map<String, dynamic>;
        selectedCustomer = Customer(
          id: cust['id']?.toString() ?? '',
          outletId: cust['outletId']?.toString() ?? '',
          name: cust['name']?.toString() ?? '',
          phone: cust['phone']?.toString() ?? '',
          barcode: cust['barcode']?.toString() ?? '',
          points: cust['points'] as int? ?? 0,
        );
      }
      notifyListeners();
    } catch (e) {
      if (kDebugMode) print('Failed to load cart locally: $e');
    }
  }

  Future<void> _clearLocalCart() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_cartCacheKey);
    } catch (e) {
      if (kDebugMode) print('Failed to clear local cart: $e');
    }
  }
}
