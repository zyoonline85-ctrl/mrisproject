function roundQuantity(value) {
  return Number(Number(value || 0).toFixed(3));
}

function dateOnly(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function movementKey(outletId, date, materialId) {
  return `${outletId}:${date}:${materialId}`;
}

exports.up = async function up(knex) {
  const opnameRows = await knex("stock_opnames")
    .whereIn("status", ["pending", "approved"])
    .select(
      "id",
      "outlet_id",
      "material_id",
      "opname_date",
      "opening_quantity",
      "incoming_quantity",
      "transfer_out_quantity",
      "damage_quantity",
      "actual_quantity",
      "unit_price"
    );
  if (!opnameRows.length) return;

  const transactions = await knex("transactions")
    .where("stock_deducted", true)
    .select(
      "id",
      "outlet_id",
      "transaction_date",
      "operational_at",
      "stock_cancelled",
      "stock_cancelled_at",
      "cancelled_at"
    );
  const transactionIds = transactions.map((transaction) => transaction.id);
  const transactionItems = transactionIds.length
    ? await knex("transaction_items").whereIn("transaction_id", transactionIds).select("transaction_id", "product_id", "quantity")
    : [];
  const productIds = [...new Set(transactionItems.map((item) => item.product_id).filter(Boolean))];
  const compositions = productIds.length
    ? await knex("product_compositions").whereIn("product_id", productIds).select("product_id", "material_id", "quantity")
    : [];
  const refunds = transactionIds.length
    ? await knex("transaction_refunds")
        .whereIn("transaction_id", transactionIds)
        .whereNot("status", "cancelled")
        .select("transaction_id", "refunded_at")
    : [];
  const [purchases, transfers] = await Promise.all([
    knex("purchases as purchases")
      .join("purchase_items as items", "items.purchase_id", "purchases.id")
      .where("purchases.status", "approved")
      .select("purchases.outlet_id", "purchases.purchase_date", "items.material_id", "items.quantity"),
    knex("stock_transfers as transfers")
      .join("stock_transfer_items as items", "items.transfer_id", "transfers.id")
      .where("transfers.status", "approved")
      .select(
        "transfers.from_outlet_id",
        "transfers.to_outlet_id",
        "transfers.transfer_date",
        "items.material_id",
        "items.quantity"
      )
  ]);

  const itemsByTransaction = transactionItems.reduce((result, item) => {
    result.set(item.transaction_id, [...(result.get(item.transaction_id) || []), item]);
    return result;
  }, new Map());
  const compositionsByProduct = compositions.reduce((result, composition) => {
    result.set(composition.product_id, [...(result.get(composition.product_id) || []), composition]);
    return result;
  }, new Map());
  const transactionById = new Map(transactions.map((transaction) => [transaction.id, transaction]));
  const salesByMovement = new Map();
  const purchasesByMovement = new Map();
  const transferInByMovement = new Map();
  const transferOutByMovement = new Map();

  function addMovement(target, key, quantity) {
    target.set(key, roundQuantity((target.get(key) || 0) + Number(quantity || 0)));
  }

  function addTransactionMovement(transaction, date, sign) {
    if (!date) return;
    (itemsByTransaction.get(transaction.id) || []).forEach((item) => {
      (compositionsByProduct.get(item.product_id) || []).forEach((composition) => {
        const key = movementKey(transaction.outlet_id, date, composition.material_id);
        const quantity = Number(sign || 0) * Number(item.quantity || 0) * Number(composition.quantity || 0);
        salesByMovement.set(key, roundQuantity((salesByMovement.get(key) || 0) + quantity));
      });
    });
  }

  transactions.forEach((transaction) => {
    addTransactionMovement(transaction, dateOnly(transaction.operational_at || transaction.transaction_date), 1);
    if (transaction.stock_cancelled) {
      addTransactionMovement(transaction, dateOnly(transaction.stock_cancelled_at || transaction.cancelled_at), -1);
    }
  });
  refunds.forEach((refund) => {
    const transaction = transactionById.get(refund.transaction_id);
    if (transaction) addTransactionMovement(transaction, dateOnly(refund.refunded_at), -1);
  });
  purchases.forEach((purchase) => {
    addMovement(
      purchasesByMovement,
      movementKey(purchase.outlet_id, dateOnly(purchase.purchase_date), purchase.material_id),
      purchase.quantity
    );
  });
  transfers.forEach((transfer) => {
    const date = dateOnly(transfer.transfer_date);
    addMovement(
      transferInByMovement,
      movementKey(transfer.to_outlet_id, date, transfer.material_id),
      transfer.quantity
    );
    addMovement(
      transferOutByMovement,
      movementKey(transfer.from_outlet_id, date, transfer.material_id),
      transfer.quantity
    );
  });

  for (const row of opnameRows) {
    const key = movementKey(row.outlet_id, dateOnly(row.opname_date), row.material_id);
    const purchaseQuantity = roundQuantity(purchasesByMovement.get(key) || 0);
    const transferInQuantity = roundQuantity(transferInByMovement.get(key) || 0);
    const transferOutQuantity = roundQuantity(transferOutByMovement.get(key) || 0);
    const incomingQuantity = roundQuantity(purchaseQuantity + transferInQuantity);
    const transferQuantity = roundQuantity(transferInQuantity - transferOutQuantity);
    const salesQuantity = roundQuantity(salesByMovement.get(key) || 0);
    const systemQuantity = roundQuantity(
      Number(row.opening_quantity || 0) +
        purchaseQuantity +
        transferInQuantity -
        transferOutQuantity -
        salesQuantity -
        Number(row.damage_quantity || 0)
    );
    const difference = roundQuantity(systemQuantity - Number(row.actual_quantity || 0));
    const lossAmount = Math.round(Math.max(difference, 0) * Number(row.unit_price || 0));

    await knex("stock_opnames").where({ id: row.id }).update({
      incoming_quantity: incomingQuantity,
      transfer_quantity: transferQuantity,
      transfer_out_quantity: transferOutQuantity,
      computed_sales_quantity: salesQuantity,
      system_quantity: systemQuantity,
      difference,
      loss_amount: lossAmount
    });
  }
};

exports.down = async function down() {
  // Data correction is intentionally not reversed because the previous values were incomplete.
};
