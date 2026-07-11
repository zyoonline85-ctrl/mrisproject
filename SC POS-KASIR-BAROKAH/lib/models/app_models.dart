String _asString(Map<String, dynamic> json, String camelKey,
        [String? snakeKey, String fallback = '']) =>
    (json[camelKey] ?? (snakeKey == null ? null : json[snakeKey]))
        ?.toString() ??
    fallback;

String? _nullableString(dynamic value) {
  final text = value?.toString().trim();
  return text == null || text.isEmpty ? null : text;
}

int _asInt(Map<String, dynamic> json, String camelKey,
    [String? snakeKey, int fallback = 0]) {
  final value = json[camelKey] ?? (snakeKey == null ? null : json[snakeKey]);
  if (value is int) return value;
  if (value is num) return value.round();
  return int.tryParse(value?.toString() ?? '') ?? fallback;
}

double _asDouble(Map<String, dynamic> json, String camelKey,
    [String? snakeKey, double fallback = 0]) {
  final value = json[camelKey] ?? (snakeKey == null ? null : json[snakeKey]);
  if (value is double) return value;
  if (value is num) return value.toDouble();
  return double.tryParse(value?.toString() ?? '') ?? fallback;
}

DateTime _asLocalDateTime(Map<String, dynamic> json, String camelKey,
    [String? snakeKey, DateTime? fallback]) {
  final value = json[camelKey] ?? (snakeKey == null ? null : json[snakeKey]);
  if (value is DateTime) return value.toLocal();
  final raw = value?.toString();
  if (raw == null || raw.isEmpty) {
    return (fallback ?? DateTime.now()).toLocal();
  }
  return DateTime.parse(raw).toLocal();
}

class Outlet {
  const Outlet(
      {required this.id,
      required this.name,
      required this.code,
      required this.address,
      required this.phone});
  final String id;
  final String name;
  final String code;
  final String address;
  final String phone;
}

class CashierUser {
  const CashierUser(
      {required this.id,
      required this.name,
      required this.username,
      required this.password,
      required this.outletIds,
      required this.active,
      this.roleId = '',
      this.roleName = '',
      this.permissions = const {}});
  final String id;
  final String name;
  final String username;
  final String password;
  final List<String> outletIds;
  final bool active;
  final String roleId;
  final String roleName;
  final Map<String, List<String>> permissions;

  bool can(String permissionKey, [String action = 'view']) =>
      permissions[permissionKey]?.contains(action) ?? false;

  bool get hasApkAccess => permissions.entries.any(
      (entry) => entry.key.startsWith('apk.') && entry.value.contains('view'));
}

class ProductCategory {
  const ProductCategory(
      {required this.id, required this.name, this.sortOrder = 0});
  final String id;
  final String name;
  final int sortOrder;
}

class ExpenseCategory {
  const ExpenseCategory({
    required this.id,
    required this.name,
    required this.sortOrder,
    this.status = 'active',
  });
  final String id;
  final String name;
  final int sortOrder;
  final String status;
}

class PaymentMethod {
  const PaymentMethod({
    required this.id,
    required this.name,
    required this.code,
    this.accountCode = '',
    this.sortOrder = 0,
    this.status = 'active',
  });

  final String id;
  final String name;
  final String code;
  final String accountCode;
  final int sortOrder;
  final String status;

  bool get isCash => code == 'cash';
  bool get isActive => status != 'inactive';

  static const defaults = [
    PaymentMethod(
      id: 'payment_method_cash',
      name: 'Cash',
      code: 'cash',
      accountCode: '1001',
      sortOrder: 1,
    ),
    PaymentMethod(
      id: 'payment_method_transfer',
      name: 'Transfer',
      code: 'transfer',
      accountCode: '1002',
      sortOrder: 2,
    ),
    PaymentMethod(
      id: 'payment_method_qris',
      name: 'QRIS',
      code: 'qris',
      accountCode: '1044',
      sortOrder: 3,
    ),
  ];

  factory PaymentMethod.fromJson(Map<String, dynamic> json) => PaymentMethod(
        id: _asString(json, 'id'),
        name: _asString(json, 'name'),
        code: _asString(json, 'code').toLowerCase(),
        accountCode: _asString(json, 'accountCode', 'account_code'),
        sortOrder: _asInt(json, 'sortOrder', 'sort_order'),
        status: _asString(json, 'status', null, 'active'),
      );
}

class Discount {
  const Discount({
    required this.id,
    required this.name,
    required this.type,
    required this.value,
    required this.startsAt,
    required this.endsAt,
    this.outletIds = const [],
    this.status = 'active',
  });

  final String id;
  final String name;
  final String type;
  final num value;
  final String startsAt;
  final String endsAt;
  final List<String> outletIds;
  final String status;

  bool get isPercent => type == 'percent';
  bool get isActive {
    if (status == 'inactive') return false;
    final start = DateTime.tryParse(startsAt);
    final end = DateTime.tryParse(endsAt);
    if (start == null || end == null) return false;
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    return !today.isBefore(DateTime(start.year, start.month, start.day)) &&
        !today.isAfter(DateTime(end.year, end.month, end.day));
  }

  bool appliesToOutlet(String outletId) => outletIds.contains(outletId);

  String get valueLabel {
    if (isPercent) {
      final valueText = value % 1 == 0
          ? value.round().toString()
          : value.toStringAsFixed(2).replaceFirst(RegExp(r'\.?0+$'), '');
      return '$valueText%';
    }
    final digits = value.round().toString();
    final formatted =
        digits.replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => '.');
    return 'Rp $formatted';
  }

  int amountFor(int subtotal) {
    final base = subtotal < 0 ? 0 : subtotal;
    if (base == 0) return 0;
    final rawAmount = isPercent ? (base * value / 100).round() : value.round();
    if (rawAmount < 0) return 0;
    return rawAmount > base ? base : rawAmount;
  }

  factory Discount.fromJson(Map<String, dynamic> json) => Discount(
        id: _asString(json, 'id'),
        name: _asString(json, 'name'),
        type: _asString(json, 'type', null, 'nominal'),
        value: _asDouble(json, 'value'),
        startsAt: _asString(json, 'startsAt', 'starts_at'),
        endsAt: _asString(json, 'endsAt', 'ends_at'),
        outletIds: List<dynamic>.from(
                json['outletIds'] ?? json['outlet_ids'] ?? const [])
            .map((id) => id.toString())
            .where((id) => id.isNotEmpty)
            .toList(),
        status: _asString(json, 'status', null, 'active'),
      );
}

class RawMaterialCategory {
  const RawMaterialCategory({
    required this.id,
    required this.name,
    required this.type,
    this.status = 'active',
  });
  final String id;
  final String name;
  final String type;
  final String status;
}

