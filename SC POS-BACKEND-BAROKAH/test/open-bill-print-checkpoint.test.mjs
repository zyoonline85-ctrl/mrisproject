import { beforeAll, describe, expect, it } from "vitest";

let api;

beforeAll(async () => {
  process.env.SEED_MODE = "demo";
  const module = await import("../src/services/admin-mock-api.js");
  api = module.default;
});

describe("open bill print checkpoints", () => {
  it("menerima open bill takeaway tanpa nomor meja", async () => {
    const data = api.getStaticData();
    const outlet = data.outlets.find((item) => item.status !== "inactive");
    const cashier = data.users.find((item) => item.status !== "inactive" && item.outlet_ids?.includes(outlet.id));
    const product = data.products.find((item) => item.status !== "inactive");
    const id = `test_bill_takeaway_${Date.now()}`;
    const baseItem = {
      productId: product.id,
      productName: product.name,
      categoryId: product.category_id,
      categoryName: "Test",
      quantity: 1,
      unitPrice: 10000,
      subtotal: 10000
    };

    try {
      const created = await api.upsertOpenBill({
        id,
        orderNumber: `ORDER-${id}`,
        outletId: outlet.id,
        cashierId: cashier.id,
        serviceType: "takeaway",
        tableNumber: null,
        items: [baseItem],
        total: 10000
      });

      expect(created.serviceType).toBe("takeaway");
      expect(created.tableNumber).toBeNull();
      expect(created.items).toHaveLength(1);
    } finally {
      await api.deleteOpenBill(id);
    }
  });

  it("mempertahankan checkpoint lama saat payload APK tidak mengirim field checkpoint", async () => {
    const data = api.getStaticData();
    const outlet = data.outlets.find((item) => item.status !== "inactive");
    const cashier = data.users.find((item) => item.status !== "inactive" && item.outlet_ids?.includes(outlet.id));
    const table = data.tables.find((item) => item.outlet_id === outlet.id && item.status !== "inactive");
    const variant = data.product_variants.find((item) => item.status === "active");
    const product = data.products.find((item) => item.id === variant.product_id);
    const id = `test_bill_checkpoint_${Date.now()}`;
    const baseItem = {
      productId: product.id,
      productName: product.name,
      categoryId: product.category_id,
      categoryName: "Test",
      quantity: 1,
      unitPrice: 10000,
      subtotal: 10000,
      selectedVariants: [{ id: variant.id, productId: product.id, name: variant.name }]
    };

    try {
      const created = await api.upsertOpenBill({
        id,
        orderNumber: `ORDER-${id}`,
        outletId: outlet.id,
        cashierId: cashier.id,
        tableNumber: table.number,
        items: [baseItem],
        total: 10000,
        customerPrintedItems: [baseItem],
        kitchenPrintedItems: [baseItem]
      });
      expect(created.customerPrintedItems[0].selectedVariants[0].id).toBe(variant.id);

      const { customerPrintedItems: _customerPrintedItems, kitchenPrintedItems: _kitchenPrintedItems, ...legacyPayload } = created;
      const updatedWithoutCheckpoint = await api.upsertOpenBill({
        ...legacyPayload,
        items: [{ ...baseItem, quantity: 2, subtotal: 20000 }],
        total: 20000
      });
      expect(updatedWithoutCheckpoint.items[0].quantity).toBe(2);
      expect(updatedWithoutCheckpoint.customerPrintedItems[0].quantity).toBe(1);
      expect(updatedWithoutCheckpoint.kitchenPrintedItems[0].quantity).toBe(1);

      const customerUpdated = await api.upsertOpenBill({
        ...updatedWithoutCheckpoint,
        customerPrintedItems: [{ ...baseItem, quantity: 2, subtotal: 20000 }]
      });
      expect(customerUpdated.customerPrintedItems[0].quantity).toBe(2);
      expect(customerUpdated.kitchenPrintedItems[0].quantity).toBe(1);

      const checkpointOnly = await api.updateOpenBillPrintCheckpoint(id, {
        template: "kitchen_order",
        items: [{ ...baseItem, quantity: 3, subtotal: 30000 }]
      });
      expect(checkpointOnly.items[0].quantity).toBe(2);
      expect(checkpointOnly.customerPrintedItems[0].quantity).toBe(2);
      expect(checkpointOnly.kitchenPrintedItems[0].quantity).toBe(3);
    } finally {
      await api.deleteOpenBill(id);
    }
  });
});
