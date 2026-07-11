function roundQuantity(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function calculateTransactionCorrectionTotals({
  items = [],
  discountType = null,
  discountValue = 0,
  fallbackDiscount = 0,
  tax = 0
} = {}) {
  const subtotal = items.reduce(
    (sum, item) => sum + Math.max(0, Math.round(Number(item.unit_price || item.unitPrice || 0))) * Math.max(0, Math.round(Number(item.quantity || 0))),
    0
  );
  const type = String(discountType || "").toLowerCase();
  const value = Math.max(0, Number(discountValue || 0));
  let discount;
  if (type === "percent") {
    discount = Math.round((subtotal * Math.min(value, 100)) / 100);
  } else if (type === "nominal") {
    discount = Math.round(value);
  } else {
    discount = Math.max(0, Math.round(Number(fallbackDiscount || 0)));
  }
  discount = Math.min(subtotal, discount);
  const safeTax = Math.max(0, Math.round(Number(tax || 0)));
  return {
    subtotal,
    discount,
    tax: safeTax,
    total: Math.max(0, subtotal - discount + safeTax)
  };
}

function calculateMaterialUsage(items = [], compositions = []) {
  const usage = new Map();
  for (const item of items) {
    for (const composition of compositions) {
      if (composition.product_id !== item.product_id) continue;
      const quantity = roundQuantity(Number(item.quantity || 0) * Number(composition.quantity || 0));
      usage.set(composition.material_id, roundQuantity((usage.get(composition.material_id) || 0) + quantity));
    }
  }
  return usage;
}

function calculateMaterialDeltas(oldItems = [], newItems = [], compositions = []) {
  const oldUsage = calculateMaterialUsage(oldItems, compositions);
  const newUsage = calculateMaterialUsage(newItems, compositions);
  const materialIds = new Set([...oldUsage.keys(), ...newUsage.keys()]);
  return [...materialIds]
    .map((materialId) => ({
      material_id: materialId,
      old_quantity: oldUsage.get(materialId) || 0,
      new_quantity: newUsage.get(materialId) || 0,
      deduction_delta: roundQuantity((newUsage.get(materialId) || 0) - (oldUsage.get(materialId) || 0))
    }))
    .filter((row) => row.deduction_delta !== 0);
}

function calculatePaymentCorrection({ method, previousAmount = 0, submittedAmount, total = 0 } = {}) {
  const normalizedMethod = String(method || "").toLowerCase();
  const safeTotal = Math.max(0, Math.round(Number(total || 0)));
  if (normalizedMethod !== "cash") {
    return { amount: safeTotal, change_amount: 0 };
  }
  const amount = submittedAmount == null
    ? Math.max(0, Math.round(Number(previousAmount || 0)))
    : Math.max(0, Math.round(Number(submittedAmount || 0)));
  if (amount < safeTotal) {
    const error = new Error("Nominal pembayaran cash setelah koreksi wajib mencukupi total transaksi.");
    error.code = "PAYMENT_SHORTFALL";
    throw error;
  }
  return { amount, change_amount: amount - safeTotal };
}

function calculatePointCorrection({ total = 0, previousEarned = 0, currentBalance = 0 } = {}) {
  const earned = Math.floor(Math.max(0, Number(total || 0)) / 10000);
  const delta = earned - Math.max(0, Math.round(Number(previousEarned || 0)));
  return {
    earned,
    delta,
    next_balance: Math.max(0, Math.round(Number(currentBalance || 0)) + delta)
  };
}

module.exports = {
  calculateMaterialDeltas,
  calculateMaterialUsage,
  calculatePaymentCorrection,
  calculatePointCorrection,
  calculateTransactionCorrectionTotals
};
