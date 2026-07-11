import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  calculateMaterialDeltas,
  calculatePaymentCorrection,
  calculatePointCorrection,
  calculateTransactionCorrectionTotals
} = require("../src/modules/transactions/transaction-correction-calculator.js");

describe("transaction correction calculator", () => {
  it("menghitung ulang subtotal dan diskon dari snapshot aturan", () => {
    expect(calculateTransactionCorrectionTotals({
      items: [{ quantity: 3, unit_price: 20000 }],
      discountType: "percent",
      discountValue: 10,
      tax: 1000
    })).toEqual({ subtotal: 60000, discount: 6000, tax: 1000, total: 55000 });
  });

  it("menghasilkan delta pemakaian bahan untuk penambahan dan pengurangan", () => {
    const rows = calculateMaterialDeltas(
      [{ product_id: "ayam", quantity: 2 }],
      [{ product_id: "ayam", quantity: 1 }, { product_id: "nasi", quantity: 2 }],
      [
        { product_id: "ayam", material_id: "daging", quantity: 0.5 },
        { product_id: "nasi", material_id: "beras", quantity: 0.1 }
      ]
    );
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ material_id: "daging", deduction_delta: -0.5 }),
      expect.objectContaining({ material_id: "beras", deduction_delta: 0.2 })
    ]));
  });

  it("memvalidasi cash dan menyesuaikan noncash", () => {
    expect(() => calculatePaymentCorrection({ method: "cash", previousAmount: 40000, total: 50000 })).toThrow(/mencukupi/);
    expect(calculatePaymentCorrection({ method: "cash", submittedAmount: 60000, total: 50000 })).toEqual({ amount: 60000, change_amount: 10000 });
    expect(calculatePaymentCorrection({ method: "qris", previousAmount: 40000, total: 50000 })).toEqual({ amount: 50000, change_amount: 0 });
  });

  it("menghitung selisih poin dan mencegah saldo negatif", () => {
    expect(calculatePointCorrection({ total: 36000, previousEarned: 1, currentBalance: 5 })).toEqual({ earned: 3, delta: 2, next_balance: 7 });
    expect(calculatePointCorrection({ total: 0, previousEarned: 5, currentBalance: 2 }).next_balance).toBe(0);
  });
});
