import 'package:intl/intl.dart';

final _currency =
    NumberFormat.currency(locale: 'id_ID', symbol: 'Rp ', decimalDigits: 0);
final _number = NumberFormat.decimalPattern('id_ID');
final _date = DateFormat('dd MMM yyyy', 'id_ID');
final _compactDate = DateFormat('yyyyMMdd');

String formatCurrency(num value) => _currency.format(value);
String formatAccountingCurrency(num value) {
  final sign = value < 0 ? '-' : '';
  return 'Rp. $sign${_number.format(value.abs())},00';
}

String formatAccountingPercent(num value) =>
    '${NumberFormat('0.00', 'id_ID').format(value)}%';
String formatNumber(num value) => _number.format(value);
String formatDate(DateTime value) => _date.format(value.toLocal());
String formatDateTime(DateTime value) =>
    '${formatDate(value)} ${formatClock(value)}';
String formatOrderDate(DateTime value) => _compactDate.format(value.toLocal());
String formatClock(DateTime value) =>
    DateFormat('HH:mm', 'id_ID').format(value.toLocal());
DateTime dateOnly(DateTime value) {
  final local = value.toLocal();
  return DateTime(local.year, local.month, local.day);
}

bool sameOrAfter(DateTime value, DateTime start) =>
    !dateOnly(value).isBefore(dateOnly(start));
bool sameOrBefore(DateTime value, DateTime end) =>
    !dateOnly(value).isAfter(dateOnly(end));