class RawMaterial {
  const RawMaterial({
    required this.id,
    required this.name,
    required this.unit,
    required this.type,
    required this.categoryId,
    this.status = 'active',
  });
  final String id;
  final String name;
  final String unit;
  final String type;
  final String categoryId;
  final String status;
}

class MaterialStockSnapshot {
  const MaterialStockSnapshot({
    required this.materialId,
    required this.outletId,
    required this.quantity,
    required this.unit,
    this.lastPurchasePrice = 0,
    this.lastPurchaseDate = '',
  });

  final String materialId;
  final String outletId;
  final double quantity;
  final String unit;
  final int lastPurchasePrice;
  final String lastPurchaseDate;

  factory MaterialStockSnapshot.fromJson(Map<String, dynamic> json) =>
      MaterialStockSnapshot(
        materialId: _asString(json, 'materialId', 'material_id'),
        outletId: _asString(json, 'outletId', 'outlet_id'),
        quantity: _asDouble(json, 'quantity'),
        unit: _asString(json, 'unit'),
        lastPurchasePrice:
            _asInt(json, 'lastPurchasePrice', 'last_purchase_price'),
        lastPurchaseDate:
            _asString(json, 'lastPurchaseDate', 'last_purchase_date'),
      );
}

class Supplier {
  const Supplier({
    required this.id,
    required this.name,
    this.phone = '',
    this.status = 'active',
  });
  final String id;
  final String name;
  final String phone;
  final String status;
}

class ProductVariant {
  const ProductVariant({
    required this.id,
    required this.productId,
    required this.name,
    this.status = 'active',
    this.sortOrder = 0,
  });

  final String id;
  final String productId;
  final String name;
  final String status;
  final int sortOrder;

  bool get isActive => status != 'inactive';

  Map<String, dynamic> toJson() => {
        'id': id,
        'productId': productId,
        'name': name,
        'status': status,
        'sortOrder': sortOrder,
      };

  factory ProductVariant.fromJson(Map<String, dynamic> json) => ProductVariant(
        id: _asString(json, 'id'),
        productId: _asString(json, 'productId', 'product_id'),
        name: _asString(json, 'name'),
        status: _asString(json, 'status', null, 'active'),
        sortOrder: _asInt(json, 'sortOrder', 'sort_order'),
      );
}

class Product {
  const Product(
      {required this.id,
      required this.categoryId,
      required this.sku,
      required this.name,
      required this.prices,
      this.categoryName = '',
      this.categorySortOrder = 0,
      this.imageUrl = '',
      this.variants = const []});
  final String id;
  final String categoryId;
  final String sku;
  final String name;
  final Map<String, int> prices;
  final String categoryName;
  final int categorySortOrder;
  final String imageUrl;
  final List<ProductVariant> variants;

  List<ProductVariant> get activeVariants {
    final active = variants.where((variant) => variant.isActive).toList();
    active.sort((a, b) {
      final byOrder = a.sortOrder.compareTo(b.sortOrder);
      if (byOrder != 0) return byOrder;
      return a.name.compareTo(b.name);
    });
    return active;
  }

  int priceForOutlet(String outletId) => prices[outletId] ?? 0;
}

class PrintSettings {
  const PrintSettings({
    required this.printerName,
    required this.printerStatus,
    required this.mode,
    this.printerAddress = '',
    this.paperSize = '58mm',
  });

  final String printerName;
  final String printerStatus;
  final String mode;
  final String printerAddress;
  final String paperSize;

  bool get isActive => printerStatus == 'active';
  bool get hasSelectedPrinter => printerAddress.trim().isNotEmpty;

  PrintSettings copyWith({
    String? printerName,
    String? printerStatus,
    String? mode,
    String? printerAddress,
    String? paperSize,
  }) =>
      PrintSettings(
        printerName: printerName ?? this.printerName,
        printerStatus: printerStatus ?? this.printerStatus,
        mode: mode ?? this.mode,
        printerAddress: printerAddress ?? this.printerAddress,
        paperSize: paperSize ?? this.paperSize,
      );

  Map<String, dynamic> toJson() => {
        'printerName': printerName,
        'printerStatus': printerStatus,
        'mode': mode,
        'printerAddress': printerAddress,
        'paperSize': paperSize,
      };

  factory PrintSettings.fromJson(Map<String, dynamic> json) => PrintSettings(
        printerName:
            (json['printerName'] ?? json['printer_name'])?.toString() ??
                'Printer Kasir Utama',
        printerStatus:
            (json['printerStatus'] ?? json['printer_status'])?.toString() ==
                    'inactive'
                ? 'inactive'
                : 'active',
        mode: json['mode']?.toString() ?? 'single_printer',
        printerAddress:
            (json['printerAddress'] ?? json['printer_address'])?.toString() ??
                '',
        paperSize:
            (json['paperSize'] ?? json['paper_size'])?.toString() ?? '58mm',
      );
}

class ThermalPrinterDevice {
  const ThermalPrinterDevice({required this.name, required this.address});

  final String name;
  final String address;
}

class PrintTemplate {
  const PrintTemplate({
    required this.key,
    required this.label,
    required this.enabled,
    this.footerText = '',
  });
  final String key;
  final String label;
  final bool enabled;
  final String footerText;

  PrintTemplate copyWith({String? label, bool? enabled, String? footerText}) =>
      PrintTemplate(
        key: key,
        label: label ?? this.label,
        enabled: enabled ?? this.enabled,
        footerText: footerText ?? this.footerText,
      );

  Map<String, dynamic> toJson() => {
        'key': key,
        'label': label,
        'enabled': enabled,
        'footer_text': footerText,
      };

  factory PrintTemplate.fromJson(Map<String, dynamic> json) => PrintTemplate(
        key: json['key']?.toString() ?? '',
        label: json['label']?.toString() ?? '',
        enabled: json['enabled'] != false,
        footerText:
            (json['footerText'] ?? json['footer_text'])?.toString() ?? '',
      );
}

class AppSecuritySettings {
  const AppSecuritySettings({
    this.reportPinEnabled = true,
    this.hasReportPin = false,
  });

  final bool reportPinEnabled;
  final bool hasReportPin;

  factory AppSecuritySettings.fromJson(Map<String, dynamic> json) =>
      AppSecuritySettings(
        reportPinEnabled:
            (json['reportPinEnabled'] ?? json['report_pin_enabled']) != false,
        hasReportPin: (json['hasReportPin'] ?? json['has_report_pin']) == true,
      );
}

class DiningTable {
  const DiningTable(
      {required this.id,
      required this.outletId,
      required this.number,
      this.status = 'active'});
  final String id;
  final String outletId;
  final String number;
  final String status;
}

