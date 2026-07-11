import { beforeAll, describe, expect, it } from "vitest";

let api;

beforeAll(async () => {
  process.env.SEED_MODE = "demo";
  const module = await import("../src/services/admin-mock-api.js");
  api = module.default;
});

describe("dynamic roles and APK permissions", () => {
  it("membuat role custom dan menormalkan action APK agar selalu memiliki view", async () => {
    const role = await api.createRole({
      name: `Supervisor Test ${Date.now()}`,
      description: "Role gabungan Admin dan APK"
    });

    const updated = await api.updateRolePermissions(role.id, {
      dashboard: ["view"],
      "apk.purchases": ["create"]
    });

    expect(updated.permissions.dashboard).toEqual(["view"]);
    expect(updated.permissions["apk.purchases"]).toEqual(["view", "create"]);

    const deleted = await api.deleteRole(role.id);
    expect(deleted).toEqual({ id: role.id, deleted: true });
  });

  it("mewajibkan PIN untuk user role APK dan memblokir hapus role yang dipakai", async () => {
    const role = await api.createRole({ name: `Kasir Custom ${Date.now()}` });
    await api.updateRolePermissions(role.id, { "apk.sales": ["view", "create"] });
    const outlet = api.getStaticData().outlets.find((item) => item.status === "active");

    await expect(
      api.createUser({
        name: "Kasir Tanpa PIN",
        username: `no.pin.${Date.now()}`,
        email: `no.pin.${Date.now()}@barokah.test`,
        role_id: role.id,
        outlet_ids: [outlet.id],
        status: "active"
      })
    ).rejects.toThrow("PIN kasir wajib diisi 6 digit");

    const suffix = Date.now();
    const user = await api.createUser({
      name: "Kasir Role Custom",
      username: `custom.cashier.${suffix}`,
      email: `custom.cashier.${suffix}@barokah.test`,
      role_id: role.id,
      outlet_ids: [outlet.id],
      cashier_pin: "123456",
      status: "active"
    });
    expect(user.has_pin).toBe(true);
    await expect(api.deleteRole(role.id)).rejects.toMatchObject({ status: 409, code: "ROLE_IN_USE" });
  });

  it("menjadikan role Cashier bawaan khusus APK", () => {
    const cashierRole = api.getStaticData().roles.find((role) => role.id === "role_cashier");
    expect(cashierRole.permissions["apk.sales"]).toContain("view");
    expect(cashierRole.permissions.dashboard).toBeUndefined();
  });
});

