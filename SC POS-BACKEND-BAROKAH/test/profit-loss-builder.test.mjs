import { describe, expect, it } from "vitest";
import profitLossBuilder from "../src/modules/reports/profit-loss-builder.js";

const { buildSimpleAccountingProfitLoss } = profitLossBuilder;

function rowByDescription(report, description) {
  return report.rows.find((row) => row.description === description);
}

describe("profit loss builder", () => {
  it("uses Total Income as the percentage base for every numeric group", () => {
    const report = buildSimpleAccountingProfitLoss({
      rows: [{ total: 90, discount: 10 }],
      approvedPurchases: [{ items: [{ subtotal: 45, material_type: "hpp" }] }],
      approvedExpenses: [{ amount: 9 }],
      from: "2026-06-01",
      to: "2026-06-30",
      outletId: "outlet-1"
    });

    expect(rowByDescription(report, "Pendapatan Usaha")).toMatchObject({ total: 100, percent_of_income: 111.11 });
    expect(rowByDescription(report, "Diskon Penjualan")).toMatchObject({ total: -10, percent_of_income: -11.11 });
    expect(rowByDescription(report, "Total Income")).toMatchObject({ total: 90, percent_of_income: 100 });
    expect(rowByDescription(report, "Harga Pokok Penjualan")).toMatchObject({ total: 45, percent_of_income: 50 });
    expect(rowByDescription(report, "Biaya / Expense")).toMatchObject({ total: 9, percent_of_income: 10 });
    expect(rowByDescription(report, "NET INCOME")).toMatchObject({ total: 36, percent_of_income: 40 });
    expect(report.rows.every((row) => !("percent" in row))).toBe(true);
  });

  it("returns zero percentages when Total Income is zero", () => {
    const report = buildSimpleAccountingProfitLoss({
      rows: [],
      approvedPurchases: [{ items: [{ subtotal: 45, material_type: "hpp" }] }],
      approvedExpenses: [{ amount: 9 }]
    });

    expect(report.rows.every((row) => row.percent_of_income === 0)).toBe(true);
    expect(rowByDescription(report, "NET INCOME").total).toBe(-54);
  });

  it("includes POS payment method rows under business income", () => {
    const report = buildSimpleAccountingProfitLoss({
      rows: [{ total: 90, discount: 0 }],
      paymentMethods: [
        { code: "cash", name: "Cash" },
        { code: "qris", name: "QRIS" }
      ],
      paymentTotals: { cash: 40, qris: 50 }
    });

    const incomeIndex = report.rows.findIndex((row) => row.description === "Pendapatan Usaha");
    expect(report.rows.slice(incomeIndex + 1, incomeIndex + 3)).toMatchObject([
      { description: "Cash", total: 40, level: 2, kind: "payment_method", payment_method_code: "cash" },
      { description: "QRIS", total: 50, level: 2, kind: "payment_method", payment_method_code: "qris" }
    ]);
  });
});
