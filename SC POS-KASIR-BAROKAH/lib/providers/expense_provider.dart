import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/app_models.dart';
import '../repositories/pos_repository.dart';
import '../services/api_client.dart';
import '../services/activity_log_service.dart';
import '../utils/formatters.dart';

class ExpenseProvider extends ChangeNotifier {
  final ActivityLogService _activityLogs = const ActivityLogService();
  final List<PosExpense> _expenses = [];
  static const _storageKey = 'barokah_pos_expenses';
  final PosRepository _repository = const PosRepository();
  bool _loading = false;
  bool _refreshing = false;
  bool _submitting = false;
  String? _errorMessage;
  List<PosExpense> get expenses => List.unmodifiable(_expenses);
  int get pendingCount => _expenses.where((expense) => !expense.synced).length;
  bool get loading => _loading;
  bool get refreshing => _refreshing;
  bool get submitting => _submitting;
  String? get errorMessage => _errorMessage;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_storageKey);
    if (raw == null) return;
    final decoded = jsonDecode(raw) as List;
    _expenses
      ..clear()
      ..addAll(decoded
          .map((item) => PosExpense.fromJson(Map<String, dynamic>.from(item))));
    notifyListeners();
  }

  Future<void> fetchExpenses({
    required String outletId,
    required DateTime from,
    required DateTime to,
  }) async {
    final hasData = _expenses.any((expense) => expense.outletId == outletId);
    _loading = !hasData;
    _refreshing = hasData;
    _errorMessage = null;
    notifyListeners();
    try {
      final remote =
          await _repository.getExpenses(outletId: outletId, from: from, to: to);
      final pending = _expenses
          .where((expense) => !expense.synced && expense.outletId == outletId)
          .toList();
      _expenses.removeWhere((expense) => expense.outletId == outletId);
      _expenses.addAll([...pending, ...remote]);
      _expenses.sort((a, b) => b.date.compareTo(a.date));
      await _save();
    } catch (error) {
      _errorMessage = error.toString();
    } finally {
      _loading = false;
      _refreshing = false;
      notifyListeners();
    }
  }

  Future<void> _save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_storageKey,
        jsonEncode(_expenses.map((expense) => expense.toJson()).toList()));
  }

  Future<void> addExpense(
      {required String outletId,
      required String category,
      required int amount,
      required String note,
      required DateTime date}) async {
    _submitting = true;
    final expense = PosExpense(
        id: 'expense_local_${DateTime.now().microsecondsSinceEpoch}',
        outletId: outletId,
        category: category,
        amount: amount,
        note: note,
        date: date,
        synced: false);
    try {
      _expenses.insert(0, expense);
      await _save();
      notifyListeners();
      final synced = await _sendExpense(expense);
      if (synced != null) {
        final index = _expenses.indexWhere((item) => item.id == expense.id);
        if (index >= 0) _expenses[index] = synced.copyWith(synced: true);
        await _save();
        notifyListeners();
      }
    } finally {
      _submitting = false;
      notifyListeners();
    }
  }

  Future<bool> updateExpense(
      {required PosExpense expense,
      required String category,
      required int amount,
      required String note}) async {
    if (!expense.canEdit) {
      _errorMessage = 'Pengeluaran sudah approved dan tidak bisa diedit.';
      notifyListeners();
      return false;
    }
    _submitting = true;
    _errorMessage = null;
    notifyListeners();

    final updated = expense.copyWith(
      category: category,
      amount: amount,
      note: note,
      synced: expense.synced,
    );
    final index = _expenses.indexWhere((item) => item.id == expense.id);
    if (index < 0) {
      _submitting = false;
      notifyListeners();
      return false;
    }

    try {
      if (!expense.synced) {
        _expenses[index] = updated.copyWith(synced: false);
        await _save();
        notifyListeners();
        return true;
      }

      final synced = await _sendExpenseUpdate(updated);
      if (synced == null) {
        _errorMessage =
            'Gagal update pengeluaran. Cek koneksi/backend lalu coba lagi.';
        return false;
      }

      _expenses[index] = synced.copyWith(synced: true);
      await _save();
      notifyListeners();
      return true;
    } finally {
      _submitting = false;
      notifyListeners();
    }
  }

  List<PosExpense> filtered(
          {required String outletId,
          required DateTime from,
          required DateTime to}) =>
      _expenses
          .where((expense) =>
              expense.outletId == outletId &&
              sameOrAfter(expense.date, from) &&
              sameOrBefore(expense.date, to))
          .toList();

  Future<void> markAllSynced() async {
    for (var i = 0; i < _expenses.length; i++) {
      _expenses[i] = _expenses[i].copyWith(synced: true);
    }
    await _save();
    notifyListeners();
  }

  Future<void> syncPending() async {
    for (var i = 0; i < _expenses.length; i++) {
      final expense = _expenses[i];
      if (expense.synced) continue;
      final synced = await _sendExpense(expense);
      if (synced != null) {
        _expenses[i] = synced.copyWith(synced: true);
      }
    }
    await _save();
    notifyListeners();
  }

  Future<PosExpense?> _sendExpense(PosExpense expense) async {
    try {
      final response = Map<String, dynamic>.from(await ApiClient.instance
          .post('/pos/expenses', body: expense.toJson()));
      return PosExpense.fromJson(response);
    } catch (error) {
      if (error is! ApiException || error.statusCode == null) {
        await _activityLogs.record(
            outletId: expense.outletId,
            module: 'expense',
            action: 'create',
            outcome: 'failed',
            entityType: 'expense',
            entityId: expense.id,
            description: 'Input pengeluaran gagal sebelum mencapai backend.',
            metadata: {'error': error.toString(), 'amount': expense.amount});
      }
      return null;
    }
  }

  Future<PosExpense?> _sendExpenseUpdate(PosExpense expense) async {
    try {
      final response = Map<String, dynamic>.from(await ApiClient.instance
          .put('/pos/expenses/${expense.id}', body: expense.toJson()));
      return PosExpense.fromJson(response);
    } catch (error) {
      if (error is! ApiException || error.statusCode == null) {
        await _activityLogs.record(
            outletId: expense.outletId,
            module: 'expense',
            action: 'update',
            outcome: 'failed',
            entityType: 'expense',
            entityId: expense.id,
            description: 'Edit pengeluaran gagal sebelum mencapai backend.',
            metadata: {'error': error.toString(), 'amount': expense.amount});
      }
      return null;
    }
  }
}
