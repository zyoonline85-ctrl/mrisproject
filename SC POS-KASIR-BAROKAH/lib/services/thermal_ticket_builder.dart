import 'package:esc_pos_utils_plus/esc_pos_utils_plus.dart';

import '../models/app_models.dart';
import 'receipt_text_layout.dart';

class ThermalTicketBuilder {
  const ThermalTicketBuilder._();

  static Future<List<int>> customerOrder({
    required Outlet outlet,
    required String orderNumber,
    required String cashierName,
    required String serviceType,
    required String? tableNumber,
    required List<TransactionItem> items,
    String? customerName,
    String? updateLabel,
    String? footerText,
  }) {
    return bytesFromLines(ReceiptTextLayout.customerOrder(
      outlet: outlet,
      orderNumber: orderNumber,
      cashierName: cashierName,
      serviceType: serviceType,
      tableNumber: tableNumber,
      items: items,
      customerName: customerName,
      updateLabel: updateLabel,
      footerText: footerText,
    ));
  }

  static Future<List<int>> kitchenOrder({
    required Outlet outlet,
    required String orderNumber,
    required String cashierName,
    required String serviceType,
    required String? tableNumber,
    required List<TransactionItem> items,
    String? customerName,
    String? updateLabel,
  }) {
    return bytesFromLines(ReceiptTextLayout.kitchenOrder(
      outlet: outlet,
      orderNumber: orderNumber,
      cashierName: cashierName,
      serviceType: serviceType,
      tableNumber: tableNumber,
      items: items,
      customerName: customerName,
      updateLabel: updateLabel,
    ));
  }

  static Future<List<int>> billReceipt({
    required PosTransaction transaction,
    required Outlet outlet,
    required String cashierName,
    String? paymentLabel,
    String? footerText,
  }) async {
    return bytesFromLines(ReceiptTextLayout.billReceipt(
      transaction: transaction,
      outlet: outlet,
      cashierName: cashierName,
      paymentLabel: paymentLabel,
      footerText: footerText,
    ));
  }

  static Future<List<int>> bytesFromLines(List<String> lines) async {
    final generator = await _generator();
    final bytes = <int>[];
    bytes.addAll(generator.reset());
    for (final line in lines) {
      bytes.addAll(generator.text(line));
    }
    bytes.addAll(generator.feed(3));
    return bytes;
  }

  static Future<Generator> _generator() async {
    final profile = await CapabilityProfile.load();
    return Generator(PaperSize.mm58, profile);
  }
}
