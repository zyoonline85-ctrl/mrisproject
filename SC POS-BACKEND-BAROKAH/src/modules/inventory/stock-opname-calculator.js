function roundStockQuantity(value) {
  return Number(Number(value || 0).toFixed(3));
}

function stockOpnameItemStatus(difference) {
  const value = roundStockQuantity(difference);
  if (Math.abs(value) < 0.001) return "pas";
  return value > 0 ? "stock_hilang" : "tidak_sesuai_standar";
}

function calculateStockOpname({
  openingQuantity = 0,
  purchaseQuantity = 0,
  transferInQuantity = 0,
  transferOutQuantity = 0,
  salesQuantity = 0,
  damageQuantity = 0,
  actualQuantity = 0,
  unitPrice = 0
} = {}) {
  const opening = roundStockQuantity(openingQuantity);
  const purchase = roundStockQuantity(purchaseQuantity);
  const transferIn = roundStockQuantity(transferInQuantity);
  const transferOut = roundStockQuantity(transferOutQuantity);
  const sales = roundStockQuantity(salesQuantity);
  const damage = roundStockQuantity(damageQuantity);
  const actual = roundStockQuantity(actualQuantity);
  const incoming = roundStockQuantity(purchase + transferIn);
  const transferNet = roundStockQuantity(transferIn - transferOut);
  const system = roundStockQuantity(opening + purchase + transferIn - transferOut - sales - damage);
  const difference = roundStockQuantity(system - actual);
  const price = Number(unitPrice || 0);

  return {
    opening_quantity: opening,
    purchase_quantity: purchase,
    transfer_in_quantity: transferIn,
    incoming_quantity: incoming,
    transfer_quantity: transferNet,
    transfer_out_quantity: transferOut,
    computed_sales_quantity: sales,
    damage_quantity: damage,
    system_quantity: system,
    real_system_quantity: system,
    actual_quantity: actual,
    difference,
    status: stockOpnameItemStatus(difference),
    loss_amount: Math.max(difference, 0) * price
  };
}

module.exports = {
  calculateStockOpname,
  roundStockQuantity,
  stockOpnameItemStatus
};
