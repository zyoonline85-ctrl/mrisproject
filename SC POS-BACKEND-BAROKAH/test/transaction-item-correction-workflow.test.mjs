import { beforeAll, describe, expect, it } from "vitest";

let api;

beforeAll(async () => {
  process.env.SEED_MODE = "demo";
  process.env.PERSIST_MOCK_DATA = "false";
  const module = await import("../src/services/admin-mock-api.js");
  api = module.default;
});

function setupTransaction(status = "paid") {
  const data = api.getStaticData();
  const composition = data.product_compositions.find((row) => Number(row.quantity || 0) > 0);
  const product = data.products.find((row) => row.id === composition.product_id);
  const price = data.product_prices.find((row) => row.product_id === product.id && row.status === "active" && Number(row.price || 0) > 0);
  const customer = data.customers.find((row) => row.outlet_id === price.outlet_id);
  const cashier = data.users.find((row) => row.status !== "inactive");
  const material = data.raw_materials.find((row) => row.id === composition.material_id);
  let stock = data.raw_material_stocks.find((row) => row.outlet_id === price.outlet_id && row.material_id === material.id);
  if (!stock) {
    stock = { id: `test_stock_${Date.now()}`, outlet_id: price.outlet_id, material_id: material.id, quantity: 100, unit: material.unit, last_purchase_price: 1000, stock_value: 100000 };
    data.raw_material_stocks.push(stock);
  }
  const id = `test_correction_${status}_${Date.now()}`;
  const now = new Date().toISOString();
  const transaction = {
    id,
    order_number: `ORDER-${id}`,
    outlet_id: price.outlet_id,
    cashier_id: cashier.id,
    customer_id: customer?.id || null,
    service_type: "takeaway",
    transaction_date: now,
    updated_at: now,
    subtotal: Number(price.price),
    discount: 0,
    discount_type: null,
    discount_value: 0,
    tax: 0,
    total: Number(price.price),
    status,
    customer_points_before: customer?.points || 0,
    customer_points_earned: customer ? Math.floor(Number(price.price) / 10000) : 0,
    customer_points_after: customer ? Number(customer.points || 0) + Math.floor(Number(price.price) / 10000) : 0,
    stock_deducted: true
  };
  const item = { id: `${id}_item`, transaction_id: id, product_id: product.id, quantity: 1, unit_price: Number(price.price), subtotal: Number(price.price), metadata_json: {} };
  const payment = { id: `${id}_payment`, transaction_id: id, method: "cash", amount: Number(price.price) * 3, change_amount: Number(price.price) * 2, status: "paid" };
  data.transactions.push(transaction);
  data.transaction_items.push(item);
  data.payments.push(payment);
  return { data, transaction, item, payment, stock, customer, composition };
}

function cleanup(context) {
  const { data, transaction, item, payment } = context;
  data.transactions = data.transactions.filter((row) => row.id !== transaction.id);
  data.transaction_items = data.transaction_items.filter((row) => row.transaction_id !== transaction.id);
  data.payments = data.payments.filter((row) => row.id !== payment.id);
  data.activity_logs = data.activity_logs.filter((row) => row.entity_id !== transaction.id);
}

