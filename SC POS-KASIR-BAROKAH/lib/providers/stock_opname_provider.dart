import 'package:flutter/foundation.dart';

import '../models/app_models.dart';
import '../repositories/pos_repository.dart';
import '../services/activity_log_service.dart';
import '../services/api_client.dart';

class StockOpnameProvider extends ChangeNotifier {
  final PosRepository _repository = const PosRepository();
  final ActivityLogService _activityLogs = const ActivityLogService();
  final List<StockOpnameWorksheetRow> _worksheetRows = [];
  final List<StockOpnameRequest> _requests = [];
  bool _loadingWorksheet = false;
  bool _loadingRequests = false;
  bool _submitting = false;
  String? _errorMessage;

  List<StockOpnameWorksheetRow> get worksheetRows =>
      List.unmodifiable(_worksheetRows);
  List<StockOpnameRequest> get requests => List.unmodifiable(_requests);
  bool get loadingWorksheet => _loadingWorksheet;
  bool get loadingRequests => _loadingRequests;
  bool get submitting => _submitting;
  String? get errorMessage => _errorMessage;

  Future<void> fetchWorksheet({
    required String outletId,
    required DateTime date,
  }) async {
    _loadingWorksheet = true;
    _errorMessage = null;
    notifyListeners();
    try {
      final rows = await _repository.getStockOpnameWorksheet(
          outletId: outletId, date: date);
      _worksheetRows
        ..clear()
        ..addAll(rows);
    } catch (error) {
      _errorMessage = error.toString().replaceFirst('Exception: ', '');
      if (error is! ApiException || error.statusCode == null) {
        await _activityLogs.record(
            outletId: outletId,
            module: 'stock_opname',
            action: 'worksheet_load',
            outcome: 'failed',
            description: 'Memuat worksheet Stock Opname gagal.',
            metadata: {'error': error.toString()});
      }
    } finally {
      _loadingWorksheet = false;
      notifyListeners();
    }
  }

  Future<void> fetchRequests({
    required String outletId,
    required DateTime from,
    required DateTime to,
  }) async {
    _loadingRequests = true;
    _errorMessage = null;
    notifyListeners();
    try {
      final remote = await _repository.getStockOpnameRequests(
          outletId: outletId, from: from, to: to);
      _requests
        ..clear()
        ..addAll(remote);
      _requests.sort((a, b) => b.date.compareTo(a.date));
    } catch (error) {
      _errorMessage = error.toString().replaceFirst('Exception: ', '');
      if (error is! ApiException || error.statusCode == null) {
        await _activityLogs.record(
            outletId: outletId,
            module: 'stock_opname',
            action: 'history_load',
            outcome: 'failed',
            description: 'Memuat riwayat Stock Opname gagal.',
            metadata: {'error': error.toString()});
      }
    } finally {
      _loadingRequests = false;
      notifyListeners();
    }
  }

  Future<StockOpnameRequest?> submitRequest({
    required String outletId,
    required String outletName,
    required String outletCode,
    required DateTime date,
    required List<StockOpnameWorksheetRow> rows,
    String note = '',
  }) async {
    if (rows.isEmpty) return null;
    _submitting = true;
    _errorMessage = null;
    notifyListeners();
    try {
      final localId = _buildStockOpnameRequestId(
        outletId: outletId,
        outletCode: outletCode,
        now: DateTime.now(),
      );
      final request = StockOpnameRequest(
        id: localId,
        batchId: localId,
        outletId: outletId,
        outletName: outletName,
        date: date,
        note: note,
        status: 'pending',
        synced: false,
        items: rows,
      );
      final saved = await _repository.createStockOpnameRequest(request);
      _requests.insert(0, saved);
      return saved;
    } catch (error) {
      _errorMessage = error.toString().replaceFirst('Exception: ', '');
      if (error is! ApiException || error.statusCode == null) {
        await _activityLogs.record(
            outletId: outletId,
            module: 'stock_opname',
            action: 'create',
            outcome: 'failed',
            description: 'Request Stock Opname gagal sebelum mencapai backend.',
            metadata: {'error': error.toString(), 'item_count': rows.length});
      }
      return null;
    } finally {
      _submitting = false;
      notifyListeners();
    }
  }

  Future<StockOpnameRequest?> updateRequest(StockOpnameRequest request) async {
    _submitting = true;
    _errorMessage = null;
    notifyListeners();
    try {
      final saved = await _repository.updateStockOpnameRequest(request);
      final index = _requests.indexWhere((item) => item.id == saved.id);
      if (index >= 0) {
        _requests[index] = saved;
      } else {
        _requests.insert(0, saved);
      }
      _requests.sort((a, b) => b.date.compareTo(a.date));
      return saved;
    } catch (error) {
      _errorMessage = error.toString().replaceFirst('Exception: ', '');
      if (error is! ApiException || error.statusCode == null) {
        await _activityLogs.record(
            outletId: request.outletId,
            module: 'stock_opname',
            action: 'update',
            outcome: 'failed',
            entityType: 'stock_opname_request',
            entityId: request.id,
            description: 'Edit Stock Opname gagal sebelum mencapai backend.',
            metadata: {
              'error': error.toString(),
              'item_count': request.items.length
            });
      }
      return null;
    } finally {
      _submitting = false;
      notifyListeners();
    }
  }

  Future<bool> deleteRequest(String requestId, String outletId) async {
    _submitting = true;
    _errorMessage = null;
    notifyListeners();
    try {
      await _repository.deleteStockOpnameRequest(requestId);
      _requests.removeWhere((item) => item.id == requestId);
      return true;
    } catch (error) {
      _errorMessage = error.toString().replaceFirst('Exception: ', '');
      if (error is! ApiException || error.statusCode == null) {
        await _activityLogs.record(
            outletId: outletId,
            module: 'stock_opname',
            action: 'delete',
            outcome: 'failed',
            entityType: 'stock_opname_request',
            entityId: requestId,
            description: 'Hapus Stock Opname gagal.',
            metadata: {'error': error.toString()});
      }
      return false;
    } finally {
      _submitting = false;
      notifyListeners();
    }
  }
}

String _buildStockOpnameRequestId({
  required String outletId,
  required String outletCode,
  required DateTime now,
}) {
  final rawPrefix = outletCode.trim().isNotEmpty ? outletCode : outletId;
  final prefix = _sanitizeStockOpnameIdPart(rawPrefix);
  return '${prefix.isEmpty ? 'OUTLET' : prefix}_opname_${_formatStockOpnameIdTimestamp(now)}';
}

String _sanitizeStockOpnameIdPart(String value) {
  return value
      .trim()
      .toUpperCase()
      .replaceAll(RegExp(r'[^A-Z0-9]+'), '_')
      .replaceAll(RegExp(r'_+'), '_')
      .replaceAll(RegExp(r'^_|_$'), '');
}

String _formatStockOpnameIdTimestamp(DateTime value) {
  String twoDigits(int number) => number.toString().padLeft(2, '0');
  final local = value.toLocal();
  return '${local.year}${twoDigits(local.month)}${twoDigits(local.day)}_'
      '${twoDigits(local.hour)}${twoDigits(local.minute)}${twoDigits(local.second)}';
}
