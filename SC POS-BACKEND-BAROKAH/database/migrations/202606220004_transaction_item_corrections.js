const { parseJson } = require("../../src/utils/json");

async function addColumnIfMissing(knex, tableName, columnName, addColumn) {
  if (await knex.schema.hasColumn(tableName, columnName)) return;
  await knex.schema.alterTable(tableName, (table) => addColumn(table));
}

async function dropColumnIfExists(knex, tableName, columnName) {
  if (!await knex.schema.hasColumn(tableName, columnName)) return;
  await knex.schema.alterTable(tableName, (table) => table.dropColumn(columnName));
}

exports.up = async function up(knex) {
  await addColumnIfMissing(knex, "transactions", "updated_by", (table) => {
    table.string("updated_by", 40).nullable().references("id").inTable("users").onDelete("SET NULL");
  });
  await addColumnIfMissing(knex, "transactions", "updated_at", (table) => {
    table.timestamp("updated_at").nullable();
  });
  await addColumnIfMissing(knex, "transactions", "correction_reason", (table) => {
    table.text("correction_reason").nullable();
  });
  await knex("transactions").whereNull("updated_at").update({ updated_at: knex.ref("transaction_date") });

  const permission = await knex("permissions").where({ key: "reports.transactions" }).first();
  if (permission) {
    const actions = parseJson(permission.actions, []);
    await knex("permissions").where({ key: permission.key }).update({
      actions: JSON.stringify([...new Set([...(Array.isArray(actions) ? actions : []), "update"])])
    });
  }

  const roles = await knex("roles").whereIn("id", ["role_owner", "role_admin"]);
  for (const role of roles) {
    const permissions = parseJson(role.permissions, {});
    permissions["reports.transactions"] = [
      ...new Set([...(permissions["reports.transactions"] || []), "update"])
    ];
    await knex("roles").where({ id: role.id }).update({ permissions: JSON.stringify(permissions) });
  }
};

exports.down = async function down(knex) {
  const permission = await knex("permissions").where({ key: "reports.transactions" }).first();
  if (permission) {
    const actions = parseJson(permission.actions, []).filter((action) => action !== "update");
    await knex("permissions").where({ key: permission.key }).update({ actions: JSON.stringify(actions) });
  }
  const roles = await knex("roles");
  for (const role of roles) {
    const permissions = parseJson(role.permissions, {});
    if (Array.isArray(permissions["reports.transactions"])) {
      permissions["reports.transactions"] = permissions["reports.transactions"].filter((action) => action !== "update");
      await knex("roles").where({ id: role.id }).update({ permissions: JSON.stringify(permissions) });
    }
  }
  await dropColumnIfExists(knex, "transactions", "correction_reason");
  await dropColumnIfExists(knex, "transactions", "updated_at");
  await dropColumnIfExists(knex, "transactions", "updated_by");
};
