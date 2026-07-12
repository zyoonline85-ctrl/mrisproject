import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

class ApiException implements Exception {
  const ApiException(this.message, {this.statusCode, this.details});

  final String message;
  final int? statusCode;
  final Object? details;

  bool get isUnauthorized => statusCode == 401;

  @override
  String toString() => message;
}

class ApiClient {
  ApiClient._();

  static final ApiClient instance = ApiClient._();

  static const String defaultBaseUrl = String.fromEnvironment('API_BASE_URL',
      defaultValue: 'https://backend.posbarokah.barokahgroupindonesia.tech/api');

  final http.Client _client = http.Client();
  String _baseUrl = defaultBaseUrl;
  String? _token;
  Duration timeout = const Duration(seconds: 12);
  void Function()? onUnauthorized;

  String get baseUrl => _baseUrl;

  void configure({String? baseUrl, String? token}) {
    if (baseUrl != null && baseUrl.trim().isNotEmpty) {
      _baseUrl = baseUrl.trim().replaceAll(RegExp(r'/+$'), '');
    }
    _token = token;
  }

  void setToken(String? token) {
    _token = token;
  }

  Future<dynamic> get(String path, {Map<String, String>? query}) {
    return _send('GET', path, query: query);
  }

  Future<dynamic> post(String path, {Object? body}) {
    return _send('POST', path, body: body);
  }

  Future<dynamic> put(String path, {Object? body}) {
    return _send('PUT', path, body: body);
  }

  Future<dynamic> delete(String path) {
    return _send('DELETE', path);
  }

  Future<dynamic> _send(
    String method,
    String path, {
    Object? body,
    Map<String, String>? query,
  }) async {
    final uri = _buildUri(path, query);
    final headers = <String, String>{
      'Accept': 'application/json',
      'Content-Type': 'application/json; charset=UTF-8',
      if (_token != null && _token!.isNotEmpty)
        'Authorization': 'Bearer $_token',
    };

    try {
      final request = http.Request(method, uri)..headers.addAll(headers);
      if (body != null) {
        request.body = jsonEncode(body);
      }
      final streamed = await _client.send(request).timeout(timeout);
      final response = await http.Response.fromStream(streamed);
      return _unwrap(response);
    } on TimeoutException {
      throw const ApiException(
          'Request timeout. Cek koneksi backend atau jaringan.');
    } on SocketException {
      throw const ApiException(
          'Tidak bisa terhubung ke backend. Cek API_BASE_URL, IP laptop, dan pastikan backend aktif.');
    } on http.ClientException catch (error) {
      throw ApiException(error.message);
    }
  }

  Uri _buildUri(String path, Map<String, String>? query) {
    final cleanPath = path.startsWith('/') ? path : '/$path';
    final uri = Uri.parse('$_baseUrl$cleanPath');
    return query == null || query.isEmpty
        ? uri
        : uri.replace(queryParameters: query);
  }

  dynamic _unwrap(http.Response response) {
    Map<String, dynamic> decoded = {};
    if (response.body.trim().isNotEmpty) {
      final body = jsonDecode(utf8.decode(response.bodyBytes));
      if (body is Map<String, dynamic>) decoded = body;
    }

    final success = decoded['success'] != false &&
        response.statusCode >= 200 &&
        response.statusCode < 300;
    if (!success) {
      if (response.statusCode == 401) {
        onUnauthorized?.call();
      }
      throw ApiException(
        decoded['message']?.toString() ?? 'Request gagal.',
        statusCode: response.statusCode,
        details: decoded['details'],
      );
    }

    if (decoded.containsKey('data')) return decoded['data'];
    return decoded;
  }

  void dispose() {
    _client.close();
  }
}
