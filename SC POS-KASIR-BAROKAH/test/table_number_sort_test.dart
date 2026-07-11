import 'package:flutter_test/flutter_test.dart';
import 'package:pos_kasir_barokah/utils/table_number_sort.dart';

void main() {
  test('mengurutkan nomor meja alfanumerik secara natural', () {
    final numbers = ['A1', 'A10', 'A2', 'A11', 'A3'];

    numbers.sort(compareTableNumbers);

    expect(numbers, ['A1', 'A2', 'A3', 'A10', 'A11']);
  });

  test('tetap mengelompokkan prefix meja dengan urutan angka benar', () {
    final numbers = ['B10', 'A2', 'B1', 'A10', 'A1'];

    numbers.sort(compareTableNumbers);

    expect(numbers, ['A1', 'A2', 'A10', 'B1', 'B10']);
  });

  test('mengurutkan nomor murni berdasarkan nilai angka', () {
    final numbers = ['10', '2', '01', '1'];

    numbers.sort(compareTableNumbers);

    expect(numbers, ['1', '01', '2', '10']);
  });
}