class Customer {
  const Customer(
      {required this.id,
      required this.outletId,
      required this.name,
      required this.phone,
      required this.barcode,
      this.points = 0});
  final String id;
  final String outletId;
  final String name;
  final String phone;
  final String barcode;
  final int points;

  Customer copyWith({int? points}) => Customer(
      id: id,
      outletId: outletId,
      name: name,
      phone: phone,
      barcode: barcode,
      points: points ?? this.points);

  Map<String, dynamic> toJson() => {
        'id': id,
        'outletId': outletId,
        'name': name,
        'phone': phone,
        'barcode': barcode,
        'points': points,
      };

  factory Customer.fromJson(Map<String, dynamic> json) => Customer(
      id: json['id']?.toString() ?? '',
      outletId: (json['outletId'] ?? json['outlet_id'])?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      phone: json['phone']?.toString() ?? '',
      barcode: json['barcode']?.toString() ?? '',
      points: json['points'] is int
          ? json['points']
          : int.tryParse(json['points']?.toString() ?? '') ?? 0);
}

class CartItem {
  const CartItem(
      {required this.product,
      required this.quantity,
      required this.unitPrice,
      this.selectedVariants = const []});
  final Product product;
  final int quantity;
  final int unitPrice;
  final List<ProductVariant> selectedVariants;
  int get subtotal => quantity * unitPrice;
  String get variantKey {
    final ids = selectedVariants
        .map((variant) => variant.id)
        .where((id) => id.isNotEmpty)
        .toList()
      ..sort();
    return ids.join('|');
  }

  String get lineKey => '${product.id}::$variantKey';

  CartItem copyWith({int? quantity}) => CartItem(
      product: product,
      quantity: quantity ?? this.quantity,
      unitPrice: unitPrice,
      selectedVariants: selectedVariants);
}

class TransactionItem {
  const TransactionItem(
      {required this.productId,
      required this.productName,
      this.categoryId = '',
      this.categoryName = '',
      this.categorySortOrder = 0,
      required this.quantity,
      required this.unitPrice,
      required this.subtotal,
      this.selectedVariants = const []});
  final String productId;
  final String productName;
  final String categoryId;
  final String categoryName;
  final int categorySortOrder;
  final int quantity;
  final int unitPrice;
  final int subtotal;
  final List<ProductVariant> selectedVariants;
  Map<String, dynamic> toJson() => {
        'productId': productId,
        'productName': productName,
        'categoryId': categoryId,
        'categoryName': categoryName,
        'categorySortOrder': categorySortOrder,
        'quantity': quantity,
        'unitPrice': unitPrice,
        'subtotal': subtotal,
        'variantIds': selectedVariants.map((variant) => variant.id).toList(),
        'selectedVariants':
            selectedVariants.map((variant) => variant.toJson()).toList(),
      };
  factory TransactionItem.fromJson(Map<String, dynamic> json) =>
      TransactionItem(
          productId: _asString(json, 'productId', 'product_id'),
          productName: _asString(json, 'productName', 'product_name'),
          categoryId: _asString(json, 'categoryId', 'category_id'),
          categoryName: _asString(json, 'categoryName', 'category_name'),
          categorySortOrder:
              _asInt(json, 'categorySortOrder', 'category_sort_order'),
          quantity: _asInt(json, 'quantity'),
          unitPrice: _asInt(json, 'unitPrice', 'unit_price'),
          subtotal: _asInt(json, 'subtotal'),
          selectedVariants: List<dynamic>.from(json['selectedVariants'] ??
                  json['selected_variants'] ??
                  const [])
              .map((item) => ProductVariant.fromJson(
                  Map<String, dynamic>.from(item as Map)))
              .where((variant) => variant.id.isNotEmpty)
              .toList());
}

class OpenBill {
  const OpenBill({
    required this.id,
    required this.orderNumber,
    required this.outletId,
    required this.cashierId,
    this.clientRef,
    this.serviceType = 'dine_in',
    required this.tableNumber,
    required this.items,
    required this.total,
    required this.createdAt,
    required this.updatedAt,
    required this.synced,
    this.customerPrintedItems = const [],
    this.kitchenPrintedItems = const [],
    this.customerId,
    this.customerName,
    this.customerPhone,
    this.customerPoints = 0,
  });

  final String id;
  final String? clientRef;
  final String orderNumber;
  final String outletId;
  final String cashierId;
  final String serviceType;
  final String? tableNumber;
  final List<TransactionItem> items;
  final int total;
  final DateTime createdAt;
  final DateTime updatedAt;
  final bool synced;
  final List<TransactionItem> customerPrintedItems;
  final List<TransactionItem> kitchenPrintedItems;
  final String? customerId;
  final String? customerName;
  final String? customerPhone;
  final int customerPoints;

  OpenBill copyWith({
    List<TransactionItem>? items,
    int? total,
    DateTime? updatedAt,
    bool? synced,
    String? clientRef,
    String? serviceType,
    String? tableNumber,
    List<TransactionItem>? customerPrintedItems,
    List<TransactionItem>? kitchenPrintedItems,
    String? customerId,
    String? customerName,
    String? customerPhone,
    int? customerPoints,
  }) =>
      OpenBill(
          id: id,
          orderNumber: orderNumber,
          outletId: outletId,
          cashierId: cashierId,
          clientRef: clientRef ?? this.clientRef,
          serviceType: serviceType ?? this.serviceType,
          tableNumber: tableNumber ?? this.tableNumber,
          items: items ?? this.items,
          total: total ?? this.total,
          createdAt: createdAt,
          updatedAt: updatedAt ?? this.updatedAt,
          synced: synced ?? this.synced,
          customerPrintedItems:
              customerPrintedItems ?? this.customerPrintedItems,
          kitchenPrintedItems: kitchenPrintedItems ?? this.kitchenPrintedItems,
          customerId: customerId ?? this.customerId,
          customerName: customerName ?? this.customerName,
          customerPhone: customerPhone ?? this.customerPhone,
          customerPoints: customerPoints ?? this.customerPoints);

  Map<String, dynamic> toJson() => {
        'id': id,
        'clientRef': clientRef,
        'orderNumber': orderNumber,
        'outletId': outletId,
        'cashierId': cashierId,
        'serviceType': serviceType,
        'tableNumber': tableNumber,
        'items': items.map((item) => item.toJson()).toList(),
        'total': total,
        'createdAt': createdAt.toIso8601String(),
        'updatedAt': updatedAt.toIso8601String(),
        'synced': synced,
        'customerPrintedItems':
            customerPrintedItems.map((item) => item.toJson()).toList(),
        'kitchenPrintedItems':
            kitchenPrintedItems.map((item) => item.toJson()).toList(),
        'customerId': customerId,
        'customerName': customerName,
        'customerPhone': customerPhone,
        'customerPoints': customerPoints,
      };

