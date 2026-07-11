import '../models/app_models.dart';
import '../utils/formatters.dart';

class PrintLayoutSpec {
  const PrintLayoutSpec._();

  static const printPaperLabel = '58mm';
  static const printEffectiveWidth = '48mm';
  static const charsPerLine = 30;
}

class ReceiptTextLayout {
  const ReceiptTextLayout._();

  static List<String> customerOrder({
    required Outlet outlet,
    required String orderNumber,
    required String cashierName,
    required String serviceType,
    required String? tableNumber,
    required List<TransactionItem> items,
    String? customerName,
    String? updateLabel,
    String? footerText,
    DateTime? printedAt,
  }) {
    return _orderTicket(
      title: 'CUSTOMER ORDER',
      outlet: outlet,
      orderNumber: orderNumber,
      cashierName: cashierName,
      serviceType: serviceType,
      tableNumber: tableNumber,
      items: items,
      customerName: customerName,
      updateLabel: updateLabel,
      footerText: footerText,
      printedAt: printedAt ?? DateTime.now(),
    );
  }

  static List<String> kitchenOrder({
    required Outlet outlet,
    required String orderNumber,
    required String cashierName,
    required String serviceType,
    required String? tableNumber,
    required List<TransactionItem> items,
    String? customerName,
    String? updateLabel,
    DateTime? printedAt,
  }) {
    return _orderTicket(
      title: 'KITCHEN ORDER',
      outlet: outlet,
      orderNumber: orderNumber,
      cashierName: cashierName,
      serviceType: serviceType,
      tableNumber: tableNumber,
      items: items,
      customerName: customerName,
      updateLabel: updateLabel,
      footerText: null,
      printedAt: printedAt ?? DateTime.now(),
    );
  }

  static List<String> billReceipt({
    required PosTransaction transaction,
    required Outlet outlet,
    required String cashierName,
    String? paymentLabel,
    String? footerText,
  }) {
    final lines = <String>[
      ..._header(outlet, 'BILL / RECEIPT'),
      ...field('Order', transaction.orderNumber),
      ...field('Kasir', cashierName),
      ...field('Waktu',
          '${formatDate(transaction.createdAt)} ${formatClock(transaction.createdAt)}'),
      ...field(
          'Layanan',
          '${transaction.serviceType == 'dine_in' ? 'Dine In' : 'Takeaway'} ${transaction.tableNumber ?? ''}'
              .trim()),
    ];

    if (transaction.customerName != null) {
      lines.addAll(field('Customer',
          '${transaction.customerName} (${transaction.customerPhone ?? '-'})'));
      lines.addAll(field('Point',
          '+${transaction.customerPointsEarned} / total ${transaction.customerPointsAfter}'));
    }

    lines.add(separator());
    for (final item in _orderTicketItems(transaction.items)) {
      lines.addAll(itemName(item, showQuantity: false));
      lines.addAll(itemVariants(item));
      lines.addAll(pairLine(
          '  ${item.quantity} x ${formatCurrency(item.unitPrice)}',
          formatCurrency(item.subtotal)));
    }
    lines.add(separator());
    final subtotal = transaction.subtotal > 0
        ? transaction.subtotal
        : transaction.items.fold(0, (total, item) => total + item.subtotal);
    if (transaction.discount > 0) {
      lines.addAll(pairLine('Subtotal', formatCurrency(subtotal)));
      lines.addAll(pairLine(
          transaction.discountName == null
              ? 'Discount'
              : 'Discount ${transaction.discountName}',
          '-${formatCurrency(transaction.discount)}'));
    }
    lines.addAll(pairLine('TOTAL BELANJA', formatCurrency(transaction.total)));
    final payments = transaction.effectivePayments;
    if (payments.length <= 1) {
      lines.addAll(pairLine(
          'DIBAYAR ${paymentLabel ?? transaction.paymentMethod.toUpperCase()}',
          formatCurrency(transaction.paidAmount)));
    } else {
      for (final payment in payments) {
        lines.addAll(pairLine('DIBAYAR ${payment.method.toUpperCase()}',
            formatCurrency(payment.amount)));
      }
      lines.addAll(
          pairLine('TOTAL BAYAR', formatCurrency(transaction.paidAmount)));
    }
    lines.addAll(
        pairLine('KEMBALIAN', formatCurrency(transaction.changeAmount)));
    _appendFooter(lines, footerText);
    return lines;
  }

  static List<String> _orderTicket({
    required String title,
    required Outlet outlet,
    required String orderNumber,
    required String cashierName,
    required String serviceType,
    required String? tableNumber,
    required List<TransactionItem> items,
    required String? customerName,
    required String? updateLabel,
    required String? footerText,
    required DateTime printedAt,
  }) {
    final cleanCustomerName = customerName?.trim() ?? '';
    final lines = <String>[
      ..._header(outlet, title),
      if (updateLabel != null) center(updateLabel),
      ...field('Order', orderNumber),
      ...field('Kasir', cashierName),
      ...field('Waktu', '${formatDate(printedAt)} ${formatClock(printedAt)}'),
      ...field(
          'Layanan',
          '${serviceType == 'dine_in' ? 'Dine In' : 'Takeaway'} ${tableNumber ?? ''}'
              .trim()),
      if (cleanCustomerName.isNotEmpty) ...field('Customer', cleanCustomerName),
      separator(),
    ];

    for (final item in _orderTicketItems(items)) {
      lines.addAll(itemName(item));
      lines.addAll(itemVariants(item));
    }
    _appendFooter(lines, footerText);
    return lines;
  }

