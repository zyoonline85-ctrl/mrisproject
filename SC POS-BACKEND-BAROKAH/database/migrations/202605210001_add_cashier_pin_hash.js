exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn("users", "pin_hash");
  if (hasColumn) return;

  await knex.schema.alterTable("users", (table) => {
    table.string("pin_hash", 160).nullable();
  });
};

exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn("users", "pin_hash");
  if (!hasColumn) return;

  await knex.schema.alterTable("users", (table) => {
    table.dropColumn("pin_hash");
  });
};