describe("transaction item correction workflow", () => {
  it("mengoreksi paid beserta stok, payment, poin, dan audit", async () => {
    const context = setupTransaction("paid");
    const stockBefore = Number(context.stock.quantity);
    const pointsBefore = Number(context.customer?.points || 0);
    try {
      const result = await api.correctTransactionItems(context.transaction.id, {
        reason: "Qty kasir salah",
        expected_status: "paid",
        expected_updated_at: context.transaction.updated_at,
        items: [{ id: context.item.id, quantity: 2 }],
        paid_amount: context.payment.amount,
        updated_by: context.transaction.cashier_id
      });
      expect(result.items[0].quantity).toBe(2);
      expect(context.stock.quantity).toBeCloseTo(stockBefore - Number(context.composition.quantity), 3);
      expect(context.payment.change_amount).toBe(context.payment.amount - result.total);
      if (context.customer) {
        const expectedDelta = Math.floor(result.total / 10000) - Math.floor(context.item.unit_price / 10000);
        expect(context.customer.points).toBe(Math.max(0, pointsBefore + expectedDelta));
      }
      expect(context.data.activity_logs.some((row) => row.entity_id === context.transaction.id && row.action === "update_items")).toBe(true);
    } finally {
      cleanup(context);
      context.stock.quantity = stockBefore;
      if (context.customer) context.customer.points = pointsBefore;
    }
  });


  it("mengoreksi diskon manual persen tanpa mengubah item", async () => {
    const context = setupTransaction("paid");
    const pointsBefore = Number(context.customer?.points || 0);
    try {
      const result = await api.correctTransactionItems(context.transaction.id, {
        reason: "Diskon manual belum terinput",
        expected_status: "paid",
        expected_updated_at: context.transaction.updated_at,
        items: [{ id: context.item.id, quantity: 1 }],
        discount_type: "percent",
        discount_value: 10,
        paid_amount: context.payment.amount,
        updated_by: context.transaction.cashier_id
      });
      const expectedDiscount = Math.round(Number(context.item.subtotal) * 0.1);
      expect(result.discount).toBe(expectedDiscount);
      expect(result.discount_type).toBe("percent");
      expect(result.discount_value).toBe(10);
      expect(result.discount_name).toBe("Diskon Manual");
      expect(result.total).toBe(Number(context.item.subtotal) - expectedDiscount);
      expect(context.payment.change_amount).toBe(context.payment.amount - result.total);
      if (context.customer) {
        const expectedDelta = Math.floor(result.total / 10000) - Math.floor(context.item.subtotal / 10000);
        expect(context.customer.points).toBe(Math.max(0, pointsBefore + expectedDelta));
      }
    } finally {
      cleanup(context);
      if (context.customer) context.customer.points = pointsBefore;
    }
  });

  it("menghapus diskon lama saat koreksi diskon diset tanpa diskon", async () => {
    const context = setupTransaction("paid");
    context.transaction.discount = 5000;
    context.transaction.discount_type = "nominal";
    context.transaction.discount_value = 5000;
    context.transaction.discount_name = "Diskon Manual";
    context.transaction.total = Number(context.transaction.subtotal) - 5000;
    context.payment.amount = Number(context.transaction.subtotal);
    context.payment.change_amount = 5000;
    try {
      const result = await api.correctTransactionItems(context.transaction.id, {
        reason: "Diskon dibatalkan",
        expected_status: "paid",
        expected_updated_at: context.transaction.updated_at,
        items: [{ id: context.item.id, quantity: 1 }],
        discount_type: null,
        discount_value: 0,
        paid_amount: context.payment.amount,
        updated_by: context.transaction.cashier_id
      });
      expect(result.discount).toBe(0);
      expect(result.discount_type).toBeNull();
      expect(result.discount_value).toBe(0);
      expect(result.discount_name).toBeNull();
      expect(result.total).toBe(Number(context.transaction.subtotal));
      expect(context.payment.change_amount).toBe(0);
    } finally {
      cleanup(context);
    }
  });

  it("mengoreksi cancelled sebagai data tanpa side effect", async () => {
    const context = setupTransaction("cancelled");
    const stockBefore = Number(context.stock.quantity);
    const pointsBefore = Number(context.customer?.points || 0);
    const paymentBefore = structuredClone(context.payment);
    try {
      const result = await api.correctTransactionItems(context.transaction.id, {
        reason: "Dokumentasi item",
        expected_status: "cancelled",
        expected_updated_at: context.transaction.updated_at,
        items: [{ id: context.item.id, quantity: 3 }],
        updated_by: context.transaction.cashier_id
      });
      expect(result.items[0].quantity).toBe(3);
      expect(context.stock.quantity).toBe(stockBefore);
      expect(context.payment.amount).toBe(paymentBefore.amount);
      expect(context.payment.change_amount).toBe(paymentBefore.change_amount);
      if (context.customer) expect(context.customer.points).toBe(pointsBefore);
    } finally {
      cleanup(context);
    }
  });
});
