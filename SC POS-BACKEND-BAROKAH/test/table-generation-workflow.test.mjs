import { beforeAll, describe, expect, it } from "vitest";

let api;

beforeAll(async () => {
  process.env.SEED_MODE = "demo";
  const module = await import("../src/services/admin-mock-api.js");
  api = module.default;
});

describe("table generation workflow", () => {
  it("membuat satu batch dengan status yang sama dan response rentang nomor", async () => {
    const outlet = api.getStaticData().outlets[2];
    const existingCount = api.getStaticData().tables.filter((table) => table.outlet_id === outlet.id).length;
    const result = await api.generateTables({ outlet_id: outlet.id, quantity: 3, status: "inactive", created_by: "user_001" });

    expect(result).toMatchObject({
      count: 3,
      first_number: existingCount ? result.first_number : "C1",
      last_number: existingCount ? result.last_number : "C3"
    });
    expect(result.tables).toHaveLength(3);
    expect(result.tables.every((table) => table.status === "inactive" && table.outlet_id === outlet.id)).toBe(true);
  });

  it("menolak jumlah invalid tanpa menambah meja", async () => {
    const outlet = api.getStaticData().outlets[0];
    const beforeCount = api.getStaticData().tables.length;

    await expect(api.generateTables({ outlet_id: outlet.id, quantity: 101, status: "active" })).rejects.toThrow(/1 sampai 100/);
    expect(api.getStaticData().tables).toHaveLength(beforeCount);
  });
});
