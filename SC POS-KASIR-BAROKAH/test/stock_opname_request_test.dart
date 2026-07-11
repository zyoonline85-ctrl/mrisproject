import 'package:flutter_test/flutter_test.dart';
import 'package:pos_kasir_barokah/models/app_models.dart';

void main() {
  final item = StockOpnameWorksheetRow.fromJson({
    'material_id': 'material_001',
    'material_name': 'Ayam',
    'material_type': 'hpp',
    'unit': 'kg',
    'opening_quantity': 10,
    'incoming_quantity': 2,
    'transfer_out_quantity': 1,
    'damage_quantity': 0,
    'real_system_quantity': 11,
    'actual_quantity': 9,
    'difference': 2,
    'status': 'stock_hilang',
  });

  test('request pending hanya dapat diedit oleh pembuatnya', () {
    final request = StockOpnameRequest.fromJson({
      'id': 'request_1',
      'batch_id': 'batch_1',
      'outlet_id': 'outlet_1',
      'opname_date': '2026-06-22',
      'requested_by': 'user_1',
      'requested_user': {'id': 'user_1', 'name': 'Kasir'},
      'status': 'pending',
      'items': [item.toJson()],
    });

    expect(request.requestedById, 'user_1');
    expect(request.canEditBy('user_1'), isTrue);
    expect(request.canEditBy('user_2'), isFalse);
    expect(request.copyWith(status: 'approved').canEditBy('user_1'), isFalse);
  });

  test('copyWith edit mempertahankan identitas request dan mengganti isi', () {
    final request = StockOpnameRequest(
      id: 'request_1',
      batchId: 'batch_1',
      outletId: 'outlet_1',
      date: DateTime(2026, 6, 22),
      requestedById: 'user_1',
      items: [item],
    );
    final edited = request.copyWith(
      date: DateTime(2026, 6, 23),
      note: 'Hitung ulang',
      items: [item.copyWith(actualQuantity: 8)],
    );

    expect(edited.id, request.id);
    expect(edited.batchId, request.batchId);
    expect(edited.requestedById, request.requestedById);
    expect(edited.date, DateTime(2026, 6, 23));
    expect(edited.note, 'Hitung ulang');
    expect(edited.items.single.actualQuantity, 8);
  });

  test('detail kasir hanya menganggap kuantitas input sebagai input user', () {
    expect(item.hasUserInput, isTrue);

    final emptyInput = item.copyWith(
      openingQuantity: 0,
      damageQuantity: 0,
      actualQuantity: 0,
    );
    expect(emptyInput.incomingQuantity, 2);
    expect(emptyInput.difference, 2);
    expect(emptyInput.hasUserInput, isFalse);
    expect(emptyInput.copyWith(damageQuantity: 1).hasUserInput, isTrue);
  });

  test('parser lama memisahkan pembelian dan transfer serta menghitung sistem',
      () {
    expect(item.transferInQuantity, 1);
    expect(item.purchaseQuantity, 1);

    final calculated = StockOpnameWorksheetRow.fromJson({
      ...item.toJson(),
      'opening_quantity': 21,
      'purchase_quantity': 1,
      'transfer_in_quantity': 2,
      'transfer_out_quantity': 3,
      'computed_sales_quantity': 4,
      'damage_quantity': 1,
    });
    expect(calculated.calculateSystemQuantity(), 16);
  });
}
