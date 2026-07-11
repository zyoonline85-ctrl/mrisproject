import 'package:flutter/services.dart';

import 'formatters.dart';

class ThousandsInputFormatter extends TextInputFormatter {
  const ThousandsInputFormatter();

  @override
  TextEditingValue formatEditUpdate(
      TextEditingValue oldValue, TextEditingValue newValue) {
    final digits = onlyDigits(newValue.text);
    if (digits.isEmpty) return const TextEditingValue();

    final value = int.tryParse(digits) ?? 0;
    final text = formatNumber(value);
    return TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: text.length),
    );
  }
}

String onlyDigits(String value) => value.replaceAll(RegExp(r'[^0-9]'), '');

int parseThousandsInput(String value) => int.tryParse(onlyDigits(value)) ?? 0;
