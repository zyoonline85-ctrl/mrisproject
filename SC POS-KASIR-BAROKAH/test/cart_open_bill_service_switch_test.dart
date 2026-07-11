import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:pos_kasir_barokah/models/app_models.dart';
import 'package:pos_kasir_barokah/providers/cart_provider.dart';
import 'package:pos_kasir_barokah/providers/open_bill_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('order berjalan tetap terhubung saat diubah dine in ke takeaway', () {
    final cart = CartProvider();
    final bill = OpenBill(
      id: 'bill_1',
      orderNumber: 'ORDER-1',
      outletId: 'outlet_1',
      cashierId: 'user_1',
      serviceType: 'dine_in',
      tableNumber: 'A1',
      items: const [],
      total: 0,
      createdAt: DateTime(2026, 6, 30, 10),
      updatedAt: DateTime(2026, 6, 30, 10),
      synced: true,
    );

    cart.loadOpenBill(bill, const [], null);
    cart.setServiceType('takeaway');

    expect(cart.currentOpenBillId, 'bill_1');
    expect(cart.currentOpenBillOrderNumber, 'ORDER-1');
    expect(cart.serviceType, 'takeaway');
    expect(cart.tableNumber, isNull);

    cart.setServiceType('dine_in');

    expect(cart.currentOpenBillId, 'bill_1');
    expect(cart.currentOpenBillOrderNumber, 'ORDER-1');
    expect(cart.serviceType, 'dine_in');
    expect(cart.tableNumber, 'A1');
  });

  test('order berjalan tetap terhubung saat diubah takeaway ke dine in', () {
    final cart = CartProvider();
    final bill = OpenBill(
      id: 'bill_2',
      orderNumber: 'ORDER-2',
      outletId: 'outlet_1',
      cashierId: 'user_1',
      serviceType: 'takeaway',
      tableNumber: null,
      items: const [],
      total: 0,
      createdAt: DateTime(2026, 6, 30, 10),
      updatedAt: DateTime(2026, 6, 30, 10),
      synced: true,
    );

    cart.loadOpenBill(bill, const [], null);
    cart.setServiceType('dine_in');
    cart.setTable('B2');

    expect(cart.currentOpenBillId, 'bill_2');
    expect(cart.currentOpenBillOrderNumber, 'ORDER-2');
    expect(cart.serviceType, 'dine_in');
    expect(cart.tableNumber, 'B2');
  });
  test('provider order berjalan membersihkan cache lokal lama', () async {
    final cachedBill = OpenBill(
      id: 'bill_local_1',
      orderNumber: 'APS TT-20260709-100',
      outletId: 'outlet_1',
      cashierId: 'user_1',
      serviceType: 'dine_in',
      tableNumber: 'D12',
      items: const [],
      total: 100000,
      createdAt: DateTime(2026, 7, 9, 23),
      updatedAt: DateTime(2026, 7, 9, 23),
      synced: false,
    );
    SharedPreferences.setMockInitialValues({
      'barokah_pos_open_bills': jsonEncode([cachedBill.toJson()]),
      'barokah_pos_open_bill_delete_queue': jsonEncode(['bill_local_1']),
    });

    final provider = OpenBillProvider();
    await provider.load();
    final prefs = await SharedPreferences.getInstance();

    expect(provider.openBills, isEmpty);
    expect(provider.pendingCount, 0);
    expect(prefs.getString('barokah_pos_open_bills'), isNull);
    expect(prefs.getString('barokah_pos_open_bill_delete_queue'), isNull);
  });
}
