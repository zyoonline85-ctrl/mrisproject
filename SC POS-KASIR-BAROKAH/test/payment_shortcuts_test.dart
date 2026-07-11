import 'package:flutter_test/flutter_test.dart';
import 'package:pos_kasir_barokah/utils/payment_shortcuts.dart';

void main() {
  test('pecahan menambah nominal pembayaran yang sedang diinput', () {
    expect(addCashShortcut(15000, 10000), 25000);
    expect(addCashShortcut(25000, 100000), 125000);
  });

  test('uang pas mengikuti total transaksi', () {
    expect(exactCashShortcut(87500), 87500);
  });

  test('nominal negatif tidak menghasilkan pembayaran negatif', () {
    expect(addCashShortcut(-1000, -5000), 0);
    expect(exactCashShortcut(-1000), 0);
  });
}
