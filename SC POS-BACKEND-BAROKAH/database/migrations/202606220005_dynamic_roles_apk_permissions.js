const apkPermissions = [
  { key: "apk.sales", group: "apk", label: "Kasir / Penjualan", route: "apk://kasir", actions: ["view", "create", "update", "cancel", "print"] },
  { key: "apk.history", group: "apk", label: "Riwayat Transaksi", route: "apk://riwayat", actions: ["view", "print"] },
  { key: "apk.purchases", group: "apk", label: "Pembelian", route: "apk://pembelian", actions: ["view", "create", "update"] },
  { key: "apk.transfers", group: "apk", label: "Transfer", route: "apk://transfer", actions: ["view", "create"] },
  { key: "apk.opnames", group: "apk", label: "Stock Opname", route: "apk://opname", actions: ["view", "create", "update"] },
  { key: "apk.expenses", group: "apk", label: "Pengeluaran", route: "apk://expense", actions: ["view", "create", "update"] },
  { key: "apk.reports", group: "apk", label: "Laporan", route: "apk://laporan", actions: ["view", "export"] },
  { key: "apk.printing", group: "apk", label: "Pengaturan Print", route: "apk://print", actions: ["view", "update", "print"] }
];

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

const apkPermissionMap = apkPermissions.reduce((result, permission) => {
  result[permission.key] = permission.actions;
  return result;
}, {});

exports.up = async function up(knex) {
  await knex.transaction(async (trx) => {
    for (const permission of apkPermissions) {
      const row = {
        ...permission,
        actions: JSON.stringify(permission.actions)
      };
      const exists = await trx("permissions").where({ key: permission.key }).first();
      if (exists) await trx("permissions").where({ key: permission.key }).update(row);
      else await trx("permissions").insert(row);
    }

    await trx("permissions")
      .where({ key: "settings.permissions" })
      .update({ actions: JSON.stringify(["view", "create", "update", "delete"]) });

    const owner = await trx("roles").where({ id: "role_owner" }).first();
    if (owner) {
      const permissions = parseJson(owner.permissions, {});
      await trx("roles").where({ id: owner.id }).update({
        permissions: JSON.stringify({
          ...permissions,
          "settings.permissions": ["view", "create", "update", "delete"],
          ...apkPermissionMap
        })
      });
    }

    const cashier = await trx("roles").where({ id: "role_cashier" }).first();
    if (cashier) {
      await trx("roles").where({ id: cashier.id }).update({
        permissions: JSON.stringify(apkPermissionMap)
      });
    }
  });
};

exports.down = async function down(knex) {
  await knex.transaction(async (trx) => {
    const roles = await trx("roles");
    for (const role of roles) {
      const permissions = parseJson(role.permissions, {});
      Object.keys(permissions).forEach((key) => {
        if (key.startsWith("apk.")) delete permissions[key];
      });
      if (Array.isArray(permissions["settings.permissions"])) {
        permissions["settings.permissions"] = permissions["settings.permissions"].filter(
          (action) => !["create", "delete"].includes(action)
        );
      }
      if (role.id === "role_cashier") {
        Object.assign(permissions, {
          dashboard: ["view"],
          "master.customers": ["view"],
          "reports.sales": ["view"],
          "reports.transactions": ["view"]
        });
      }
      await trx("roles").where({ id: role.id }).update({ permissions: JSON.stringify(permissions) });
    }

    await trx("permissions").whereIn("key", apkPermissions.map((permission) => permission.key)).delete();
    await trx("permissions")
      .where({ key: "settings.permissions" })
      .update({ actions: JSON.stringify(["view", "update"]) });
  });
};

