import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/app_models.dart';
import '../repositories/pos_repository.dart';
import '../services/activity_log_service.dart';
import '../utils/formatters.dart';

class TransferProvider extends ChangeNotifier {
  final List<TransferRequest> _transfers = [];
  static const _storageKey = 'barokah_pos_transfer_requests';
  final PosRepository _repository = const PosRepository();
  final ActivityLogService _activityLogs = const ActivityLogService();
  bool _loading = false;
  bool _refreshing = false;
  bool _submitting = false;
  String? _errorMessage;

  List<TransferRequest> get transfers => List.unmodifiable(_transfers);
  int get pendingCount => _transfers.where((item) => !item.synced).length;
  bool get loading => _loading;
  bool get refreshing => _refreshing;
  bool get submitting => _submitting;
  String? get errorMessage => _errorMessage;

  bool _isRelatedToOutlet(TransferRequest item, String outletId) =>
      item.fromOutletId == outletId || item.toOutletId == outletId;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_storageKey);
    if (raw == null) return;
    final decoded = jsonDecode(raw) as List;
    _transfers
      ..clear()
      ..addAll(decoded.map(
          (item) => TransferRequest.fromJson(Map<String, dynamic>.from(item))));
    notifyListeners();
  }

  Future<void> fetchTransfers({
    required String outletId,
    required DateTime from,
    required DateTime to,
  }) async {
    final hasData =
        _transfers.any((item) => _isRelatedToOutlet(item, outletId));
    _loading = !hasData;
    _refreshing = hasData;
    _errorMessage = null;
    notifyListeners();
    try {
      final remote = await _repository.getTransfers(
          outletId: outletId, from: from, to: to);
      final pending = _transfers
          .where((item) => !item.synced && _isRelatedToOutlet(item, outletId));
      _transfers.removeWhere((item) => _isRelatedToOutlet(item, outletId));
      _transfers.addAll([...pending, ...remote]);
      _transfers.sort((a, b) => b.date.compareTo(a.date));
      await _save();
    } catch (error) {
      _errorMessage = error.toString();
    } finally {
      _loading = false;
      _refreshing = false;
      notifyListeners();
    }
  }

  Future<void> addTransfer({
    required String fromOutletId,
    required String toOutletId,
    required String fromOutletName,
    required String toOutletName,
    required DateTime date,
    required String note,
    required List<TransferRequestItem> items,
    String transferType = 'regular',
    String loanReturnForTransferId = '',
  }) async {
    if (items.isEmpty) return;
    _submitting = true;
    final transfer = TransferRequest(
      id: 'transfer_local_${DateTime.now().microsecondsSinceEpoch}',
      fromOutletId: fromOutletId,
      toOutletId: toOutletId,
      fromOutletName: fromOutletName,
      toOutletName: toOutletName,
      date: date,
      note: note,
      status: 'pending',
      transferType:
          loanReturnForTransferId.isNotEmpty ? 'regular' : transferType,
      loanReturnForTransferId: loanReturnForTransferId,
      items: items,
      synced: false,
    );
    try {
      _transfers.insert(0, transfer);
      await _save();
      notifyListeners();
      final synced = await _sendTransfer(transfer);
      if (synced != null) {
        final index = _transfers.indexWhere((item) => item.id == transfer.id);
        if (index >= 0) {
          _transfers[index] =
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

  List<TransferRequest> filtered({
    required String outletId,
    required DateTime from,
    required DateTime to,
  }) =>
      _transfers
          .where((item) =>
              _isRelatedToOutlet(item, outletId) &&
              sameOrAfter(item.date, from) &&
              sameOrBefore(item.date, to))
          .toList();

  Future<void> syncPending() async {
    for (var i = 0; i < _transfers.length; i++) {
      final transfer = _transfers[i];
      if (transfer.synced) continue;
      final synced = await _sendTransfer(transfer);
      if (synced != null) {
        _transfers[i] = synced.copyWith(synced: true, status: synced.status);
      }
    }
    await _save();
    notifyListeners();
  }

  Future<TransferRequest?> _sendTransfer(TransferRequest transfer) async {
    try {
      return await _repository.createTransferRequest(transfer);
    } catch (_) {
      await _activityLogs.record(
        outletId: transfer.fromOutletId,
        module: 'transfer',
        action: 'sync_failed',
        outcome: 'failed',
        entityType: 'stock_transfer',
        entityId: transfer.id,
        description: 'Sync request transfer gagal',
        metadata: {'item_count': transfer.items.length},
      );
      return null;
    }
  }

  Future<void> _save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_storageKey,
        jsonEncode(_transfers.map((item) => item.toJson()).toList()));
  }
}
