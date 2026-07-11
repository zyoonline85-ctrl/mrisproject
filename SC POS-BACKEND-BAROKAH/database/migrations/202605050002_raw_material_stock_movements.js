exports.up = async function up(knex) {
  const hasMovements = await knex.schema.hasTable("raw_material_stock_movements");
  if (hasMovements) return;

  await knex.schema.createTable("raw_material_stock_movements", (table) => {
    table.string("id", 40).primary();
    table.string("outlet_id", 40).notNullable().references("id").inTable("outlets").onDelete("CASCADE");
    table.string("material_id", 40).notNullable().references("id").inTable("raw_materials").onDelete("CASCADE");
    table.string("type", 40).notNullable();
    table.decimal("quantity", 14, 3).notNullable().defaultTo(0);
    table.string("unit", 40).notNullable();
    table.string("reference_type", 40).nullable();
    table.string("reference_id", 40).nullable();
    table.string("reference_number", 100).nullable();
    table.text("description").nullable();
    table.timestamp("movement_date").notNullable();
    table.timestamp("created_at").notNullable();
    table.index(["outlet_id", "material_id", "movement_date"], "rm_stock_movements_lookup_idx");
    table.index(["reference_type", "reference_id"], "rm_stock_movements_ref_idx");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("raw_material_stock_movements");
};
