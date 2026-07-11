import { beforeAll, describe, expect, it } from "vitest";

let api;

beforeAll(async () => {
  process.env.SEED_MODE = "demo";
  const module = await import("../src/services/admin-mock-api.js");
  api = module.default;
});

describe("stock opname APK workflow", () => {
  it("filters the APK worksheet per outlet without changing the Admin worksheet", async () => {
    const bootstrap = await api.getBootstrap();
    const outlet = bootstrap.outlets.find((item) => item.status !== "inactive");
    const date = "2026-04-20";
    const adminWorksheet = await api.getStockOpnameWorksheet({ outletId: outlet.id, date });
    expect(adminWorksheet.rows.length).toBeGreaterThan(1);
    adminWorksheet.rows.forEach((row) => {
      expect(row.incoming_quantity).toBeCloseTo(row.purchase_quantity + row.transfer_in_quantity, 3);
      expect(row.real_system_quantity).toBeCloseTo(
        row.opening_quantity +
          row.purchase_quantity +
          row.transfer_in_quantity -
          row.transfer_out_quantity -
          row.computed_sales_quantity -
          row.damage_quantity,
        3
      );
    });

    const original = await api.getStockOpnameMaterialSelection({ outletId: outlet.id });
    const otherOutlet = bootstrap.outlets.find((item) => item.status !== "inactive" && item.id !== outlet.id);
    const otherOriginal = otherOutlet ? await api.getStockOpnameMaterialSelection({ outletId: otherOutlet.id }) : null;
    const selectedMaterialId = adminWorksheet.rows[0].material_id;
    try {
      await api.updateStockOpnameMaterialSelection(
        { outlet_id: outlet.id, material_ids: [] },
        bootstrap.users[0].id
      );
      expect((await api.getPosStockOpnameWorksheet({ outletId: outlet.id, date })).rows).toEqual([]);
      if (otherOutlet) {
        expect((await api.getStockOpnameMaterialSelection({ outletId: otherOutlet.id })).selected_material_ids)
          .toEqual(otherOriginal.selected_material_ids);
      }

      await api.updateStockOpnameMaterialSelection(
        { outlet_id: outlet.id, material_ids: [selectedMaterialId] },
        bootstrap.users[0].id
      );
      const apkWorksheet = await api.getPosStockOpnameWorksheet({ outletId: outlet.id, date });
      const unchangedAdminWorksheet = await api.getStockOpnameWorksheet({ outletId: outlet.id, date });

      expect(apkWorksheet.rows.map((row) => row.material_id)).toEqual([selectedMaterialId]);
      expect(unchangedAdminWorksheet.rows.length).toBe(adminWorksheet.rows.length);
    } finally {
      await api.updateStockOpnameMaterialSelection(
        { outlet_id: outlet.id, material_ids: original.selected_material_ids },
        bootstrap.users[0].id
      );
    }
  });

  it("allows only the requester to edit a pending request and keeps its identity", async () => {
    const bootstrap = await api.getBootstrap();
    const outlet = bootstrap.outlets.find((item) => item.status !== "inactive");
    const requester = bootstrap.users[0];
    const otherUser = bootstrap.users.find((user) => user.id !== requester.id);
    const date = "2026-04-20";
    const worksheet = await api.getPosStockOpnameWorksheet({ outletId: outlet.id, date });
    const row = worksheet.rows[0];
    const originalSelection = await api.getStockOpnameMaterialSelection({ outletId: outlet.id });
    const batchId = `test_edit_${Date.now()}`;
    let materialWasDeactivated = false;
    const created = await api.createPosStockOpnameRequest(
      {
        outlet_id: outlet.id,
        opname_date: date,
        batch_id: batchId,
        rows: [{ ...row, opening_quantity: 10, actual_quantity: 8 }]
      },
      requester.id
    );

    try {
      await expect(
        api.updatePosStockOpnameRequest(
          created.id,
          { outlet_id: outlet.id, opname_date: date, rows: [{ ...row, opening_quantity: 10, actual_quantity: 7 }] },
          otherUser.id
        )
      ).rejects.toMatchObject({ status: 403 });

      await api.updateStockOpnameMaterialSelection(
        { outlet_id: outlet.id, material_ids: originalSelection.selected_material_ids.filter((id) => id !== row.material_id) },
        bootstrap.users[0].id
      );
      await api.toggleMaterialStatus(row.material_id, bootstrap.users[0].id);
      materialWasDeactivated = true;
      const updated = await api.updatePosStockOpnameRequest(
        created.id,
        { outlet_id: outlet.id, opname_date: date, note: "Hasil hitung ulang", rows: [{ ...row, opening_quantity: 10, actual_quantity: 7 }] },
        requester.id
      );
      const matches = await api.getStockOpnameRequests({ outletId: outlet.id, from: date, to: date });

      expect(updated.id).toBe(created.id);
      expect(updated.batch_id).toBe(batchId);
      expect(updated.note).toBe("Hasil hitung ulang");
      expect(matches.filter((request) => request.id === created.id)).toHaveLength(1);

      await api.rejectStockOpnameRequest(created.id, { rejection_note: "Test selesai" });
      await expect(
        api.updatePosStockOpnameRequest(
          created.id,
          { outlet_id: outlet.id, opname_date: date, rows: [row] },
          requester.id
        )
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      if (materialWasDeactivated) await api.toggleMaterialStatus(row.material_id, bootstrap.users[0].id);
      await api.updateStockOpnameMaterialSelection(
        { outlet_id: outlet.id, material_ids: originalSelection.selected_material_ids },
        bootstrap.users[0].id
      );
    }
  });

  it("menghitung refund dan cancel hari yang sama sebagai penjualan bersih nol", async () => {
    const data = api.getStaticData();
    const composition = data.product_compositions.find((item) =>
      data.raw_material_stocks.some((stock) => stock.material_id === item.material_id)
    );
    const stock = data.raw_material_stocks.find((item) => item.material_id === composition.material_id);
    const outletId = stock.outlet_id;
    const date = "2026-04-20";
    const before = await api.getStockOpnameWorksheet({ outletId, date });
    const beforeRow = before.rows.find((row) => row.material_id === composition.material_id);
    const transactionIds = [`test_refund_${Date.now()}`, `test_cancel_${Date.now()}`];

    try {
      data.transactions.push(
        {
          id: transactionIds[0],
          outlet_id: outletId,
          status: "refunded",
          stock_deducted: true,
          transaction_date: `${date}T10:00:00.000Z`
        },
        {
          id: transactionIds[1],
          outlet_id: outletId,
          status: "cancelled",
          stock_deducted: true,
          stock_cancelled: true,
          transaction_date: `${date}T11:00:00.000Z`,
          stock_cancelled_at: `${date}T11:05:00.000Z`
        }
      );
      data.transaction_items.push(
        { id: `${transactionIds[0]}_item`, transaction_id: transactionIds[0], product_id: composition.product_id, quantity: 2 },
        { id: `${transactionIds[1]}_item`, transaction_id: transactionIds[1], product_id: composition.product_id, quantity: 3 }
      );
      data.transaction_refunds.push({
        id: `${transactionIds[0]}_refund`,
        transaction_id: transactionIds[0],
        outlet_id: outletId,
        status: "active",
        refunded_at: `${date}T10:05:00.000Z`
      });

      const after = await api.getStockOpnameWorksheet({ outletId, date });
      const afterRow = after.rows.find((row) => row.material_id === composition.material_id);
      expect(afterRow.computed_sales_quantity).toBeCloseTo(beforeRow.computed_sales_quantity, 3);
    } finally {
      data.transactions = data.transactions.filter((item) => !transactionIds.includes(item.id));
      data.transaction_items = data.transaction_items.filter((item) => !transactionIds.includes(item.transaction_id));
      data.transaction_refunds = data.transaction_refunds.filter((item) => item.transaction_id !== transactionIds[0]);
    }
  });
});
