import 'package:flutter/foundation.dart';
import '../models/app_models.dart';
import '../services/activity_log_service.dart';

class CartProvider extends ChangeNotifier {
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
    notifyListeners();
  }

  void setTransactionNote(String value) {
    final next = value.length > 500 ? value.substring(0, 500) : value;
    if (transactionNote == next) return;
    transactionNote = next;
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
    notifyListeners();
  }
}
