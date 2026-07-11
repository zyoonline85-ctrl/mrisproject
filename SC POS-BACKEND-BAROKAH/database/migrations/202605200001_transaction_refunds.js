exports.up = async function up(knex) {
  const hasRefunds = await knex.schema.hasTable("transaction_refunds");
  if (!hasRefunds) {
    await knex.schema.createTable("transaction_refunds", (table) => {
      table.string("id", 40).primary();
      table.string("transaction_id", 40).notNullable().references("id").inTable("transactions").onDelete("CASCADE");
      table.string("outlet_id", 40).notNullable().references("id").inTable("outlets");
      table.integer("refund_amount").notNullable().defaultTo(0);
      table.string("payment_method", 40).nullable();
      table.text("reason").notNullable();
      table.string("refunded_by", 40).nullable().references("id").inTable("users");
      table.timestamp("refunded_at").notNullable().defaultTo(knex.fn.now());
      table.string("status", 24).notNullable().defaultTo("active");
      table.unique(["transaction_id"]);
      table.index(["outlet_id", "refunded_at"]);
    });
  }

  const hasStockDeducted = await knex.schema.hasColumn("transactions", "stock_deducted");
  const hasStockRefunded = await knex.schema.hasColumn("transactions", "stock_refunded");
  await knex.schema.alterTable("transactions", (table) => {
    if (!hasStockDeducted) {
      table.boolean("stock_deducted").notNullable().defaultTo(false);
      table.timestamp("stock_deducted_at").nullable();
    }
    if (!hasStockRefunded) {
      table.boolean("stock_refunded").notNullable().defaultTo(false);
      table.timestamp("stock_refunded_at").nullable();
    }
  });
};

exports.down = async function down(knex) {
  const hasStockDeducted = await knex.schema.hasColumn("transactions", "stock_deducted");
  const hasStockRefunded = await knex.schema.hasColumn("transactions", "stock_refunded");
  await knex.schema.alterTable("transactions", (table) => {
    if (hasStockRefunded) {
      table.dropColumn("stock_refunded_at");
      table.dropColumn("stock_refunded");
    }
    if (hasStockDeducted) {
      table.dropColumn("stock_deducted_at");
      table.dropColumn("stock_deducted");
    }
  });
  await knex.schema.dropTableIfExists("transaction_refunds");
};
