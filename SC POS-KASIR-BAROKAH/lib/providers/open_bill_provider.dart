import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/app_models.dart';
import '../services/api_client.dart';
import '../services/local_order_sequence_service.dart';

class OpenBillProvider extends ChangeNotifier {
  final List<OpenBill> _openBills = [];
  final List<String> _pendingDeleteIds = [];
  final LocalOrderSequenceService _sequence = const LocalOrderSequenceService();
  static const _storageKey = 'barokah_pos_open_bills';
  static const _pendingDeleteStorageKey = 'barokah_pos_open_bill_delete_queue';
  bool _loading = false;
  bool _submitting = false;
  String? _errorMessage;

  List<OpenBill> get openBills => List.unmodifiable(_openBills);
  bool get loading => _loading;
  bool get submitting => _submitting;
  String? get errorMessage => _errorMessage;
  int get pendingCount =>
      _openBills.where((bill) => !bill.synced).length +
      _pendingDeleteIds.length;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_storageKey);
    _openBills.clear();
    if (raw != null && raw.isNotEmpty) {
      _openBills.addAll(List<dynamic>.from(jsonDecode(raw))
          .map((item) => OpenBill.fromJson(Map<String, dynamic>.from(item))));
    }
    _pendingDeleteIds
      ..clear()
      ..addAll(prefs.getStringList(_pendingDeleteStorageKey) ?? const []);
    notifyListeners();
  }

  Future<void> _save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_storageKey,
        jsonEncode(_openBills.map((bill) => bill.toJson()).toList()));
    await prefs.setStringList(_pendingDeleteStorageKey, _pendingDeleteIds);
  }

  Future<void> fetchRemote({required String outletId}) async {
    _loading = true;
    _errorMessage = null;
    notifyListeners();
    try {
      final response = await ApiClient.instance
          .get('/pos/open-bills', query: {'outletId': outletId});
      final remoteBills = List<Map<String, dynamic>>.from(response)
          .map((item) => OpenBill.fromJson(item).copyWith(synced: true))
          .toList();
      final pending = _openBills
          .where((bill) => !bill.synced && bill.outletId == outletId)
          .toList();
      _openBills.removeWhere((bill) => bill.outletId == outletId);
      _openBills.addAll(remoteBills);
      for (final local in pending) {
        final alreadySynced = remoteBills.any((bill) =>
            (local.clientRef != null && bill.clientRef == local.clientRef) ||
            bill.orderNumber == local.orderNumber);
        if (!alreadySynced) _openBills.add(local);
      }
      _openBills.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
      await _save();
    } catch (error) {
      _errorMessage = error.toString();
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  OpenBill? findById(String? id) {
    if (id == null) return null;
    for (final bill in _openBills) {
      if (bill.id == id) return bill;
    }
    return null;
  }

  OpenBill? findByTable(String outletId, String tableNumber) {
    for (final bill in _openBills) {
      if (bill.outletId == outletId &&
          bill.serviceType == 'dine_in' &&
          bill.tableNumber == tableNumber) {
        return bill;
      }
    }
    return null;
  }

  bool isTableOccupied(String outletId, String tableNumber) =>
      findByTable(outletId, tableNumber) != null;

  Future<OpenBill> saveFromCart({
    required Outlet outlet,
    required CashierUser cashier,
    required String serviceType,
    required String? tableNumber,
    required List<CartItem> cartItems,
    required List<PosTransaction> transactions,
    Customer? customer,
    String? openBillId,
  }) async {
    _submitting = true;
    _errorMessage = null;
    notifyListeners();
    try {
      final now = DateTime.now();
      final existing = findById(openBillId);
      final items = cartItems
          .map((item) => TransactionItem(
              productId: item.product.id,
              productName: item.product.name,
              categoryId: item.product.categoryId,
              categoryName: item.product.categoryName,
              categorySortOrder: item.product.categorySortOrder,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              subtotal: item.subtotal,
              selectedVariants: item.selectedVariants))
          .toList();
      final normalizedServiceType =
          serviceType == 'dine_in' ? 'dine_in' : 'takeaway';
      final normalizedTableNumber =
          normalizedServiceType == 'dine_in' ? tableNumber?.trim() : null;
      final orderNumber = existing?.orderNumber ??
          await _sequence.nextOrderNumber(outlet, existing?.createdAt ?? now);
      final bill = OpenBill(
        id: existing?.id ??
            openBillId ??
            'open_bill_local_${now.microsecondsSinceEpoch}',
        clientRef: existing?.clientRef ??
            'open_bill_${outlet.id}_${cashier.id}_${now.microsecondsSinceEpoch}',
        orderNumber: orderNumber,
        outletId: outlet.id,
        cashierId: cashier.id,
        serviceType: normalizedServiceType,
        tableNumber: normalizedTableNumber,
        items: items,
        total: cartItems.fold(0, (sum, item) => sum + item.subtotal),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        synced: false,
        customerPrintedItems: existing?.customerPrintedItems ?? const [],
        kitchenPrintedItems: existing?.kitchenPrintedItems ?? const [],
        customerId: customer?.id,
        customerName: customer?.name,
        customerPhone: customer?.phone,
        customerPoints: customer?.points ?? 0,
      );

      try {
        final synced = await _sendBill(bill);
        if (synced != null) {
          final saved = synced.copyWith(synced: true);
          _upsertLocal(saved);
          await _save();
          notifyListeners();
          return saved;
        }
      } catch (error) {
        _errorMessage = error.toString().replaceFirst('Exception: ', '');
      }

      _upsertLocal(bill);
      await _save();
      notifyListeners();
      return bill;
    } finally {
      _submitting = false;
      notifyListeners();
    }
  }

  void _upsertLocal(OpenBill bill) {
    final index = _openBills.indexWhere((item) =>
        item.id == bill.id ||
        item.orderNumber == bill.orderNumber ||
        (bill.clientRef != null && item.clientRef == bill.clientRef));
    if (index >= 0) {
      _openBills[index] = bill;
    } else {
      _openBills.insert(0, bill);
    }
    _openBills.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
  }

  Future<OpenBill> savePrintCheckpoint({
    required String billId,
    required String template,
    required List<TransactionItem> items,
  }) async {
    final index = _openBills.indexWhere((bill) => bill.id == billId);
    if (index < 0) throw Exception('Open bill tidak ditemukan.');
    final current = _openBills[index];
    final updated = current.copyWith(
      customerPrintedItems:
          template == 'customer_order' ? items : current.customerPrintedItems,
      kitchenPrintedItems:
          template == 'kitchen_order' ? items : current.kitchenPrintedItems,
      updatedAt: DateTime.now(),
      synced: false,
    );
    try {
      final response = Map<String, dynamic>.from(await ApiClient.instance.put(
        '/pos/open-bills/$billId/print-checkpoint',
        body: {
          'outletId': current.outletId,
          'template': template,
          'items': items.map((item) => item.toJson()).toList(),
        },
      ));
      final synced = OpenBill.fromJson(response).copyWith(synced: true);
      _openBills[index] = synced;
    } catch (_) {
      _openBills[index] = updated;
    }
    await _save();
    notifyListeners();
    return _openBills[index];
  }

  Future<void> remove(String id) async {
    _submitting = true;
    _errorMessage = null;
    notifyListeners();
    try {
      final bill = findById(id);
      _openBills.removeWhere((item) => item.id == id || item.orderNumber == id);
      if (bill != null && bill.synced) {
        try {
          await ApiClient.instance.delete('/pos/open-bills/$id');
        } catch (_) {
          if (!_pendingDeleteIds.contains(id)) _pendingDeleteIds.add(id);
        }
      }
      await _save();
      notifyListeners();
    } finally {
      _submitting = false;
      notifyListeners();
    }
  }

  Future<void> markAllSynced() async {
    for (var i = 0; i < _openBills.length; i++) {
      _openBills[i] = _openBills[i].copyWith(synced: true);
    }
    await _save();
    notifyListeners();
  }

  Future<void> syncPending({String? outletId}) async {
    _errorMessage = null;
    String? firstError;
    for (var i = 0; i < _openBills.length; i++) {
      final bill = _openBills[i];
      if (bill.synced) continue;
      if (outletId != null && bill.outletId != outletId) continue;
      try {
        final synced = await _sendBill(bill);
        if (synced != null) _openBills[i] = synced.copyWith(synced: true);
      } catch (error) {
        firstError ??= error.toString().replaceFirst('Exception: ', '');
      }
    }
    for (final id in List<String>.from(_pendingDeleteIds)) {
      try {
        await ApiClient.instance.delete('/pos/open-bills/$id');
        _pendingDeleteIds.remove(id);
      } catch (error) {
        firstError ??= error.toString().replaceFirst('Exception: ', '');
      }
    }
    _errorMessage = firstError;
    await _save();
    if (outletId != null && firstError == null) {
      await fetchRemote(outletId: outletId);
    }
    notifyListeners();
  }

  Future<OpenBill?> _sendBill(OpenBill bill) async {
    final body = bill.toJson();
    final response = Map<String, dynamic>.from(
        bill.id.startsWith('open_bill_local_')
            ? await ApiClient.instance.post('/pos/open-bills', body: body)
            : await ApiClient.instance
                .put('/pos/open-bills/${bill.id}', body: body));
    final parsed = OpenBill.fromJson(response);
    final hasCustomerCheckpoint =
        response.containsKey('customerPrintedItems') ||
            response.containsKey('customer_printed_items');
    final hasKitchenCheckpoint = response.containsKey('kitchenPrintedItems') ||
        response.containsKey('kitchen_printed_items');
    return parsed.copyWith(
      customerPrintedItems: hasCustomerCheckpoint
          ? parsed.customerPrintedItems
          : bill.customerPrintedItems,
      kitchenPrintedItems: hasKitchenCheckpoint
          ? parsed.kitchenPrintedItems
          : bill.kitchenPrintedItems,
    );
  }
}
