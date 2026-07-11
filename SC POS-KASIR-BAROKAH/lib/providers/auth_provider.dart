import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/app_models.dart';
import '../services/api_client.dart';
import '../services/activity_log_service.dart';

class AuthProvider extends ChangeNotifier {
  AuthProvider() {
    ApiClient.instance.onUnauthorized = () {
      logout();
    };
  }

  static const _storageKey = 'barokah_pos_auth_session';
  static const Map<String, List<String>> _legacyApkPermissions = {
    'apk.sales': ['view', 'create', 'update', 'cancel', 'print'],
    'apk.history': ['view', 'print'],
    'apk.purchases': ['view', 'create', 'update'],
    'apk.transfers': ['view', 'create'],
    'apk.opnames': ['view', 'create', 'update'],
    'apk.expenses': ['view', 'create', 'update'],
    'apk.reports': ['view', 'export'],
    'apk.printing': ['view', 'update', 'print'],
  };

  CashierUser? _user;
  String? _token;
  String? _error;
  bool _loading = false;
  bool _restored = false;

  CashierUser? get user => _user;
  String? get token => _token;
  String? get error => _error;
  bool get loading => _loading;
  bool get restored => _restored;
  bool get isLoggedIn => _user != null && (_token?.isNotEmpty ?? false);

  Future<List<CashierUser>> fetchCashiersForPinLogin() async {
    try {
      final response = await ApiClient.instance.get('/auth/cashiers');
      final list = response is Map<String, dynamic>
          ? List<dynamic>.from(response['cashiers'] ?? const [])
          : response is List
              ? List<dynamic>.from(response)
              : <dynamic>[];
      return list
          .whereType<Map>()
          .map((item) => _cashierFromJson(Map<String, dynamic>.from(item)))
          .where((cashier) => cashier.active)
          .toList();
    } on ApiException catch (error) {
      _error = error.message;
      notifyListeners();
      rethrow;
    } catch (_) {
      _error =
          'Gagal mengambil daftar kasir. Cek backend dan koneksi jaringan.';
      notifyListeners();
      rethrow;
    }
  }

  Future<void> restoreSession() async {
    if (_restored) return;
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_storageKey);
    if (raw == null) {
      _restored = true;
      notifyListeners();
      return;
    }

    try {
      final decoded = Map<String, dynamic>.from(jsonDecode(raw));
      final token = decoded['token']?.toString();
      final userJson = Map<String, dynamic>.from(decoded['user'] ?? const {});
      if (token == null || token.isEmpty || userJson.isEmpty) {
        await prefs.remove(_storageKey);
      } else {
        _token = token;
        _user = _cashierFromJson(userJson);
        await ActivityLogService.setCurrentUser(_user!.id);
        ApiClient.instance.setToken(_token);
        try {
          await refreshSession(notify: false);
        } on ApiException catch (error) {
          if (error.statusCode != 404) rethrow;
        }
        if (isLoggedIn) await const ActivityLogService().syncPending();
      }
    } catch (_) {
      await prefs.remove(_storageKey);
    }

