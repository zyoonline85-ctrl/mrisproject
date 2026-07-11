exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable("pos_product_favorites");
  if (exists) return;

  await knex.schema.createTable("pos_product_favorites", (table) => {
    table.string("user_id").notNullable();
    table.string("outlet_id").notNullable();
    table.string("product_id").notNullable();
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.primary(["user_id", "outlet_id", "product_id"]);
    table.index(["user_id", "outlet_id"]);
    table.index(["product_id"]);
  });
};

exports.down = async function down(knex) {
  const exists = await knex.schema.hasTable("pos_product_favorites");
  if (!exists) return;
  await knex.schema.dropTable("pos_product_favorites");
};
