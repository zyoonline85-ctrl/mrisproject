import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'api_client.dart';

class ActivityLogService {
  const ActivityLogService();

  static const _queuePrefix = 'barokah_pos_activity_log_queue';
  static const _legacyQueueKey = 'barokah_pos_activity_log_queue';
  static String? _currentUserId;
  static String? _currentOutletId;

  static void setCurrentOutlet(String? outletId) {
    _currentOutletId =
        outletId?.trim().isEmpty == true ? null : outletId?.trim();
  }

  static Future<void> setCurrentUser(String userId) async {
    _currentUserId = userId.trim().isEmpty ? null : userId.trim();
    if (_currentUserId == null) return;
    final prefs = await SharedPreferences.getInstance();
    final legacy = prefs.getString(_legacyQueueKey);
    if (legacy != null) {
      final current = prefs.getString(_queueKey);
      final merged = <dynamic>[];
      if (current != null) merged.addAll(jsonDecode(current) as List);
      merged.addAll(jsonDecode(legacy) as List);
      await prefs.setString(_queueKey, jsonEncode(merged));
      await prefs.remove(_legacyQueueKey);
    }
  }

  static String get _queueKey =>
      '$_queuePrefix:${_currentUserId ?? 'anonymous'}';

  Future<void> record({
    String? outletId,
    required String module,
    required String action,
    String source = 'kasir_app',
    String eventType = 'interaction',
    String outcome = 'succeeded',
    String? entityType,
    String? entityId,
    String? description,
    Map<String, dynamic> metadata = const {},
    String? correlationId,
  }) async {
    final now = DateTime.now();
    final eventId = 'apk_event_${now.microsecondsSinceEpoch}';
    final log = {
      'clientEventId': eventId,
      'correlationId':
          correlationId ?? 'apk_correlation_${now.microsecondsSinceEpoch}',
      'outletId':
          outletId?.trim().isNotEmpty == true ? outletId : _currentOutletId,
      'source': source,
      'eventType': eventType,
      'outcome': outcome,
      'module': module,
      'action': action,
      'entityType': entityType,
      'entityId': entityId,
      'description': description,
      'metadata': _sanitizeMetadata(metadata),
      'deviceId': await _deviceId(),
      'appVersion':
          const String.fromEnvironment('APP_VERSION', defaultValue: '0.1.0'),
      'occurredAt': now.toIso8601String(),
    };

    try {
      await ApiClient.instance.post('/pos/activity-logs', body: log);
      await syncPending();
    } catch (_) {
      await _enqueue(log);
    }
  }

  Future<void> syncPending() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_queueKey);
    if (raw == null) return;
    final logs = List<Map<String, dynamic>>.from(
      (jsonDecode(raw) as List).map((item) => Map<String, dynamic>.from(item)),
    );
    if (logs.isEmpty) return;

    try {
      final batch = logs.take(100).toList();
      await ApiClient.instance
          .post('/pos/activity-logs', body: {'logs': batch});
      final remaining = logs.skip(batch.length).toList();
      if (remaining.isEmpty) {
        await prefs.remove(_queueKey);
      } else {
        await prefs.setString(_queueKey, jsonEncode(remaining));
        await syncPending();
      }
    } catch (_) {
      // Keep the queue for the next sync.
    }
  }

  Future<void> _enqueue(Map<String, dynamic> log) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_queueKey);
    final logs = raw == null
        ? <Map<String, dynamic>>[]
        : List<Map<String, dynamic>>.from(
            (jsonDecode(raw) as List)
                .map((item) => Map<String, dynamic>.from(item)),
          );
    if (!logs.any((item) => item['clientEventId'] == log['clientEventId'])) {
      logs.add(log);
    }
    await prefs.setString(_queueKey, jsonEncode(logs));
  }

  static Future<String> _deviceId() async {
    const key = 'barokah_pos_device_id';
    final prefs = await SharedPreferences.getInstance();
    final existing = prefs.getString(key);
    if (existing != null && existing.isNotEmpty) return existing;
    final value = 'apk_device_${DateTime.now().microsecondsSinceEpoch}';
    await prefs.setString(key, value);
    return value;
  }

  static dynamic _sanitizeMetadata(dynamic value, [int depth = 0]) {
    if (value == null || depth > 3) return null;
    if (value is num || value is bool) return value;
    if (value is String) {
      return value.length > 500 ? value.substring(0, 500) : value;
    }
    if (value is List) {
      return value
          .take(50)
          .map((item) => _sanitizeMetadata(item, depth + 1))
          .toList();
    }
    if (value is Map) {
      final result = <String, dynamic>{};
      final sensitive = RegExp(
          r'password|passwd|pin|token|secret|authorization|cookie|card|cvv|otp|keyword|search_text|query',
          caseSensitive: false);
      for (final entry in value.entries) {
        if (!sensitive.hasMatch(entry.key.toString())) {
          result[entry.key.toString()] =
              _sanitizeMetadata(entry.value, depth + 1);
        }
      }
      return result;
    }
    return null;
  }
}
