import 'package:flutter_test/flutter_test.dart';
import 'package:pos_kasir_barokah/data/mock_data.dart';
import 'package:pos_kasir_barokah/utils/formatters.dart';

void main() {
  test('mock data dan formatter tersedia untuk simulasi POS', () {
    expect(MockData.outlets, isNotEmpty);
    expect(MockData.products, isNotEmpty);
    expect(formatCurrency(25000), contains('25.000'));
  });
}
