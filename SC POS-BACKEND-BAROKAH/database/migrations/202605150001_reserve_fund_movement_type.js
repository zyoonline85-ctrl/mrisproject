exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable("balance_sheet_entries");
  if (!hasTable) return;

  const hasMovementType = await knex.schema.hasColumn("balance_sheet_entries", "movement_type");
  if (!hasMovementType) {
    await knex.schema.alterTable("balance_sheet_entries", (table) => {
      table.string("movement_type", 12).nullable();
    });
  }
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable("balance_sheet_entries");
  if (!hasTable) return;

  const hasMovementType = await knex.schema.hasColumn("balance_sheet_entries", "movement_type");
  if (hasMovementType) {
    await knex.schema.alterTable("balance_sheet_entries", (table) => {
      table.dropColumn("movement_type");
    });
  }
};