  factory OpenBill.fromJson(Map<String, dynamic> json) {
    final items = List<dynamic>.from(json['items'] ?? const [])
        .map((item) =>
            TransactionItem.fromJson(Map<String, dynamic>.from(item as Map)))
        .toList();
    List<TransactionItem> checkpoint(String camelKey, String snakeKey) {
      if (!json.containsKey(camelKey) && !json.containsKey(snakeKey)) {
        return List<TransactionItem>.from(items);
      }
      return List<dynamic>.from(json[camelKey] ?? json[snakeKey] ?? const [])
          .map((item) =>
              TransactionItem.fromJson(Map<String, dynamic>.from(item as Map)))
          .toList();
    }

    final tableNumber =
        _nullableString(json['tableNumber'] ?? json['table_number']);
    final serviceType = _asString(
      json,
      'serviceType',
      'service_type',
      tableNumber == null || tableNumber.isEmpty ? 'takeaway' : 'dine_in',
    );

    return OpenBill(
        id: _asString(json, 'id'),
        clientRef:
            json['clientRef']?.toString() ?? json['client_ref']?.toString(),
        orderNumber: _asString(json, 'orderNumber', 'order_number'),
        outletId: _asString(json, 'outletId', 'outlet_id'),
        cashierId: _asString(json, 'cashierId', 'cashier_id'),
        serviceType: serviceType == 'dine_in' ? 'dine_in' : 'takeaway',
        tableNumber: tableNumber,
        items: items,
        total: _asInt(json, 'total'),
        createdAt: _asLocalDateTime(json, 'createdAt', 'created_at'),
        updatedAt: _asLocalDateTime(json, 'updatedAt', 'updated_at'),
        synced: json['synced'] ?? false,
        customerPrintedItems:
            checkpoint('customerPrintedItems', 'customer_printed_items'),
        kitchenPrintedItems:
            checkpoint('kitchenPrintedItems', 'kitchen_printed_items'),
        customerId: json['customerId'] ?? json['customer_id'],
        customerName: json['customerName'] ?? json['customer_name'],
        customerPhone: json['customerPhone'] ?? json['customer_phone'],
        customerPoints: _asInt(json, 'customerPoints', 'customer_points'));
  }
}

class TransactionPayment {
  const TransactionPayment({
    required this.method,
    required this.amount,
    this.changeAmount = 0,
  });

  final String method;
  final int amount;
  final int changeAmount;

  bool get isCash => method.toLowerCase() == 'cash';

  Map<String, dynamic> toJson() => {
        'method': method,
        'amount': amount,
        'changeAmount': changeAmount,
      };

  factory TransactionPayment.fromJson(Map<String, dynamic> json) =>
      TransactionPayment(
        method: _asString(json, 'method', 'payment_method').toLowerCase(),
        amount: _asInt(json, 'amount', 'paid_amount'),
        changeAmount: _asInt(json, 'changeAmount', 'change_amount'),
      );
}

class PosTransaction {
  const PosTransaction(
      {required this.id,
      this.clientRef,
      required this.orderNumber,
      required this.outletId,
      required this.cashierId,
      required this.serviceType,
      required this.tableNumber,
      required this.paymentMethod,
      required this.paidAmount,
      required this.changeAmount,
      this.payments = const [],
      this.subtotal = 0,
      this.discount = 0,
      this.discountId,
      this.discountType,
      this.discountValue = 0,
      this.discountName,
      required this.total,
      required this.createdAt,
      required this.synced,
      this.status = 'paid',
      required this.items,
      this.note = '',
      this.customerId,
      this.customerName,
      this.customerPhone,
      this.customerPointsBefore = 0,
      this.customerPointsEarned = 0,
      this.customerPointsAfter = 0});
  final String id;
  final String? clientRef;
  final String orderNumber;
  final String outletId;
  final String cashierId;
  final String serviceType;
  final String? tableNumber;
  final String paymentMethod;
  final int paidAmount;
  final int changeAmount;
  final List<TransactionPayment> payments;
  final int subtotal;
  final int discount;
  final String? discountId;
  final String? discountType;
  final num discountValue;
  final String? discountName;
  final int total;
  final DateTime createdAt;
  final bool synced;
  final String status;
  final List<TransactionItem> items;
  final String note;
  final String? customerId;
  final String? customerName;
  final String? customerPhone;
  final int customerPointsBefore;
  final int customerPointsEarned;
  final int customerPointsAfter;
  PosTransaction copyWith({bool? synced, String? id, String? orderNumber}) =>
      PosTransaction(
          id: id ?? this.id,
          clientRef: clientRef,
          orderNumber: orderNumber ?? this.orderNumber,
          outletId: outletId,
          cashierId: cashierId,
          serviceType: serviceType,
          tableNumber: tableNumber,
          paymentMethod: paymentMethod,
          paidAmount: paidAmount,
          changeAmount: changeAmount,
          payments: payments,
          subtotal: subtotal,
          discount: discount,
          discountId: discountId,
          discountType: discountType,
          discountValue: discountValue,
          discountName: discountName,
          total: total,
          createdAt: createdAt,
          synced: synced ?? this.synced,
          status: status,
          items: items,
          note: note,
          customerId: customerId,
          customerName: customerName,
          customerPhone: customerPhone,
          customerPointsBefore: customerPointsBefore,
          customerPointsEarned: customerPointsEarned,
          customerPointsAfter: customerPointsAfter);
  Map<String, dynamic> toJson() => {
        'id': id,
        'clientRef': clientRef,
        'orderNumber': orderNumber,
        'outletId': outletId,
        'cashierId': cashierId,
        'serviceType': serviceType,
        'tableNumber': tableNumber,
        'paymentMethod': paymentMethod,
        'paidAmount': paidAmount,
        'changeAmount': changeAmount,
        'payments':
            effectivePayments.map((payment) => payment.toJson()).toList(),
        'subtotal': subtotal,
        'discount': discount,
        'discountId': discountId,
        'discountType': discountType,
        'discountValue': discountValue,
        'discountName': discountName,
        'total': total,
        'operationalAt': createdAt.toIso8601String(),
        'createdAt': createdAt.toIso8601String(),
        'synced': synced,
        'status': status,
        'note': note,
        'customerId': customerId,
        'customerName': customerName,
        'customerPhone': customerPhone,
        'customerPointsBefore': customerPointsBefore,
        'customerPointsEarned': customerPointsEarned,
        'customerPointsAfter': customerPointsAfter,
        'items': items.map((item) => item.toJson()).toList()
      };
  List<TransactionPayment> get effectivePayments {
    if (payments.isNotEmpty) return payments;
    return [
      TransactionPayment(
        method: paymentMethod,
        amount: paidAmount,
        changeAmount: changeAmount,
      )
    ];
  }

