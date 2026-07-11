const TABLES = ["transactions", "purchases", "expenses", "stock_transfers", "stock_opnames"];

async function addColumnIfMissing(knex, tableName) {
  const exists = await knex.schema.hasColumn(tableName, "operational_at");
  if (exists) return;
  await knex.schema.alterTable(tableName, (table) => {
    table.dateTime("operational_at").nullable();
  });
}

async function dropColumnIfExists(knex, tableName) {
  const exists = await knex.schema.hasColumn(tableName, "operational_at");
  if (!exists) return;
  await knex.schema.alterTable(tableName, (table) => {
    table.dropColumn("operational_at");
  });
}

exports.up = async function up(knex) {
  for (const tableName of TABLES) {
    await addColumnIfMissing(knex, tableName);
  }
};

exports.down = async function down(knex) {
  for (const tableName of [...TABLES].reverse()) {
    await dropColumnIfExists(knex, tableName);
  }
};
