import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../repositories/pos_repository.dart';

class FavoriteProductProvider extends ChangeNotifier {
  FavoriteProductProvider({PosRepository? repository})
      : _repository = repository ?? const PosRepository();

  final PosRepository _repository;
  final Map<String, Set<String>> _idsByOutlet = {};
  final Map<String, String> _cacheKeyByOutlet = {};
  final Set<String> _loadingOutlets = {};
  String? _errorMessage;

  String? get errorMessage => _errorMessage;

  Set<String> idsFor(String outletId) =>
      Set.unmodifiable(_idsByOutlet[outletId] ?? const <String>{});

  bool isFavorite(String outletId, String productId) =>
      _idsByOutlet[outletId]?.contains(productId) == true;

  bool isLoading(String outletId) => _loadingOutlets.contains(outletId);

  Future<void> load({
    required String userId,
    required String outletId,
    bool force = false,
  }) async {
    final key = _storageKey(userId, outletId);
    if (!force && _cacheKeyByOutlet[outletId] == key) return;
    _cacheKeyByOutlet[outletId] = key;
    _errorMessage = null;

    final prefs = await SharedPreferences.getInstance();
    final cached = prefs.getString(key);
    if (cached != null) {
      try {
        _idsByOutlet[outletId] = List<dynamic>.from(jsonDecode(cached))
            .map((id) => id.toString())
            .toSet();
        notifyListeners();
      } catch (_) {
        await prefs.remove(key);
      }
    }

    _loadingOutlets.add(outletId);
    notifyListeners();
    try {
      final ids = await _repository.getProductFavorites(outletId: outletId);
      _idsByOutlet[outletId] = ids;
      await _saveCache(prefs, key, ids);
    } catch (error) {
      _errorMessage = 'Gagal memuat favorit produk.';
    } finally {
      _loadingOutlets.remove(outletId);
      notifyListeners();
    }
  }

  Future<bool> toggle({
    required String userId,
    required String outletId,
    required String productId,
  }) async {
    final key = _storageKey(userId, outletId);
    final previous =
        Set<String>.from(_idsByOutlet[outletId] ?? const <String>{});
    final next = Set<String>.from(previous);
    if (next.contains(productId)) {
      next.remove(productId);
    } else {
      next.add(productId);
    }

    _idsByOutlet[outletId] = next;
    _cacheKeyByOutlet[outletId] = key;
    _errorMessage = null;
    notifyListeners();

    try {
      final saved = await _repository.updateProductFavorites(
        outletId: outletId,
        productIds: next,
      );
      _idsByOutlet[outletId] = saved;
      final prefs = await SharedPreferences.getInstance();
      await _saveCache(prefs, key, saved);
      notifyListeners();
      return true;
    } catch (error) {
      _idsByOutlet[outletId] = previous;
      _errorMessage = 'Gagal menyimpan favorit produk. Cek koneksi/backend.';
      notifyListeners();
      return false;
    }
  }

  static String _storageKey(String userId, String outletId) =>
      'barokah_pos_product_favorites:$userId:$outletId';

  Future<void> _saveCache(
      SharedPreferences prefs, String key, Set<String> ids) async {
    await prefs.setString(key, jsonEncode(ids.toList()));
  }
}
