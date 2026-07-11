import 'package:flutter/foundation.dart';
import '../models/app_models.dart';
import '../services/activity_log_service.dart';

class OutletProvider extends ChangeNotifier {
  Outlet? _selectedOutlet;
  Outlet? get selectedOutlet => _selectedOutlet;

  List<Outlet> outletsForUser(CashierUser? user, {List<Outlet>? outlets}) {
    if (user == null) return [];
    final sourceOutlets = outlets ?? const <Outlet>[];
    return sourceOutlets
        .where((outlet) => user.outletIds.contains(outlet.id))
        .toList();
  }

  void selectOutlet(Outlet outlet) {
    _selectedOutlet = outlet;
    ActivityLogService.setCurrentOutlet(outlet.id);
    notifyListeners();
  }

  void clear() {
    _selectedOutlet = null;
    ActivityLogService.setCurrentOutlet(null);
    notifyListeners();
  }
}
