int addCashShortcut(int currentAmount, int denomination) {
  final current = currentAmount < 0 ? 0 : currentAmount;
  final addition = denomination < 0 ? 0 : denomination;
  return current + addition;
}

int exactCashShortcut(int transactionTotal) =>
    transactionTotal < 0 ? 0 : transactionTotal;
