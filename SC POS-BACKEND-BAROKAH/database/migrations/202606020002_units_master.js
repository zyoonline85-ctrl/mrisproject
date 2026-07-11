async function createTableIfMissing(knex, tableName, callback) {
  const exists = await knex.schema.hasTable(tableName);
  if (exists) return;
  await knex.schema.createTable(tableName, callback);
}

exports.up = async function up(knex) {
  await createTableIfMissing(knex, "units", (table) => {
    table.string("id", 40).primary();
    table.string("name", 120).notNullable();
    table.string("code", 40).notNullable().unique();
    table.string("status", 24).notNullable().defaultTo("active");
    table.integer("sort_order").notNullable().defaultTo(0);
  });
};

exports.down = async function down(knex) {
  const exists = await knex.schema.hasTable("units");
  if (exists) await knex.schema.dropTable("units");
};
