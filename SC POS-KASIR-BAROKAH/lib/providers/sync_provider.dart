import 'package:flutter/foundation.dart';
import '../models/app_models.dart';
import 'catalog_provider.dart';
import 'expense_provider.dart';
import 'open_bill_provider.dart';
import 'pos_report_provider.dart';
import 'purchase_provider.dart';
import 'transaction_provider.dart';
import 'transfer_provider.dart';
import '../services/activity_log_service.dart';

class SyncProvider extends ChangeNotifier {
  bool _syncing = false;
  String? _errorMessage;
  bool get syncing => _syncing;
  String? get errorMessage => _errorMessage;

  Future<void> syncNow(
      TransactionProvider transactions,
      ExpenseProvider expenses,
      PurchaseProvider purchases,
      TransferProvider transfers,
      OpenBillProvider openBills,
      CatalogProvider catalog,
      Outlet? outlet,
      PosReportProvider reports,
      CashierUser user) async {
    _syncing = true;
    _errorMessage = null;
    notifyListeners();
    try {
      await const ActivityLogService().syncPending();
      if (user.can('apk.sales', 'create') ||
          user.can('apk.sales', 'update') ||
          user.can('apk.sales', 'cancel')) {
        await openBills.syncPending(outletId: outlet?.id);
        if (openBills.errorMessage != null) {
          throw Exception(openBills.errorMessage);
        }
      }
      if (user.can('apk.sales', 'create')) {
        await transactions.syncPending();
        if (transactions.errorMessage != null) {
          throw Exception(transactions.errorMessage);
        }
      }
      await catalog.loadCatalog();
      if (outlet != null) {
        final now = DateTime.now();
        final from = DateTime(now.year, now.month, 1);
        if (user.can('apk.history')) {
          await transactions.fetchHistory(
              outletId: outlet.id, from: from, to: now);
        }
        if (user.can('apk.expenses')) {
          await expenses.fetchExpenses(
              outletId: outlet.id, from: from, to: now);
        }
        if (user.can('apk.purchases')) {
          await purchases.fetchPurchases(
              outletId: outlet.id, from: from, to: now);
        }
        if (user.can('apk.transfers')) {
          await transfers.fetchTransfers(
              outletId: outlet.id, from: from, to: now);
        }
        if (user.can('apk.reports')) {
          await reports.fetchReport(outletId: outlet.id, from: from, to: now);
        }
      }
    } catch (error) {
      _errorMessage = error.toString();
      rethrow;
    } finally {
      _syncing = false;
      notifyListeners();
    }
  }
}