  String get paymentSummaryLabel => effectivePayments
      .map((payment) => payment.method.toUpperCase())
      .join(' + ');

  factory PosTransaction.fromJson(Map<String, dynamic> json) {
    final parsedPayments = _paymentsFromJson(json);
    final fallbackMethod = _asString(json, 'paymentMethod', 'payment_method',
        parsedPayments.isNotEmpty ? parsedPayments.first.method : 'cash');
    final fallbackPaid = _asInt(json, 'paidAmount', 'paid_amount',
        parsedPayments.fold(0, (total, payment) => total + payment.amount));
    final fallbackChange = _asInt(
        json,
        'changeAmount',
        'change_amount',
        parsedPayments.fold(
            0, (total, payment) => total + payment.changeAmount));

    return PosTransaction(
        id: _asString(json, 'id'),
        clientRef:
            json['clientRef']?.toString() ?? json['client_ref']?.toString(),
        orderNumber: _asString(json, 'orderNumber', 'order_number'),
        outletId: _asString(json, 'outletId', 'outlet_id'),
        cashierId: _asString(json, 'cashierId', 'cashier_id'),
        serviceType: _asString(json, 'serviceType', 'service_type', 'takeaway'),
        tableNumber: json['tableNumber'] ?? json['table_number'],
        paymentMethod: fallbackMethod,
        paidAmount: fallbackPaid,
        changeAmount: fallbackChange,
        payments: parsedPayments,
        subtotal: _asInt(json, 'subtotal', null, _asInt(json, 'total')),
        discount: _asInt(json, 'discount'),
        discountId:
            json['discountId']?.toString() ?? json['discount_id']?.toString(),
        discountType: json['discountType']?.toString() ??
            json['discount_type']?.toString(),
        discountValue: _asDouble(json, 'discountValue', 'discount_value'),
        discountName: json['discountName']?.toString() ??
            json['discount_name']?.toString(),
        total: _asInt(json, 'total'),
        createdAt: _asLocalDateTime(json, 'operationalAt', 'operational_at',
            _asLocalDateTime(json, 'createdAt', 'transaction_date')),
        synced: json['synced'] ?? false,
        status: _asString(json, 'status', null, 'paid'),
        note: _asString(json, 'note'),
        customerId: json['customerId'] ?? json['customer_id'],
        customerName: json['customerName'] ?? json['customer_name'],
        customerPhone: json['customerPhone'] ?? json['customer_phone'],
        customerPointsBefore:
            _asInt(json, 'customerPointsBefore', 'customer_points_before'),
        customerPointsEarned:
            _asInt(json, 'customerPointsEarned', 'customer_points_earned'),
        customerPointsAfter:
            _asInt(json, 'customerPointsAfter', 'customer_points_after'),
        items: List<dynamic>.from(json['items'] ?? const [])
            .map((item) =>
                TransactionItem.fromJson(Map<String, dynamic>.from(item)))
            .toList());
  }
}

List<TransactionPayment> _paymentsFromJson(Map<String, dynamic> json) {
  final rows =
      json['payments'] ?? json['payment_details'] ?? json['paymentDetails'];
  if (rows is List) {
    return rows
        .whereType<Map>()
        .map((item) =>
            TransactionPayment.fromJson(Map<String, dynamic>.from(item)))
        .where((payment) => payment.method.isNotEmpty && payment.amount > 0)
        .toList();
  }
  final payment = json['payment'];
  if (payment is Map) {
    final parsed =
        TransactionPayment.fromJson(Map<String, dynamic>.from(payment));
    if (parsed.method.isNotEmpty && parsed.amount > 0) return [parsed];
  }
  return const [];
}

class PosExpense {
  const PosExpense(
      {required this.id,
      required this.outletId,
      required this.category,
      required this.amount,
      required this.note,
      required this.date,
      required this.synced,
      this.rejectionNote = '',
      this.status = 'pending'});
  final String id;
  final String outletId;
  final String category;
  final int amount;
  final String note;
  final DateTime date;
  final bool synced;
  final String rejectionNote;
  final String status;
  bool get canEdit => !synced || status == 'pending';
  PosExpense copyWith({
    String? id,
    String? category,
    int? amount,
    String? note,
    DateTime? date,
    bool? synced,
    String? rejectionNote,
    String? status,
  }) =>
      PosExpense(
          id: id ?? this.id,
          outletId: outletId,
          category: category ?? this.category,
          amount: amount ?? this.amount,
          note: note ?? this.note,
          date: date ?? this.date,
          synced: synced ?? this.synced,
          rejectionNote: rejectionNote ?? this.rejectionNote,
          status: status ?? this.status);
  Map<String, dynamic> toJson() => {
        'id': id,
        'outletId': outletId,
        'category': category,
        'amount': amount,
        'note': note,
        'operationalAt': date.toIso8601String(),
        'date': date.toIso8601String(),
        'synced': synced,
        'rejectionNote': rejectionNote,
        'status': status
      };
  factory PosExpense.fromJson(Map<String, dynamic> json) => PosExpense(
      id: _asString(json, 'id'),
      outletId: _asString(json, 'outletId', 'outlet_id'),
      category: _asString(json, 'category'),
      amount: _asInt(json, 'amount'),
      note: _asString(json, 'note', 'description'),
      date: _asLocalDateTime(json, 'operationalAt', 'operational_at',
          _asLocalDateTime(json, 'date', 'expense_date')),
      synced: json['synced'] ?? false,
      rejectionNote: _asString(json, 'rejectionNote', 'rejection_note'),
      status: _asString(json, 'status', null, 'pending'));
}

class PurchaseBatchItem {
  const PurchaseBatchItem({
    required this.materialId,
    required this.materialName,
    required this.materialType,
    required this.unit,
    required this.quantity,
    required this.unitPrice,
  });
  final String materialId;
  final String materialName;
  final String materialType;
  final String unit;
  final double quantity;
  final int unitPrice;
  int get subtotal => (quantity * unitPrice).round();

  Map<String, dynamic> toJson() => {
        'materialId': materialId,
        'materialName': materialName,
        'materialType': materialType,
        'unit': unit,
        'quantity': quantity,
        'unitPrice': unitPrice,
        'subtotal': subtotal,
      };

  factory PurchaseBatchItem.fromJson(Map<String, dynamic> json) =>
      PurchaseBatchItem(
        materialId: _asString(json, 'materialId', 'material_id'),
        materialName:
            _asString(json, 'materialName', 'material_name').isNotEmpty
                ? _asString(json, 'materialName', 'material_name')
                : json['material'] is Map
                    ? (json['material']['name']?.toString() ?? '')
                    : '',
        materialType: _asString(
            json,
            'materialType',
            'material_type',
            json['material'] is Map
                ? (json['material']['type']?.toString() ?? 'hpp')
                : 'hpp'),
        unit: _asString(json, 'unit'),
        quantity: _asDouble(json, 'quantity'),
        unitPrice: _asInt(json, 'unitPrice', 'unit_price'),
      );
}

