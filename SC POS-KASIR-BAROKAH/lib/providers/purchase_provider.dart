import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/app_models.dart';
import '../repositories/pos_repository.dart';
import '../services/activity_log_service.dart';
import '../utils/formatters.dart';

class PurchaseProvider extends ChangeNotifier {
  final List<PurchaseBatch> _purchases = [];
  static const _storageKey = 'barokah_pos_purchase_batches';
  final PosRepository _repository = const PosRepository();
  final ActivityLogService _activityLogs = const ActivityLogService();
  bool _loading = false;
  bool _refreshing = false;
  bool _submitting = false;
  String? _errorMessage;

  List<PurchaseBatch> get purchases => List.unmodifiable(_purchases);
  int get pendingCount => _purchases.where((item) => !item.synced).length;
  bool get loading => _loading;
  bool get refreshing => _refreshing;
  bool get submitting => _submitting;
  String? get errorMessage => _errorMessage;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_storageKey);
    if (raw == null) return;
    final decoded = jsonDecode(raw) as List;
    _purchases
      ..clear()
      ..addAll(decoded.map(
          (item) => PurchaseBatch.fromJson(Map<String, dynamic>.from(item))));
    notifyListeners();
  }

  Future<void> fetchPurchases({
    required String outletId,
    required DateTime from,
    required DateTime to,
  }) async {
    final hasData = _purchases.any((item) => item.outletId == outletId);
    _loading = !hasData;
    _refreshing = hasData;
    _errorMessage = null;
    notifyListeners();
    try {
      final remote = await _repository.getPurchases(
          outletId: outletId, from: from, to: to);
      final pending =
          _purchases.where((item) => !item.synced && item.outletId == outletId);
      _purchases.removeWhere((item) => item.outletId == outletId);
      _purchases.addAll([...pending, ...remote]);
      _purchases.sort((a, b) => b.date.compareTo(a.date));
      await _save();
    } catch (error) {
      _errorMessage = error.toString();
    } finally {
      _loading = false;
      _refreshing = false;
      notifyListeners();
    }
  }

  Future<void> addPurchase({
    required String outletId,
    required DateTime date,
    required String? supplierId,
    required String supplierName,
    required String paymentType,
    required String note,
    required List<PurchaseBatchItem> items,
  }) async {
    if (items.isEmpty) return;
    _submitting = true;
    final batch = PurchaseBatch(
      id: 'purchase_batch_local_${DateTime.now().microsecondsSinceEpoch}',
      outletId: outletId,
      date: date,
      supplierId: supplierId,
      supplierName: supplierName,
      paymentType: paymentType,
      note: note,
      status: 'pending',
      items: items,
      synced: false,
    );
    try {
      _purchases.insert(0, batch);
      await _save();
      notifyListeners();
      final synced = await _sendPurchase(batch);
      if (synced != null) {
        final index = _purchases.indexWhere((item) => item.id == batch.id);
        if (index >= 0) {
          _purchases[index] =
              synced.copyWith(synced: true, status: synced.status);
        }
        await _save();
        notifyListeners();
      }
    } finally {
      _submitting = false;
      notifyListeners();
    }
  }

  Future<bool> updatePurchase({
    required PurchaseBatch purchase,
    required String? supplierId,
    required String supplierName,
    required String paymentType,
    required String note,
    required List<PurchaseBatchItem> items,
  }) async {
    if (!purchase.canEdit || items.isEmpty) {
      _errorMessage = 'Pembelian sudah final dan tidak bisa diedit.';
      notifyListeners();
      return false;
    }

    _submitting = true;
    _errorMessage = null;
    notifyListeners();

    final updated = purchase.copyWith(
      supplierId: supplierId,
      supplierName: supplierName,
      paymentType: paymentType,
      note: note,
      items: items,
      status: 'pending',
    );
    final index = _purchases.indexWhere((item) => item.id == purchase.id);
    if (index < 0) {
      _submitting = false;
      notifyListeners();
      return false;
    }

    try {
      if (!purchase.synced) {
        _purchases[index] = updated.copyWith(synced: false);
        await _save();
        notifyListeners();
        return true;
      }

      final synced = await _sendPurchaseUpdate(updated);
      if (synced == null) {
        _errorMessage =
            'Gagal update pembelian. Cek koneksi/backend lalu coba lagi.';
        return false;
      }

      _purchases[index] = synced.copyWith(synced: true, status: synced.status);
      await _save();
      notifyListeners();
      return true;
    } finally {
      _submitting = false;
      notifyListeners();
    }
  }

  List<PurchaseBatch> filtered({
    required String outletId,
    required DateTime from,
    required DateTime to,
  }) =>
      _purchases
          .where((item) =>
              item.outletId == outletId &&
              sameOrAfter(item.date, from) &&
              sameOrBefore(item.date, to))
          .toList();

  Future<void> syncPending() async {
    for (var i = 0; i < _purchases.length; i++) {
      final batch = _purchases[i];
      if (batch.synced) continue;
      final synced = await _sendPurchase(batch);
      if (synced != null) {
        _purchases[i] = synced.copyWith(synced: true, status: synced.status);
      }
    }
    await _save();
    notifyListeners();
  }

  Future<PurchaseBatch?> _sendPurchase(PurchaseBatch batch) async {
    try {
      return await _repository.createPurchaseBatch(batch);
    } catch (_) {
      await _activityLogs.record(
        outletId: batch.outletId,
        module: 'purchase',
        action: 'sync_failed',
        outcome: 'failed',
        entityType: 'purchase',
        entityId: batch.id,
        description: 'Sync batch pembelian gagal',
        metadata: {'total': batch.total, 'item_count': batch.items.length},
      );
      return null;
    }
  }

  Future<PurchaseBatch?> _sendPurchaseUpdate(PurchaseBatch batch) async {
    try {
      return await _repository.updatePurchaseBatch(batch);
    } catch (_) {
      await _activityLogs.record(
        outletId: batch.outletId,
        module: 'purchase',
        action: 'update_failed',
        outcome: 'failed',
        entityType: 'purchase',
        entityId: batch.id,
        description: 'Update batch pembelian gagal',
        metadata: {'total': batch.total, 'item_count': batch.items.length},
      );
      return null;
    }
  }

  Future<void> _save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_storageKey,
        jsonEncode(_purchases.map((item) => item.toJson()).toList()));
  }
}
