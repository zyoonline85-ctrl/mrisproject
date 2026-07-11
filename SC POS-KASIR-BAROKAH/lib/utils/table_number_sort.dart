final _naturalTableTokenPattern = RegExp(r'\d+|\D+');
final _numericTokenPattern = RegExp(r'^\d+$');

List<String> _tableNumberTokens(String value) {
  return _naturalTableTokenPattern
      .allMatches(value.trim())
      .map((match) => match.group(0) ?? '')
      .where((token) => token.isNotEmpty)
      .toList();
}

int _compareNumericTokens(String left, String right) {
  final normalizedLeft = left.replaceFirst(RegExp(r'^0+'), '');
  final normalizedRight = right.replaceFirst(RegExp(r'^0+'), '');
  final safeLeft = normalizedLeft.isEmpty ? '0' : normalizedLeft;
  final safeRight = normalizedRight.isEmpty ? '0' : normalizedRight;

  final byLength = safeLeft.length.compareTo(safeRight.length);
  if (byLength != 0) return byLength;

  final byValue = safeLeft.compareTo(safeRight);
  if (byValue != 0) return byValue;

  return left.length.compareTo(right.length);
}

int compareTableNumbers(String left, String right) {
  final leftTokens = _tableNumberTokens(left);
  final rightTokens = _tableNumberTokens(right);
  final maxLength = leftTokens.length > rightTokens.length
      ? leftTokens.length
      : rightTokens.length;

  for (var index = 0; index < maxLength; index += 1) {
    if (index >= leftTokens.length) return -1;
    if (index >= rightTokens.length) return 1;

    final leftToken = leftTokens[index];
    final rightToken = rightTokens[index];
    final leftIsNumeric = _numericTokenPattern.hasMatch(leftToken);
    final rightIsNumeric = _numericTokenPattern.hasMatch(rightToken);

    final comparison = leftIsNumeric && rightIsNumeric
        ? _compareNumericTokens(leftToken, rightToken)
        : leftToken.toLowerCase().compareTo(rightToken.toLowerCase());

    if (comparison != 0) return comparison;
  }

  return left.compareTo(right);
}
