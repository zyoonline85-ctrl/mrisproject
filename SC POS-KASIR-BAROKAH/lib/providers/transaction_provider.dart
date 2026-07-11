import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/app_models.dart';
import '../repositories/pos_repository.dart';
import '../services/api_client.dart';
import '../services/activity_log_service.dart';
import '../services/local_order_sequence_service.dart';
import '../utils/formatters.dart';

class TransactionProvider extends ChangeNotifier {
  final ActivityLogService _activityLogs = const ActivityLogService();
  final List<PosTransaction> _transactions = [];
  static const _storageKey = 'barokah_pos_transactions';
  final PosRepository _repository = const PosRepository();
  final LocalOrderSequenceService _sequence = const LocalOrderSequenceService();
  bool _loading = false;
  bool _refreshing = false;
  bool _submitting = false;
  String? _errorMessage;
  List<PosTransaction> get transactions => List.unmodifiable(_transactions);
  int get pendingCount => _transactions.where((trx) => !trx.synced).length;
  bool get loading => _loading;
  bool get refreshing => _refreshing;
  bool get submitting => _submitting;
  String? get errorMessage => _errorMessage;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_storageKey);
    if (raw == null) return;
    final decoded = jsonDecode(raw) as List;
    _transactions
      ..clear()
      ..addAll(decoded
          .map((item) =>
              PosTransaction.fromJson(Map<String, dynamic>.from(item)))
          .where((trx) => trx.orderNumber.trim().isNotEmpty));
    notifyListeners();
  }

  Future<void> fetchHistory({
    required String outletId,
    required DateTime from,
    required DateTime to,
    String paymentMethod = 'all',
  }) async {
    final hasData = _transactions.any((trx) => trx.outletId == outletId);
    _loading = !hasData;
    _refreshing = hasData;
    _errorMessage = null;
    notifyListeners();
    try {
      final remote = await _repository.getHistory(
        outletId: outletId,
        from: from,
        to: to,
        paymentMethod: paymentMethod,
      );
      final pending = _transactions
          .where((trx) => !trx.synced && trx.outletId == outletId)
          .toList();
      _transactions.removeWhere((trx) => trx.outletId == outletId);
      _transactions.addAll(remote);
      for (final local in pending) {
        final alreadySynced = remote.any((trx) =>
            (local.clientRef != null && trx.clientRef == local.clientRef) ||
            trx.orderNumber == local.orderNumber);
        if (!alreadySynced) _transactions.add(local);
      }
      _transactions.sort((a, b) => b.createdAt.compareTo(a.createdAt));
      await _save();
    } catch (error) {
      _errorMessage = _messageFromError(error);
    } finally {
      _loading = false;
      _refreshing = false;
      notifyListeners();
    }
  }

  Future<void> _save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_storageKey,
        jsonEncode(_transactions.map((trx) => trx.toJson()).toList()));
  }

  Future<int> clearPendingTransactions() async {
    final before = _transactions.length;
    _transactions.removeWhere((trx) => !trx.synced);
    final removed = before - _transactions.length;
    if (removed > 0) {
      await _save();
      notifyListeners();
    }
    return removed;
  }

  String _messageFromError(Object error) {
    if (error is ApiException) {
      final details = error.details;
      if (details is Map) {
        final formErrors = details['formErrors'];
        if (formErrors is List && formErrors.isNotEmpty) {
          return formErrors.first.toString();
        }
        final fieldErrors = details['fieldErrors'];
        if (fieldErrors is Map && fieldErrors.isNotEmpty) {
          final first = fieldErrors.values.first;
          if (first is List && first.isNotEmpty) return first.first.toString();
          if (first != null) return first.toString();
        }
      }
      return error.message;
    }
    return error.toString().replaceFirst(RegExp(r'^Exception:\s*'), '');
  }

  String nextOrderNumber(Outlet outlet, DateTime date) {
    final prefix = '${outlet.code}-${formatOrderDate(date)}';
    final count = _transactions
            .where((trx) => trx.orderNumber.startsWith(prefix))
            .length +
        1;
    return '$prefix-${count.toString().padLeft(3, '0')}';
  }

  Future<PosTransaction> createTransaction(
      {required Outlet outlet,
      required CashierUser cashier,
      required List<CartItem> cartItems,
      required String serviceType,
      required String? tableNumber,
      required String paymentMethod,
      required int paidAmount,
      List<TransactionPayment> payments = const [],
      required int subtotal,
      required int discountAmount,
      String? discountType,
      num discountValue = 0,
      String? discountName,
      String note = '',
      Customer? customer,
      int customerPointsEarned = 0,
      DateTime? operationalAt,
      String? openBillId,
      String? orderNumberOverride}) async {
    final now = DateTime.now();
    final transactionAt = operationalAt ?? now;
    final itemSubtotal = cartItems.fold(0, (sum, item) => sum + item.subtotal);
    final finalSubtotal = subtotal > 0 ? subtotal : itemSubtotal;
    final normalizedDiscountType =
        discountType == 'percent' || discountType == 'nominal'
            ? discountType
            : null;
    final requestedDiscount = normalizedDiscountType == null
        ? 0
        : discountAmount > 0
            ? discountAmount
            : normalizedDiscountType == 'percent'
                ? ((finalSubtotal * discountValue) / 100).round()
                : discountValue.round();
    final finalDiscount = requestedDiscount > finalSubtotal
        ? finalSubtotal
        : requestedDiscount < 0
            ? 0
            : requestedDiscount;
    final total = finalSubtotal - finalDiscount;
    final checkoutPayments = _normalizePayments(
      payments.isEmpty
          ? [TransactionPayment(method: paymentMethod, amount: paidAmount)]
          : payments,
      total,
      fallbackMethod: paymentMethod,
    );
    final totalPaid =
        checkoutPayments.fold(0, (sum, payment) => sum + payment.amount);
    final changeAmount = totalPaid > total ? totalPaid - total : 0;
    final transactionNote =
        note.trim().length > 500 ? note.trim().substring(0, 500) : note.trim();
    final orderNumber = (orderNumberOverride ?? '').trim().isNotEmpty
        ? orderNumberOverride!.trim()
        : await _sequence.nextOrderNumber(outlet, transactionAt);
    final clientRef =
        'trx_${outlet.id}_${cashier.id}_${now.microsecondsSinceEpoch}';
    final transaction = PosTransaction(
      id: 'trx_local_${now.microsecondsSinceEpoch}',
      clientRef: clientRef,
      orderNumber: orderNumber,
      outletId: outlet.id,
      cashierId: cashier.id,
      serviceType: serviceType,
      tableNumber: tableNumber,
      paymentMethod: checkoutPayments.first.method,
      paidAmount: totalPaid,
      changeAmount: changeAmount,
      payments: checkoutPayments,
      subtotal: finalSubtotal,
      discount: finalDiscount,
      discountId: null,
      discountType: finalDiscount > 0 ? normalizedDiscountType : null,
      discountValue: finalDiscount > 0 ? discountValue : 0,
      discountName:
          finalDiscount > 0 ? (discountName ?? 'Diskon Manual') : null,
      total: total,
      createdAt: transactionAt,
      synced: false,
      note: transactionNote,
      customerId: customer?.id,
      customerName: customer?.name,
      customerPhone: customer?.phone,
      customerPointsBefore: customer?.points ?? 0,
      customerPointsEarned: customerPointsEarned,
      customerPointsAfter: (customer?.points ?? 0) + customerPointsEarned,
      items: cartItems
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
          .toList(),
    );
    _submitting = true;
    _errorMessage = null;
    notifyListeners();
    try {
      final synced = await _sendTransaction(
        transaction,
        openBillId: openBillId,
        throwOnError: true,
      );
      final savedTransaction = (synced ?? transaction).copyWith(synced: true);
      _transactions.removeWhere((trx) =>
          trx.id == savedTransaction.id ||
          trx.orderNumber == savedTransaction.orderNumber);
      _transactions.insert(0, savedTransaction);
      await _save();
      notifyListeners();
      return savedTransaction;
    } catch (error) {
      _errorMessage = _messageFromError(error);
      _transactions.removeWhere((trx) =>
          trx.id == transaction.id ||
          trx.orderNumber == transaction.orderNumber ||
          (transaction.clientRef != null &&
              trx.clientRef == transaction.clientRef));
      _transactions.insert(0, transaction);
      await _save();
      notifyListeners();
      return transaction;
    } finally {
      _submitting = false;
      notifyListeners();
    }
  }

  List<PosTransaction> filtered(
      {required String outletId,
      required DateTime from,
      required DateTime to,
      String paymentMethod = 'all'}) {
    return _transactions
        .where((trx) =>
            trx.outletId == outletId &&
            sameOrAfter(trx.createdAt, from) &&
            sameOrBefore(trx.createdAt, to) &&
            (paymentMethod == 'all' ||
                trx.effectivePayments
                    .any((payment) => payment.method == paymentMethod)))
        .toList();
  }

  List<TransactionPayment> _normalizePayments(
    List<TransactionPayment> payments,
    int total, {
    String fallbackMethod = 'cash',
  }) {
    final allowZeroPayment = total <= 0;
    final normalizedFallbackMethod = fallbackMethod.trim().toLowerCase().isEmpty
        ? 'cash'
        : fallbackMethod.trim().toLowerCase();
    final cleaned = payments
        .where((payment) =>
            payment.method.trim().isNotEmpty &&
            (payment.amount > 0 || allowZeroPayment))
        .map((payment) => TransactionPayment(
              method: payment.method.trim().toLowerCase(),
              amount: payment.amount < 0 ? 0 : payment.amount,
            ))
        .toList();
    final rows = cleaned.isEmpty
        ? [TransactionPayment(method: normalizedFallbackMethod, amount: total)]
        : cleaned.take(2).toList();
    final paid = rows.fold(0, (sum, payment) => sum + payment.amount);
    final change = paid > total ? paid - total : 0;
    if (change == 0) return rows;
    final cashIndex = rows.indexWhere((payment) => payment.isCash);
    if (cashIndex < 0) return rows;
    return [
      for (var i = 0; i < rows.length; i++)
        i == cashIndex
            ? TransactionPayment(
                method: rows[i].method,
                amount: rows[i].amount,
                changeAmount: change,
              )
            : rows[i]
    ];
  }

  Future<void> markAllSynced() async {
    for (var i = 0; i < _transactions.length; i++) {
      _transactions[i] = _transactions[i].copyWith(synced: true);
    }
    await _save();
    notifyListeners();
  }

  Future<void> syncPending() async {
    _errorMessage = null;
    String? firstError;
    for (var i = 0; i < _transactions.length; i++) {
      final transaction = _transactions[i];
      if (transaction.synced) continue;
      final synced = await _sendTransaction(transaction);
      if (synced != null) {
        _transactions[i] = synced.copyWith(synced: true);
      } else {
        firstError ??= _errorMessage;
      }
    }
    _transactions.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    _errorMessage = firstError;
    await _save();
    notifyListeners();
  }

  Future<PosTransaction?> _sendTransaction(
    PosTransaction transaction, {
    String? openBillId,
    bool throwOnError = false,
  }) async {
    try {
      final body = transaction.toJson();
      if (body['orderNumber'] == null ||
          body['orderNumber'].toString().trim().isEmpty) {
        body.remove('orderNumber');
      }
      if (openBillId != null && openBillId.trim().isNotEmpty) {
        body['openBillId'] = openBillId.trim();
      }
      final response = Map<String, dynamic>.from(await ApiClient.instance.post(
        '/pos/transactions',
        body: body,
      ));
      _errorMessage = null;
      return PosTransaction.fromJson(response);
    } catch (error) {
      _errorMessage = _messageFromError(error);
      if (error is! ApiException || error.statusCode == null) {
        await _activityLogs.record(
          outletId: transaction.outletId,
          module: 'transaction',
          action: 'checkout',
          outcome: 'failed',
          entityType: 'transaction',
          entityId: transaction.id,
          description: 'Checkout transaksi gagal sebelum mencapai backend.',
          metadata: {
            'error': error.toString(),
            'total': transaction.total,
            'item_count': transaction.items.length
          },
        );
      }
      if (throwOnError) {
        rethrow;
      }
      return null;
    }
  }
}