class PurchaseBatch {
  const PurchaseBatch({
    required this.id,
    required this.outletId,
    required this.date,
    required this.paymentType,
    required this.items,
    required this.synced,
    this.supplierId,
    this.supplierName = '',
    this.note = '',
    this.status = 'pending',
  });

  final String id;
  final String outletId;
  final DateTime date;
  final String? supplierId;
  final String supplierName;
  final String paymentType;
  final String note;
  final String status;
  final List<PurchaseBatchItem> items;
  final bool synced;

  int get hppTotal => items
      .where((item) => item.materialType != 'biaya')
      .fold(0, (total, item) => total + item.subtotal);
  int get biayaTotal => items
      .where((item) => item.materialType == 'biaya')
      .fold(0, (total, item) => total + item.subtotal);
  int get total => hppTotal + biayaTotal;

  bool get canEdit => !synced || status == 'pending';

  PurchaseBatch copyWith({
    String? id,
    DateTime? date,
    String? supplierId,
    String? supplierName,
    String? paymentType,
    String? note,
    String? status,
    List<PurchaseBatchItem>? items,
    bool? synced,
  }) =>
      PurchaseBatch(
        id: id ?? this.id,
        outletId: outletId,
        date: date ?? this.date,
        supplierId: supplierId ?? this.supplierId,
        supplierName: supplierName ?? this.supplierName,
        paymentType: paymentType ?? this.paymentType,
        note: note ?? this.note,
        status: status ?? this.status,
        items: items ?? this.items,
        synced: synced ?? this.synced,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'local_id': id,
        'outletId': outletId,
        'operationalAt': date.toIso8601String(),
        'purchaseDate': date.toIso8601String(),
        'supplierId': supplierId,
        'supplierName': supplierName,
        'paymentType': paymentType,
        'note': note,
        'status': status,
        'synced': synced,
        'total': total,
        'items': items.map((item) => item.toJson()).toList(),
      };

  factory PurchaseBatch.fromJson(Map<String, dynamic> json) {
    final items = List<Map<String, dynamic>>.from(json['items'] ?? [])
        .map(PurchaseBatchItem.fromJson)
        .toList();
    final supplier = json['supplier'];
    return PurchaseBatch(
      id: _asString(json, 'id'),
      outletId: _asString(json, 'outletId', 'outlet_id'),
      date: _asLocalDateTime(json, 'operationalAt', 'operational_at',
          _asLocalDateTime(json, 'purchaseDate', 'purchase_date')),
      supplierId: _asString(json, 'supplierId', 'supplier_id').isEmpty
          ? null
          : _asString(json, 'supplierId', 'supplier_id'),
      supplierName: _asString(json, 'supplierName').isNotEmpty
          ? _asString(json, 'supplierName')
          : supplier is Map
              ? (supplier['name']?.toString() ?? '')
              : '',
      paymentType: _asString(json, 'paymentType', 'payment_type', 'lunas'),
      note: _asString(json, 'note'),
      status: _asString(json, 'status', null, 'pending'),
      items: items,
      synced: json['synced'] ?? true,
    );
  }
}

class StockOpnameWorksheetRow {
  const StockOpnameWorksheetRow({
    required this.materialId,
    required this.materialName,
    required this.materialType,
    required this.unit,
    required this.unitPrice,
    required this.openingQuantity,
    required this.purchaseQuantity,
    required this.transferInQuantity,
    required this.incomingQuantity,
    required this.transferQuantity,
    required this.transferOutQuantity,
    required this.damageQuantity,
    required this.salesQuantity,
    required this.realSystemQuantity,
    required this.actualQuantity,
    required this.difference,
    required this.status,
    this.note = '',
  });

  final String materialId;
  final String materialName;
  final String materialType;
  final String unit;
  final int unitPrice;
  final double openingQuantity;
  final double purchaseQuantity;
  final double transferInQuantity;
  final double incomingQuantity;
  final double transferQuantity;
  final double transferOutQuantity;
  final double damageQuantity;
  final double salesQuantity;
  final double realSystemQuantity;
  final double actualQuantity;
  final double difference;
  final String status;
  final String note;

  int get lossAmount => difference > 0 ? (difference * unitPrice).round() : 0;
  bool get hasUserInput =>
      openingQuantity.abs() > 0.000001 ||
      damageQuantity.abs() > 0.000001 ||
      actualQuantity.abs() > 0.000001;
  double calculateSystemQuantity({double? opening, double? damage}) =>
      (opening ?? openingQuantity) +
      purchaseQuantity +
      transferInQuantity -
      transferOutQuantity -
      salesQuantity -
      (damage ?? damageQuantity);

  StockOpnameWorksheetRow copyWith({
    double? openingQuantity,
    double? purchaseQuantity,
    double? transferInQuantity,
    double? incomingQuantity,
    double? transferQuantity,
    double? transferOutQuantity,
    double? damageQuantity,
    double? actualQuantity,
    double? realSystemQuantity,
    double? difference,
    String? status,
    String? note,
  }) =>
      StockOpnameWorksheetRow(
        materialId: materialId,
        materialName: materialName,
        materialType: materialType,
        unit: unit,
        unitPrice: unitPrice,
        openingQuantity: openingQuantity ?? this.openingQuantity,
        purchaseQuantity: purchaseQuantity ?? this.purchaseQuantity,
        transferInQuantity: transferInQuantity ?? this.transferInQuantity,
        incomingQuantity: incomingQuantity ?? this.incomingQuantity,
        transferQuantity: transferQuantity ?? this.transferQuantity,
        transferOutQuantity: transferOutQuantity ?? this.transferOutQuantity,
        damageQuantity: damageQuantity ?? this.damageQuantity,
        salesQuantity: salesQuantity,
        realSystemQuantity: realSystemQuantity ?? this.realSystemQuantity,
        actualQuantity: actualQuantity ?? this.actualQuantity,
        difference: difference ?? this.difference,
        status: status ?? this.status,
        note: note ?? this.note,
      );

  Map<String, dynamic> toJson() => {
        'materialId': materialId,
        'materialName': materialName,
        'materialType': materialType,
        'unit': unit,
        'unitPrice': unitPrice,
        'opening_quantity': openingQuantity,
        'purchase_quantity': purchaseQuantity,
        'transfer_in_quantity': transferInQuantity,
        'incoming_quantity': incomingQuantity,
        'transfer_quantity': transferQuantity,
        'transfer_out_quantity': transferOutQuantity,
        'damage_quantity': damageQuantity,
        'computed_sales_quantity': salesQuantity,
        'real_system_quantity': realSystemQuantity,
        'actual_quantity': actualQuantity,
        'difference': difference,
        'status': status,
        'loss_amount': lossAmount,
        'note': note,
      };

