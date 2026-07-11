import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/app_models.dart';
import '../utils/formatters.dart';

class LocalOrderSequenceService {
  const LocalOrderSequenceService();

  static const _storageKey = 'barokah_pos_local_order_sequences';

  Future<String> nextOrderNumber(Outlet outlet, DateTime date) async {
    final prefs = await SharedPreferences.getInstance();
    final rows = _decode(prefs.getString(_storageKey));
    final key = _key(outlet, date);
    final next = (rows[key] ?? 0) + 1;
    rows[key] = next;
    await prefs.setString(_storageKey, jsonEncode(rows));
    return '${_prefix(outlet, date)}-${next.toString().padLeft(3, '0')}';
  }

  Future<void> reserveOrderNumber(
      Outlet outlet, String orderNumber, DateTime date) async {
    final suffix = suffixFor(outlet, date, orderNumber);
    if (suffix == null) return;
    final prefs = await SharedPreferences.getInstance();
    final rows = _decode(prefs.getString(_storageKey));
    final key = _key(outlet, date);
    if (suffix > (rows[key] ?? 0)) {
      rows[key] = suffix;
      await prefs.setString(_storageKey, jsonEncode(rows));
    }
  }

  int? suffixFor(Outlet outlet, DateTime date, String orderNumber) {
    final prefix = _prefix(outlet, date);
    final match = RegExp('^${RegExp.escape(prefix)}-(\\d+)\$')
        .firstMatch(orderNumber.trim());
    if (match == null) return null;
    return int.tryParse(match.group(1) ?? '');
  }

  static Map<String, int> _decode(String? raw) {
    if (raw == null || raw.isEmpty) return <String, int>{};
    final decoded = jsonDecode(raw) as Map<String, dynamic>;
    return decoded.map((key, value) => MapEntry(key, _toInt(value)));
  }

  static int _toInt(Object? value) {
    if (value is int) return value;
    if (value is num) return value.round();
    return int.tryParse(value?.toString() ?? '') ?? 0;
  }

  static String _key(Outlet outlet, DateTime date) =>
      '${outlet.id}:${formatOrderDate(date)}';

  static String _prefix(Outlet outlet, DateTime date) =>
      '${outlet.code}-${formatOrderDate(date)}';
}
