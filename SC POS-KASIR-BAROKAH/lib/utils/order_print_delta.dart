import '../models/app_models.dart';

class OrderPrintDelta {
  const OrderPrintDelta({required this.added, required this.removed});

  final List<TransactionItem> added;
  final List<TransactionItem> removed;

  bool get isEmpty => added.isEmpty && removed.isEmpty;
}

String orderPrintItemKey(TransactionItem item) {
  final variants = item.selectedVariants
      .map((variant) => variant.id.isNotEmpty ? variant.id : variant.name)
      .toList()
    ..sort();
  return '${item.productId}|${item.unitPrice}|${variants.join(',')}';
}

TransactionItem _withQuantity(TransactionItem item, int quantity) =>
    TransactionItem(
      productId: item.productId,
      productName: item.productName,
      categoryId: item.categoryId,
      categoryName: item.categoryName,
      categorySortOrder: item.categorySortOrder,
      quantity: quantity,
      unitPrice: item.unitPrice,
      subtotal: quantity * item.unitPrice,
      selectedVariants: item.selectedVariants,
    );

Map<String, TransactionItem> _aggregate(List<TransactionItem> items) {
  final result = <String, TransactionItem>{};
  for (final item in items) {
    final key = orderPrintItemKey(item);
    final current = result[key];
    result[key] = _withQuantity(item, (current?.quantity ?? 0) + item.quantity);
  }
  return result;
}

OrderPrintDelta calculateOrderPrintDelta({
  required List<TransactionItem> current,
  required List<TransactionItem> checkpoint,
}) {
  final currentByKey = _aggregate(current);
  final checkpointByKey = _aggregate(checkpoint);
  final keys = {...currentByKey.keys, ...checkpointByKey.keys};
  final added = <TransactionItem>[];
  final removed = <TransactionItem>[];

  for (final key in keys) {
    final currentItem = currentByKey[key];
    final checkpointItem = checkpointByKey[key];
    final difference =
        (currentItem?.quantity ?? 0) - (checkpointItem?.quantity ?? 0);
    if (difference > 0 && currentItem != null) {
      added.add(_withQuantity(currentItem, difference));
    } else if (difference < 0 && checkpointItem != null) {
      removed.add(_withQuantity(checkpointItem, difference.abs()));
    }
  }

  return OrderPrintDelta(added: added, removed: removed);
}

List<TransactionItem> applyPrintedItems({
  required List<TransactionItem> checkpoint,
  required List<TransactionItem> printed,
  required bool removal,
}) {
  final result = _aggregate(checkpoint);
  for (final item in printed) {
    final key = orderPrintItemKey(item);
    final current = result[key];
    final nextQuantity =
        (current?.quantity ?? 0) + (removal ? -item.quantity : item.quantity);
    if (nextQuantity <= 0) {
      result.remove(key);
    } else {
      result[key] = _withQuantity(current ?? item, nextQuantity);
    }
  }
  return result.values.toList();
}
