exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable("discount_outlets");
  if (exists) return;

  await knex.schema.createTable("discount_outlets", (table) => {
    table.string("discount_id", 40).notNullable().references("id").inTable("discounts").onDelete("CASCADE");
    table.string("outlet_id", 40).notNullable().references("id").inTable("outlets").onDelete("CASCADE");
    table.primary(["discount_id", "outlet_id"]);
  });

  const [discounts, outlets] = await Promise.all([knex("discounts").select("id"), knex("outlets").select("id")]);
  const rows = discounts.flatMap((discount) =>
    outlets.map((outlet) => ({
      discount_id: discount.id,
      outlet_id: outlet.id
    }))
  );
  if (rows.length) await knex.batchInsert("discount_outlets", rows, 100);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("discount_outlets");
};
