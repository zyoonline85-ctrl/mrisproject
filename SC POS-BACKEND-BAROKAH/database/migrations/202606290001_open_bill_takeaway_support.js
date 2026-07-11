async function addColumnIfMissing(knex, tableName, columnName, addColumn) {
  if (await knex.schema.hasColumn(tableName, columnName)) return;
  await knex.schema.alterTable(tableName, (table) => addColumn(table));
}

exports.up = async function up(knex) {
  await addColumnIfMissing(knex, "open_bills", "service_type", (table) => {
    table.string("service_type", 40).notNullable().defaultTo("dine_in");
  });

  if (await knex.schema.hasColumn("open_bills", "table_number")) {
    await knex.schema.alterTable("open_bills", (table) => {
      table.string("table_number", 40).nullable().alter();
    });
  }

  await knex("open_bills")
    .whereNull("service_type")
    .orWhere("service_type", "")
    .update({ service_type: "dine_in" });
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn("open_bills", "service_type")) {
    await knex("open_bills")
      .where({ service_type: "takeaway" })
      .update({ service_type: "dine_in", table_number: "TAKEAWAY" });
    await knex.schema.alterTable("open_bills", (table) => {
      table.dropColumn("service_type");
    });
  }

  if (await knex.schema.hasColumn("open_bills", "table_number")) {
    await knex.schema.alterTable("open_bills", (table) => {
      table.string("table_number", 40).notNullable().alter();
    });
  }
};
