import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { calculateStockOpname } = require("../src/modules/inventory/stock-opname-calculator");

describe("stock opname calculator", () => {
  it("menghitung pembelian, transfer, penjualan, dan rusak secara terpisah", () => {
    const result = calculateStockOpname({
      openingQuantity: 21,
      purchaseQuantity: 1,
      transferInQuantity: 2,
      transferOutQuantity: 3,
      salesQuantity: 4,
      damageQuantity: 1,
      actualQuantity: 15,
      unitPrice: 20000
    });

    expect(result.system_quantity).toBe(16);
    expect(result.difference).toBe(1);
    expect(result.loss_amount).toBe(20000);
    expect(result.status).toBe("stock_hilang");
    expect(result.incoming_quantity).toBe(3);
    expect(result.transfer_quantity).toBe(-1);
  });

  it("penjualan negatif dari refund menambah kembali sisa sistem", () => {
    const result = calculateStockOpname({
      openingQuantity: 10,
      salesQuantity: -2,
      actualQuantity: 12
    });

    expect(result.system_quantity).toBe(12);
    expect(result.difference).toBe(0);
    expect(result.status).toBe("pas");
  });
});