  static List<TransactionItem> _orderTicketItems(List<TransactionItem> items) {
    final indexed = [
      for (var index = 0; index < items.length; index++)
        MapEntry(index, items[index])
    ];
    indexed.sort((a, b) {
      final byCategory =
          _categoryPrintOrder(a.value).compareTo(_categoryPrintOrder(b.value));
      if (byCategory != 0) return byCategory;
      return a.key.compareTo(b.key);
    });
    return indexed.map((entry) => entry.value).toList();
  }

  static int _categoryPrintOrder(TransactionItem item) {
    if (item.categorySortOrder > 0) return item.categorySortOrder;
    return item.categoryName.trim().toLowerCase() == 'minuman' ? 100000 : 0;
  }

  static void _appendFooter(List<String> lines, String? footerText) {
    final text = footerText?.trim() ?? '';
    if (text.isEmpty) return;
    lines
      ..add(separator())
      ..add('');
    for (final rawLine in text.split('\n')) {
      final line = rawLine.trim();
      if (line.isEmpty) {
        lines.add('');
        continue;
      }
      lines.addAll(wrap(line).map(center));
    }
  }

  static List<String> _header(Outlet outlet, String title) {
    return [
      ...wrap(outlet.name).map(center),
      ...wrap(outlet.address).map(center),
      center(title),
      separator(),
    ];
  }

  static List<String> itemName(TransactionItem item,
      {bool showQuantity = true}) {
    final prefix = showQuantity ? '${item.quantity}x ' : '';
    final wrapped = wrap(item.productName,
        width: PrintLayoutSpec.charsPerLine - prefix.length);
    if (wrapped.isEmpty) {
      return [prefix.trim()].where((line) => line.isNotEmpty).toList();
    }
    return [
      '$prefix${wrapped.first}',
      ...wrapped.skip(1).map((line) => '${' ' * prefix.length}$line'),
    ];
  }

  static List<String> itemVariants(TransactionItem item) {
    if (item.selectedVariants.isEmpty) return const [];
    final text =
        '+ ${item.selectedVariants.map((variant) => variant.name).join(', ')}';
    return wrap(text, width: PrintLayoutSpec.charsPerLine - 2)
        .map((line) => '  $line')
        .toList();
  }

  static List<String> field(String label, String value) {
    final cleanLabel = _clean(label);
    final cleanValue = _clean(value);
    const labelWidth = 9;
    const valueWidth = PrintLayoutSpec.charsPerLine - labelWidth;
    if (cleanValue.length <= valueWidth) {
      return [
        cleanLabel.padRight(labelWidth).substring(0, labelWidth) +
            cleanValue.padLeft(valueWidth)
      ];
    }

    return [
      cleanLabel,
      ...wrap(cleanValue, width: PrintLayoutSpec.charsPerLine - 2)
          .map((line) => '  $line'),
    ];
  }

  static List<String> pairLine(String left, String right) {
    final cleanLeft = _clean(left);
    final cleanRight = _clean(right);
    final availableLeft = PrintLayoutSpec.charsPerLine - cleanRight.length - 1;

    if (availableLeft >= 4 && cleanLeft.length <= availableLeft) {
      return [
        '${cleanLeft.padRight(availableLeft)} $cleanRight',
      ];
    }

    return [
      ...wrap(cleanLeft),
      cleanRight.padLeft(PrintLayoutSpec.charsPerLine),
    ];
  }

  static String center(String text) {
    final cleanText = _clean(text);
    if (cleanText.length >= PrintLayoutSpec.charsPerLine) {
      return cleanText.substring(0, PrintLayoutSpec.charsPerLine);
    }
    final leftPadding = (PrintLayoutSpec.charsPerLine - cleanText.length) ~/ 2;
    return '${' ' * leftPadding}$cleanText';
  }

  static String separator() => '-' * PrintLayoutSpec.charsPerLine;

  static List<String> wrap(String text,
      {int width = PrintLayoutSpec.charsPerLine}) {
    final cleanText = _clean(text);
    if (cleanText.isEmpty) return const [];
    final result = <String>[];
    var remaining = cleanText;

    while (remaining.length > width) {
      var splitAt = remaining.lastIndexOf(' ', width);
      if (splitAt <= 0) splitAt = width;
      result.add(remaining.substring(0, splitAt).trimRight());
      remaining = remaining.substring(splitAt).trimLeft();
    }

    if (remaining.isNotEmpty) result.add(remaining);
    return result;
  }

  static String _clean(String value) =>
      value.trim().replaceAll(RegExp(r'\s+'), ' ');
}
