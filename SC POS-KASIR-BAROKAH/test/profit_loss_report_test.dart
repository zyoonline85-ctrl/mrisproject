import 'package:flutter_test/flutter_test.dart';
import 'package:pos_kasir_barokah/repositories/pos_repository.dart';

void main() {
  group('AccountingReportRow', () {
    test('membaca percent_of_income dari kontrak backend baru', () {
      final row = AccountingReportRow.fromJson({
        'description': 'Harga Pokok Penjualan',
        'total': 45,
        'percent_of_income': 50,
        'percent': 99,
        'account_code': '5002',
      });

      expect(row.percentOfIncome, 50);
      expect(row.showsAccountDetails, isTrue);
    });

    test('tetap membaca percent dari backend lama', () {
      final row = AccountingReportRow.fromJson({
        'description': 'Biaya / Expense',
        'total': 9,
        'percent': 10,
        'account_code': '6000',
      });

      expect(row.percentOfIncome, 10);
      expect(row.showsAccountDetails, isTrue);
    });

    test('Pendapatan Usaha tidak menampilkan atau meminta detail akun', () {
      final byCode = AccountingReportRow.fromJson({
        'description': 'Penjualan Utama',
        'total': 100,
        'percent_of_income': 111.11,
        'account_code': '4001',
      });
      final byName = AccountingReportRow.fromJson({
        'description': '[4100] Pendapatan Usaha',
        'total': 100,
        'percent_of_income': 111.11,
        'account_code': '4100',
      });

      expect(byCode.isBusinessIncome, isTrue);
      expect(byCode.showsAccountDetails, isFalse);
      expect(byName.isBusinessIncome, isTrue);
      expect(byName.showsAccountDetails, isFalse);
    });
  });
}
