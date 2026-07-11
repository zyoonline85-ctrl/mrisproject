import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:pos_kasir_barokah/models/app_models.dart';
import 'package:pos_kasir_barokah/services/receipt_text_layout.dart';
import 'package:pos_kasir_barokah/utils/order_print_delta.dart';

TransactionItem item(String id, int quantity,
        {String variant = '',
        String categoryName = 'Makanan',
        int categorySortOrder = 0}) =>
    TransactionItem(
      productId: id,
      productName: id,
      categoryId: 'cat',
      categoryName: categoryName,
      categorySortOrder: categorySortOrder,
      quantity: quantity,
      unitPrice: 10000,
      subtotal: quantity * 10000,
      selectedVariants: variant.isEmpty
          ? const []
          : [ProductVariant(id: variant, productId: id, name: variant)],
    );

void main() {
  setUpAll(() => initializeDateFormatting('id_ID', null));

  test('delta memisahkan tambahan dan pengurangan quantity', () {
    final delta = calculateOrderPrintDelta(
      checkpoint: [item('ayam', 1), item('nasi', 2)],
      current: [item('ayam', 3), item('nasi', 1), item('es', 1)],
    );

    expect(delta.added.map((row) => '${row.productId}:${row.quantity}'),
        containsAll(['ayam:2', 'es:1']));
    expect(delta.removed.single.productId, 'nasi');
    expect(delta.removed.single.quantity, 1);
  });

  test('varian berbeda dianggap item berbeda', () {
    final delta = calculateOrderPrintDelta(
      checkpoint: [item('ayam', 1, variant: 'pedas')],
      current: [item('ayam', 1, variant: 'original')],
    );

    expect(delta.added.single.selectedVariants.single.id, 'original');
    expect(delta.removed.single.selectedVariants.single.id, 'pedas');
  });

  test('item yang hilang dari cart masuk koreksi bukan tambahan', () {
    final delta = calculateOrderPrintDelta(
      checkpoint: [item('ayam', 1), item('es-teh', 1)],
      current: [item('ayam', 1)],
    );

    expect(delta.added, isEmpty);
    expect(delta.removed.single.productId, 'es-teh');
    expect(delta.removed.single.quantity, 1);
  });

  test('checkpoint dapat diperbarui per tiket sukses', () {
    final original = [item('ayam', 1), item('nasi', 2)];
    final afterAddition = applyPrintedItems(
      checkpoint: original,
      printed: [item('ayam', 2)],
      removal: false,
    );
    final afterCorrection = applyPrintedItems(
      checkpoint: afterAddition,
      printed: [item('nasi', 1)],
      removal: true,
    );

    expect(
        afterAddition.firstWhere((row) => row.productId == 'ayam').quantity, 3);
    expect(
        afterCorrection.firstWhere((row) => row.productId == 'nasi').quantity,
        1);
  });

  test('response lama tanpa checkpoint dianggap sudah pernah dicetak', () {
    final oldResponse = {
      'id': 'bill_1',
      'orderNumber': 'ORDER-1',
      'outletId': 'outlet_1',
      'cashierId': 'user_1',
      'tableNumber': 'A1',
      'items': [item('ayam', 2).toJson()],
      'total': 20000,
      'createdAt': '2026-06-22T10:00:00.000',
      'updatedAt': '2026-06-22T10:00:00.000',
      'synced': true,
    };

    final bill = OpenBill.fromJson(oldResponse);
    expect(bill.customerPrintedItems.single.quantity, 2);
    expect(bill.kitchenPrintedItems.single.quantity, 2);
  });

  test('checkpoint kosong eksplisit tetap berarti belum pernah dicetak', () {
    final response = {
      'id': 'bill_2',
      'orderNumber': 'ORDER-2',
      'outletId': 'outlet_1',
      'cashierId': 'user_1',
      'tableNumber': 'A2',
      'items': [item('ayam', 1).toJson()],
      'total': 10000,
      'createdAt': '2026-06-22T10:00:00.000',
      'updatedAt': '2026-06-22T10:00:00.000',
      'synced': true,
      'customerPrintedItems': <Map<String, dynamic>>[],
      'kitchenPrintedItems': <Map<String, dynamic>>[],
    };

    final bill = OpenBill.fromJson(response);
    expect(bill.customerPrintedItems, isEmpty);
    expect(bill.kitchenPrintedItems, isEmpty);
  });

  test('open bill takeaway boleh tanpa nomor meja', () {
    final response = {
      'id': 'bill_takeaway',
      'orderNumber': 'ORDER-TA',
      'outletId': 'outlet_1',
      'cashierId': 'user_1',
      'serviceType': 'takeaway',
      'tableNumber': null,
      'items': [item('ayam', 1).toJson()],
      'total': 10000,
      'createdAt': '2026-06-22T10:00:00.000',
      'updatedAt': '2026-06-22T10:00:00.000',
      'synced': true,
    };

    final bill = OpenBill.fromJson(response);

    expect(bill.serviceType, 'takeaway');
    expect(bill.tableNumber, isNull);
  });

  test('label jenis delta tercetak pada tiket customer dan kitchen', () {
    const outlet = Outlet(
      id: 'outlet_1',
      name: 'Barokah',
      code: 'BRK',
      address: 'Alamat',
      phone: '0812',
    );
    final customer = ReceiptTextLayout.customerOrder(
      outlet: outlet,
      orderNumber: 'ORDER-1',
      cashierName: 'Kasir',
      serviceType: 'dine_in',
      tableNumber: 'A1',
      items: [item('ayam', 1)],
      updateLabel: 'TAMBAHAN ORDER',
      printedAt: DateTime(2026, 6, 22, 10),
    );
    final kitchen = ReceiptTextLayout.kitchenOrder(
      outlet: outlet,
      orderNumber: 'ORDER-1',
      cashierName: 'Kasir',
      serviceType: 'dine_in',
      tableNumber: 'A1',
      items: [item('ayam', 1)],
      updateLabel: 'KOREKSI / BATAL',
      printedAt: DateTime(2026, 6, 22, 10),
    );

    expect(customer.join('\n'), contains('TAMBAHAN ORDER'));
    expect(kitchen.join('\n'), contains('KOREKSI / BATAL'));
  });

  test('nama customer tampil pada tiket customer dan kitchen', () {
    const outlet = Outlet(
      id: 'outlet_1',
      name: 'Barokah',
      code: 'BRK',
      address: 'Alamat',
      phone: '0812',
    );
    final customer = ReceiptTextLayout.customerOrder(
      outlet: outlet,
      orderNumber: 'ORDER-1',
      cashierName: 'Kasir',
      serviceType: 'takeaway',
      tableNumber: null,
      customerName: 'Budi',
      items: [item('ayam', 1)],
      printedAt: DateTime(2026, 6, 22, 10),
    );
    final kitchen = ReceiptTextLayout.kitchenOrder(
      outlet: outlet,
      orderNumber: 'ORDER-1',
      cashierName: 'Kasir',
      serviceType: 'takeaway',
      tableNumber: null,
      customerName: 'Budi',
      items: [item('ayam', 1)],
      printedAt: DateTime(2026, 6, 22, 10),
    );

    expect(
        customer.any(
            (line) => line.startsWith('Customer ') && line.contains('Budi')),
        isTrue);
    expect(
        kitchen.any(
            (line) => line.startsWith('Customer ') && line.contains('Budi')),
        isTrue);
  });

  test('nama customer kosong tidak menambah baris customer', () {
    const outlet = Outlet(
      id: 'outlet_1',
      name: 'Barokah',
      code: 'BRK',
      address: 'Alamat',
      phone: '0812',
    );
    final lines = ReceiptTextLayout.customerOrder(
      outlet: outlet,
      orderNumber: 'ORDER-1',
      cashierName: 'Kasir',
      serviceType: 'takeaway',
      tableNumber: null,
      customerName: '   ',
      items: [item('ayam', 1)],
      printedAt: DateTime(2026, 6, 22, 10),
    );

    expect(lines.any((line) => line.startsWith('Customer ')), isFalse);
  });

  test('kategori minuman tampil di bawah pada tiket order', () {
    const outlet = Outlet(
      id: 'outlet_1',
      name: 'Barokah',
      code: 'BRK',
      address: 'Alamat',
      phone: '0812',
    );
    final text = ReceiptTextLayout.customerOrder(
      outlet: outlet,
      orderNumber: 'ORDER-1',
      cashierName: 'Kasir',
      serviceType: 'dine_in',
      tableNumber: 'A1',
      items: [
        item('es-teh', 1, categoryName: 'Minuman'),
        item('ayam', 1),
        item('kopi', 1, categoryName: 'Minuman'),
        item('nasi', 1),
      ],
      printedAt: DateTime(2026, 6, 22, 10),
    ).join('\n');

    expect(text.indexOf('1x ayam'), lessThan(text.indexOf('1x es-teh')));
    expect(text.indexOf('1x nasi'), lessThan(text.indexOf('1x es-teh')));
    expect(text.indexOf('1x es-teh'), lessThan(text.indexOf('1x kopi')));
  });

  test('preview order tidak menampilkan kategori item', () {
    const outlet = Outlet(
      id: 'outlet_1',
      name: 'Barokah',
      code: 'BRK',
      address: 'Alamat',
      phone: '0812',
    );
    final lines = ReceiptTextLayout.customerOrder(
      outlet: outlet,
      orderNumber: 'ORDER-1',
      cashierName: 'Kasir',
      serviceType: 'takeaway',
      tableNumber: null,
      items: [item('ayam', 1)],
      printedAt: DateTime(2026, 6, 22, 10),
    );
    final text = lines.join('\n');

    expect(text, contains('1x ayam'));
    expect(text, isNot(contains('Makanan')));
  });

  test('print bill hanya menampilkan quantity di baris harga', () {
    const outlet = Outlet(
      id: 'outlet_1',
      name: 'Barokah',
      code: 'BRK',
      address: 'Alamat',
      phone: '0812',
    );
    final transaction = PosTransaction.fromJson({
      'id': 'trx_1',
      'orderNumber': 'ORDER-1',
      'outletId': outlet.id,
      'cashierId': 'user_1',
      'serviceType': 'dine_in',
      'tableNumber': 'A1',
      'paymentMethod': 'cash',
      'paidAmount': 10000,
      'changeAmount': 0,
      'subtotal': 10000,
      'total': 10000,
      'createdAt': '2026-06-22T10:00:00.000',
      'synced': true,
      'items': [item('ayam', 1).toJson()],
    });
    final text = ReceiptTextLayout.billReceipt(
      transaction: transaction,
      outlet: outlet,
      cashierName: 'Kasir',
      paymentLabel: 'Cash',
    ).join('\n');

    expect(text, contains('\nayam\n'));
    expect(text, isNot(contains('1x ayam')));
    expect(text, contains('1 x Rp 10.000'));
  });

  test('print bill mengurutkan makanan sebelum minuman sesuai sort kategori',
      () {
    const outlet = Outlet(
      id: 'outlet_1',
      name: 'Barokah',
      code: 'BRK',
      address: 'Alamat',
      phone: '0812',
    );
    final transaction = PosTransaction.fromJson({
      'id': 'trx_2',
      'orderNumber': 'ORDER-2',
      'outletId': outlet.id,
      'cashierId': 'user_1',
      'serviceType': 'dine_in',
      'tableNumber': 'A1',
      'paymentMethod': 'cash',
      'paidAmount': 30000,
      'changeAmount': 0,
      'subtotal': 30000,
      'total': 30000,
      'createdAt': '2026-06-22T10:00:00.000',
      'synced': true,
      'items': [
        item('es-teh', 1, categoryName: 'Minuman', categorySortOrder: 2)
            .toJson(),
        item('nasi', 1, categoryName: 'Makanan', categorySortOrder: 1).toJson(),
      ],
    });
    final text = ReceiptTextLayout.billReceipt(
      transaction: transaction,
      outlet: outlet,
      cashierName: 'Kasir',
      paymentLabel: 'Cash',
    ).join('\n');

    expect(text.indexOf('\nnasi\n'), lessThan(text.indexOf('\nes-teh\n')));
  });

  test('print bill menampilkan breakdown split payment', () {
    const outlet = Outlet(
      id: 'outlet_1',
      name: 'Barokah',
      code: 'BRK',
      address: 'Alamat',
      phone: '0812',
    );
    final transaction = PosTransaction.fromJson({
      'id': 'trx_3',
      'orderNumber': 'ORDER-3',
      'outletId': outlet.id,
      'cashierId': 'user_1',
      'serviceType': 'takeaway',
      'paymentMethod': 'cash',
      'paidAmount': 30000,
      'changeAmount': 0,
      'subtotal': 30000,
      'total': 30000,
      'createdAt': '2026-06-22T10:00:00.000',
      'synced': true,
      'payments': [
        {'method': 'cash', 'amount': 20000},
        {'method': 'qris', 'amount': 10000},
      ],
      'items': [item('ayam', 3).toJson()],
    });
    final text = ReceiptTextLayout.billReceipt(
      transaction: transaction,
      outlet: outlet,
      cashierName: 'Kasir',
    ).join('\n');

    expect(text, contains('DIBAYAR CASH'));
    expect(text, contains('DIBAYAR QRIS'));
    expect(text, contains('TOTAL BAYAR'));
  });
}