  factory StockOpnameWorksheetRow.fromJson(Map<String, dynamic> json) {
    final material = json['material'];
    final materialName =
        _asString(json, 'materialName', 'material_name').isNotEmpty
            ? _asString(json, 'materialName', 'material_name')
            : _asString(json, 'name').isNotEmpty
                ? _asString(json, 'name')
                : material is Map
                    ? (material['name']?.toString() ?? '')
                    : '';
    final materialType =
        _asString(json, 'materialType', 'material_type').isNotEmpty
            ? _asString(json, 'materialType', 'material_type')
            : material is Map
                ? (material['type']?.toString() ?? 'hpp')
                : 'hpp';
    final transferQuantity =
        _asDouble(json, 'transferQuantity', 'transfer_quantity');
    final transferOutQuantity =
        _asDouble(json, 'transferOutQuantity', 'transfer_out_quantity');
    final incomingQuantity =
        _asDouble(json, 'incomingQuantity', 'incoming_quantity');
    final rawTransferInQuantity =
        json['transferInQuantity'] ?? json['transfer_in_quantity'];
    final derivedTransferInQuantity = transferQuantity + transferOutQuantity;
    final transferInQuantity = rawTransferInQuantity == null
        ? (derivedTransferInQuantity > 0 ? derivedTransferInQuantity : 0.0)
        : _asDouble(json, 'transferInQuantity', 'transfer_in_quantity');
    final rawPurchaseQuantity =
        json['purchaseQuantity'] ?? json['purchase_quantity'];
    final derivedPurchaseQuantity = incomingQuantity - transferInQuantity;
    final purchaseQuantity = rawPurchaseQuantity == null
        ? (derivedPurchaseQuantity > 0 ? derivedPurchaseQuantity : 0.0)
        : _asDouble(json, 'purchaseQuantity', 'purchase_quantity');
    return StockOpnameWorksheetRow(
      materialId: _asString(json, 'materialId', 'material_id'),
      materialName: materialName,
      materialType: materialType,
      unit: _asString(json, 'unit'),
      unitPrice: _asInt(json, 'unitPrice', 'unit_price'),
      openingQuantity: _asDouble(json, 'openingQuantity', 'opening_quantity'),
      purchaseQuantity: purchaseQuantity,
      transferInQuantity: transferInQuantity,
      incomingQuantity: incomingQuantity,
      transferQuantity: transferQuantity,
      transferOutQuantity: transferOutQuantity > 0
          ? transferOutQuantity
          : transferQuantity < 0
              ? transferQuantity.abs()
              : 0,
      damageQuantity: _asDouble(json, 'damageQuantity', 'damage_quantity'),
      salesQuantity:
          _asDouble(json, 'computedSalesQuantity', 'computed_sales_quantity'),
      realSystemQuantity:
          _asDouble(json, 'realSystemQuantity', 'real_system_quantity'),
      actualQuantity: _asDouble(json, 'actualQuantity', 'actual_quantity'),
      difference: _asDouble(json, 'difference'),
      status: _asString(json, 'status', null, 'pas'),
      note: _asString(json, 'note'),
    );
  }
}

class StockOpnameRequest {
  const StockOpnameRequest({
    required this.id,
    required this.outletId,
    required this.date,
    required this.items,
    this.batchId = '',
    this.outletName = '',
    this.requestedById = '',
    this.requestedByName = '',
    this.source = '',
    this.note = '',
    this.rejectionNote = '',
    this.status = 'pending',
    this.synced = true,
  });

  final String id;
  final String batchId;
  final String outletId;
  final String outletName;
  final DateTime date;
  final String requestedById;
  final String requestedByName;
  final String source;
  final String note;
  final String rejectionNote;
  final String status;
  final List<StockOpnameWorksheetRow> items;
  final bool synced;

  int get totalLoss => items.fold(0, (total, item) => total + item.lossAmount);
  bool canEditBy(String userId) =>
      status == 'pending' &&
      requestedById.isNotEmpty &&
      requestedById == userId;

  StockOpnameRequest copyWith({
    String? id,
    String? batchId,
    String? outletId,
    String? outletName,
    DateTime? date,
    String? requestedById,
    String? requestedByName,
    String? source,
    String? note,
    String? rejectionNote,
    String? status,
    List<StockOpnameWorksheetRow>? items,
    bool? synced,
  }) =>
      StockOpnameRequest(
        id: id ?? this.id,
        batchId: batchId ?? this.batchId,
        outletId: outletId ?? this.outletId,
        outletName: outletName ?? this.outletName,
        date: date ?? this.date,
        requestedById: requestedById ?? this.requestedById,
        requestedByName: requestedByName ?? this.requestedByName,
        source: source ?? this.source,
        note: note ?? this.note,
        rejectionNote: rejectionNote ?? this.rejectionNote,
        status: status ?? this.status,
        items: items ?? this.items,
        synced: synced ?? this.synced,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'local_id': id,
        'batch_id': batchId.isEmpty ? id : batchId,
        'outletId': outletId,
        'outletName': outletName,
        'operationalAt': date.toIso8601String(),
        'opnameDate':
            '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}',
        'requestedByName': requestedByName,
        'requested_by': requestedById,
        'source': source,
        'note': note,
        'rejectionNote': rejectionNote,
        'status': status,
        'synced': synced,
        'items': items.map((item) => item.toJson()).toList(),
        'rows': items.map((item) => item.toJson()).toList(),
      };

  factory StockOpnameRequest.fromJson(Map<String, dynamic> json) {
    final outlet = json['outlet'];
    final requestedUser = json['requested_user'];
    return StockOpnameRequest(
      id: _asString(json, 'id'),
      batchId: _asString(json, 'batchId', 'batch_id'),
      outletId: _asString(json, 'outletId', 'outlet_id'),
      outletName: _asString(json, 'outletName').isNotEmpty
          ? _asString(json, 'outletName')
          : outlet is Map
              ? (outlet['name']?.toString() ?? '')
              : '',
      date: _asLocalDateTime(json, 'operationalAt', 'operational_at',
          _asLocalDateTime(json, 'opnameDate', 'opname_date')),
      requestedByName: _asString(json, 'requestedByName').isNotEmpty
          ? _asString(json, 'requestedByName')
          : requestedUser is Map
              ? (requestedUser['name']?.toString() ?? '')
              : '',
      requestedById: _asString(json, 'requestedById', 'requested_by').isNotEmpty
          ? _asString(json, 'requestedById', 'requested_by')
          : requestedUser is Map
              ? (requestedUser['id']?.toString() ?? '')
              : '',
      source: _asString(json, 'source'),
      note: _asString(json, 'note'),
      rejectionNote: _asString(json, 'rejectionNote', 'rejection_note'),
      status: _asString(json, 'status', null, 'pending'),
      items: List<Map<String, dynamic>>.from(
              json['items'] ?? json['rows'] ?? const [])
          .map(StockOpnameWorksheetRow.fromJson)
          .toList(),
      synced: json['synced'] ?? true,
    );
  }
}

