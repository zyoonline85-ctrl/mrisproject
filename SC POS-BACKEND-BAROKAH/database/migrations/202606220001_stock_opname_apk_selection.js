async function addColumnIfMissing(knex, tableName, columnName, addColumn) {
  if (await knex.schema.hasColumn(tableName, columnName)) return;
  await knex.schema.alterTable(tableName, (table) => addColumn(table));
}

async function dropColumnIfExists(knex, tableName, columnName) {
  if (!(await knex.schema.hasColumn(tableName, columnName))) return;
  await knex.schema.alterTable(tableName, (table) => table.dropColumn(columnName));
}

exports.up = async function up(knex) {
  const tableName = "stock_opname_material_selections";
  if (!(await knex.schema.hasTable(tableName))) {
    await knex.schema.createTable(tableName, (table) => {
      table.string("outlet_id", 40).notNullable().references("id").inTable("outlets").onDelete("CASCADE");
      table.string("material_id", 40).notNullable().references("id").inTable("raw_materials").onDelete("CASCADE");
      table.string("selected_by", 40).nullable().references("id").inTable("users").onDelete("SET NULL");
      table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
      table.primary(["outlet_id", "material_id"]);
    });
  }

  const [{ count }] = await knex(tableName).count({ count: "material_id" });
  if (Number(count || 0) === 0) {
    const [outlets, materials] = await Promise.all([
      knex("outlets").whereNot("status", "inactive").select("id"),
      knex("raw_materials").whereNot("status", "inactive").select("id")
    ]);
    const rows = outlets.flatMap((outlet) =>
      materials.map((material) => ({ outlet_id: outlet.id, material_id: material.id }))
    );
    if (rows.length) await knex.batchInsert(tableName, rows, 250);
  }

  await addColumnIfMissing(knex, "stock_opnames", "updated_by", (table) => {
    table.string("updated_by", 40).nullable().references("id").inTable("users").onDelete("SET NULL");
  });
  await addColumnIfMissing(knex, "stock_opnames", "updated_at", (table) => {
    table.timestamp("updated_at").nullable();
  });
};

exports.down = async function down(knex) {
  await dropColumnIfExists(knex, "stock_opnames", "updated_at");
  await dropColumnIfExists(knex, "stock_opnames", "updated_by");
  await knex.schema.dropTableIfExists("stock_opname_material_selections");
};