    _restored = true;
    notifyListeners();
  }

  Future<bool> login(String username, String password) async {
    _error = null;
    _loading = true;
    notifyListeners();

    try {
      final response = Map<String, dynamic>.from(await ApiClient.instance.post(
        '/auth/login',
        body: {'username': username, 'password': password},
      ));
      return await _handleLoginResponse(response);
    } on ApiException catch (error) {
      _error = error.message;
      return false;
    } catch (_) {
      _error = 'Login gagal. Cek backend dan koneksi jaringan.';
      return false;
    } finally {
      _loading = false;
      _restored = true;
      notifyListeners();
    }
  }

  Future<bool> loginWithPin(String userId, String pin) async {
    _error = null;
    _loading = true;
    notifyListeners();

    try {
      final response = Map<String, dynamic>.from(await ApiClient.instance.post(
        '/auth/pin-login',
        body: {'user_id': userId, 'pin': pin},
      ));
      return await _handleLoginResponse(response);
    } on ApiException catch (error) {
      _error = error.message;
      return false;
    } catch (_) {
      _error = 'Login PIN gagal. Cek backend dan koneksi jaringan.';
      return false;
    } finally {
      _loading = false;
      _restored = true;
      notifyListeners();
    }
  }

  Future<void> logout() async {
    _user = null;
    _token = null;
    _error = null;
    ApiClient.instance.setToken(null);
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_storageKey);
    notifyListeners();
  }

  Future<bool> refreshSession({bool notify = true}) async {
    if (_token == null || _token!.isEmpty) return false;
    late Map<String, dynamic> response;
    try {
      response =
          Map<String, dynamic>.from(await ApiClient.instance.get('/auth/me'));
    } on ApiException catch (error) {
      if (error.statusCode == 404) return _user?.hasApkAccess ?? false;
      rethrow;
    }
    final user = _cashierFromJson(response);
    if (!user.active || !user.hasApkAccess) {
      await logout();
      _error = 'Akses APK untuk akun ini sudah dinonaktifkan Admin.';
      if (notify) notifyListeners();
      return false;
    }
    _user = user;
    await _saveSession();
    if (notify) notifyListeners();
    return true;
  }

  Future<bool> _handleLoginResponse(Map<String, dynamic> response) async {
    final token = response['token']?.toString();
    final userJson = Map<String, dynamic>.from(response['user'] ?? const {});

    if (token == null || token.isEmpty || userJson.isEmpty) {
      _error = 'Response login backend tidak valid.';
      return false;
    }

    final user = _cashierFromJson(userJson);
    if (!user.active) {
      _error = 'User tidak aktif.';
      return false;
    }
    if (!user.hasApkAccess) {
      _error = 'Role user belum memiliki permission APK.';
      return false;
    }

    _token = token;
    _user = user;
    await ActivityLogService.setCurrentUser(user.id);
    ApiClient.instance.setToken(token);
    await _saveSession();
    await const ActivityLogService().syncPending();
    return true;
  }

  Future<void> _saveSession() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _storageKey,
      jsonEncode({
        'token': _token,
        'user': {
          'id': _user?.id,
          'name': _user?.name,
          'username': _user?.username,
          'outlet_ids': _user?.outletIds,
          'role_id': _user?.roleId,
          'role_name': _user?.roleName,
          'permissions': _user?.permissions,
          'status': _user?.active == true ? 'active' : 'inactive',
        }
      }),
    );
  }

  CashierUser _cashierFromJson(Map<String, dynamic> json) {
    final role = json['role'] is Map
        ? Map<String, dynamic>.from(json['role'] as Map)
        : <String, dynamic>{};
    final roleId = json['role_id']?.toString() ?? role['id']?.toString() ?? '';
    final rawPermissions = json['permissions'] ?? role['permissions'];
    final parsedPermissions = <String, List<String>>{};
    if (rawPermissions is Map) {
      for (final entry in rawPermissions.entries) {
        if (entry.value is List) {
          parsedPermissions[entry.key.toString()] =
              List<dynamic>.from(entry.value as List)
                  .map((action) => action.toString())
                  .toList();
        }
      }
    }
    final hasApkContract =
        parsedPermissions.keys.any((key) => key.startsWith('apk.'));
    final permissions = !hasApkContract && roleId == 'role_cashier'
        ? _legacyApkPermissions
        : parsedPermissions;
    final outlets = json['outlet_ids'] ??
        (json['outlets'] is List
            ? (json['outlets'] as List).map((item) {
                if (item is Map) return item['id']?.toString() ?? '';
                return item.toString();
              }).toList()
            : const []);

    return CashierUser(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      username: json['username']?.toString() ?? '',
      password: '',
      outletIds: List<dynamic>.from(outlets)
          .map((id) => id.toString())
          .where((id) => id.isNotEmpty)
          .toList(),
      active: json['status']?.toString() != 'inactive',
      roleId: roleId,
      roleName: json['role_name']?.toString() ?? role['name']?.toString() ?? '',
      permissions: permissions,
    );
  }
}