class TransferRequestItem {
  const TransferRequestItem({
    required this.materialId,
    required this.materialName,
    required this.materialType,
    required this.unit,
    required this.quantity,
  });
  final String materialId;
  final String materialName;
  final String materialType;
  final String unit;
  final double quantity;

  Map<String, dynamic> toJson() => {
        'materialId': materialId,
        'materialName': materialName,
        'materialType': materialType,
        'unit': unit,
        'quantity': quantity,
      };

  factory TransferRequestItem.fromJson(Map<String, dynamic> json) =>
      TransferRequestItem(
        materialId: _asString(json, 'materialId', 'material_id'),
        materialName:
            _asString(json, 'materialName', 'material_name').isNotEmpty
                ? _asString(json, 'materialName', 'material_name')
                : json['material'] is Map
                    ? (json['material']['name']?.toString() ?? '')
                    : '',
        materialType: _asString(
            json,
            'materialType',
            'material_type',
            json['material'] is Map
                ? (json['material']['type']?.toString() ?? 'hpp')
                : 'hpp'),
        unit: _asString(json, 'unit'),
        quantity: _asDouble(json, 'quantity'),
      );
}

class TransferRequest {
  const TransferRequest({
    required this.id,
    required this.fromOutletId,
    required this.toOutletId,
    required this.date,
    required this.items,
    required this.synced,
    this.fromOutletName = '',
    this.toOutletName = '',
    this.note = '',
    this.rejectionNote = '',
    this.source = '',
    this.status = 'pending',
    this.transferType = 'regular',
    this.loanReturnForTransferId = '',
    this.loanStatus = '',
    this.loanRemainingItems = const [],
    this.loanReturnedItems = const [],
    this.loanReturnCount = 0,
  });

  final String id;
  final String fromOutletId;
  final String toOutletId;
  final String fromOutletName;
  final String toOutletName;
  final DateTime date;
  final String note;
  final String rejectionNote;
  final String source;
  final String status;
  final String transferType;
  final String loanReturnForTransferId;
  final String loanStatus;
  final List<TransferRequestItem> loanRemainingItems;
  final List<TransferRequestItem> loanReturnedItems;
  final int loanReturnCount;
  final List<TransferRequestItem> items;
  final bool synced;

  TransferRequest copyWith({bool? synced, String? status, String? id}) =>
      TransferRequest(
        id: id ?? this.id,
        fromOutletId: fromOutletId,
        toOutletId: toOutletId,
        fromOutletName: fromOutletName,
        toOutletName: toOutletName,
        date: date,
        note: note,
        rejectionNote: rejectionNote,
        source: source,
        status: status ?? this.status,
        transferType: transferType,
        loanReturnForTransferId: loanReturnForTransferId,
        loanStatus: loanStatus,
        loanRemainingItems: loanRemainingItems,
        loanReturnedItems: loanReturnedItems,
        loanReturnCount: loanReturnCount,
        items: items,
        synced: synced ?? this.synced,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'local_id': id,
        'fromOutletId': fromOutletId,
        'toOutletId': toOutletId,
        'fromOutletName': fromOutletName,
        'toOutletName': toOutletName,
        'operationalAt': date.toIso8601String(),
        'transferDate': date.toIso8601String(),
        'note': note,
        'rejectionNote': rejectionNote,
        'source': source,
        'status': status,
        'transfer_type': transferType,
        'loan_return_for_transfer_id':
            loanReturnForTransferId.isEmpty ? null : loanReturnForTransferId,
        'loan_status': loanStatus,
        'loan_remaining_items':
            loanRemainingItems.map((item) => item.toJson()).toList(),
        'loan_returned_items':
            loanReturnedItems.map((item) => item.toJson()).toList(),
        'loan_return_count': loanReturnCount,
        'synced': synced,
        'items': items.map((item) => item.toJson()).toList(),
      };

  factory TransferRequest.fromJson(Map<String, dynamic> json) {
    final fromOutlet = json['from_outlet'];
    final toOutlet = json['to_outlet'];
    return TransferRequest(
      id: _asString(json, 'id'),
      fromOutletId: _asString(json, 'fromOutletId', 'from_outlet_id'),
      toOutletId: _asString(json, 'toOutletId', 'to_outlet_id'),
      fromOutletName: _asString(json, 'fromOutletName').isNotEmpty
          ? _asString(json, 'fromOutletName')
          : fromOutlet is Map
              ? (fromOutlet['name']?.toString() ?? '')
              : '',
      toOutletName: _asString(json, 'toOutletName').isNotEmpty
          ? _asString(json, 'toOutletName')
          : toOutlet is Map
              ? (toOutlet['name']?.toString() ?? '')
              : '',
      date: _asLocalDateTime(json, 'operationalAt', 'operational_at',
          _asLocalDateTime(json, 'transferDate', 'transfer_date')),
      note: _asString(json, 'note'),
      rejectionNote: _asString(json, 'rejectionNote', 'rejection_note'),
      source: _asString(json, 'source'),
      status: _asString(json, 'status', null, 'pending'),
      transferType: _asString(json, 'transferType', 'transfer_type', 'regular'),
      loanReturnForTransferId: _asString(
          json, 'loanReturnForTransferId', 'loan_return_for_transfer_id'),
      loanStatus: _asString(json, 'loanStatus', 'loan_status'),
      loanRemainingItems: List<Map<String, dynamic>>.from(
              json['loan_remaining_items'] ?? json['loanRemainingItems'] ?? [])
          .map(TransferRequestItem.fromJson)
          .toList(),
      loanReturnedItems: List<Map<String, dynamic>>.from(
              json['loan_returned_items'] ?? json['loanReturnedItems'] ?? [])
          .map(TransferRequestItem.fromJson)
          .toList(),
      loanReturnCount: int.tryParse(
              '${json['loan_return_count'] ?? json['loanReturnCount'] ?? 0}') ??
          0,
      items: List<Map<String, dynamic>>.from(json['items'] ?? [])
          .map(TransferRequestItem.fromJson)
          .toList(),
      synced: json['synced'] ?? true,
    );
  }
}
