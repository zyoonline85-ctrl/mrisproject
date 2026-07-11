import 'package:flutter/foundation.dart';

import '../repositories/pos_repository.dart';

class PosReportProvider extends ChangeNotifier {
  final PosRepository _repository = const PosRepository();

  PosReportSnapshot? _report;
  bool _loading = false;
  bool _refreshing = false;
  String? _errorMessage;

  PosReportSnapshot? get report => _report;
  bool get loading => _loading;
  bool get refreshing => _refreshing;
  String? get errorMessage => _errorMessage;

  Future<void> fetchReport({
    required String outletId,
    required DateTime from,
    required DateTime to,
  }) async {
    _loading = _report == null;
    _refreshing = _report != null;
    _errorMessage = null;
    notifyListeners();
    try {
      _report =
          await _repository.getReport(outletId: outletId, from: from, to: to);
    } catch (error) {
      _errorMessage = error.toString();
    } finally {
      _loading = false;
      _refreshing = false;
      notifyListeners();
    }
  }
}
