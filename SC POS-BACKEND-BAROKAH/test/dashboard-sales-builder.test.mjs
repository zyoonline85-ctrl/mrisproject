import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { buildDashboardSalesByOutlet } = require("../src/modules/dashboard/dashboard-sales-builder.js");

describe("dashboard sales by outlet builder", () => {
  const outlets = [
    { id: "outlet_a", name: "Resto A", status: "active" },
    { id: "outlet_b", name: "Resto B", status: "active" },
    { id: "outlet_c", name: "Resto C", status: "active" },
    { id: "outlet_d", name: "Resto Nonaktif", status: "inactive" }
  ];

  it("mengurutkan omzet, menghitung kontribusi, transaksi, dan rata-rata", () => {
    const rows = buildDashboardSalesByOutlet({
      outlets,
      transactions: [
        { outlet_id: "outlet_a", total: 100000, status: "paid" },
        { outlet_id: "outlet_a", total: 50000, status: "paid" },
        { outlet_id: "outlet_b", total: 50000, status: "paid" },
        { outlet_id: "outlet_b", total: 999999, status: "cancelled" }
      ]
    });

    expect(rows.map((row) => row.outlet_id)).toEqual(["outlet_a", "outlet_b", "outlet_c"]);
    expect(rows[0]).toMatchObject({
      total: 150000,
      transaction_count: 2,
      average_transaction: 75000,
      percentage: 75,
      rank: 1
    });
    expect(rows[1]).toMatchObject({ total: 50000, transaction_count: 1, percentage: 25, rank: 2 });
    expect(rows[2]).toMatchObject({ total: 0, transaction_count: 0, percentage: 0, rank: 3 });
  });

  it("mengembalikan persentase nol saat belum ada omzet", () => {
    const rows = buildDashboardSalesByOutlet({ outlets, transactions: [] });
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.total === 0 && row.percentage === 0)).toBe(true);
  });
});
