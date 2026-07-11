exports.up = async function up(knex) {
  const hasCancelReason = await knex.schema.hasColumn("transactions", "cancel_reason");
  if (!hasCancelReason) {
    await knex.schema.alterTable("transactions", (table) => {
      table.text("cancel_reason").nullable();
      table.string("cancelled_by", 64).nullable();
      table.timestamp("cancelled_at").nullable();
      table.boolean("stock_cancelled").notNullable().defaultTo(false);
      table.timestamp("stock_cancelled_at").nullable();
    });
  }
};

exports.down = async function down(knex) {
  const hasCancelReason = await knex.schema.hasColumn("transactions", "cancel_reason");
  if (hasCancelReason) {
    await knex.schema.alterTable("transactions", (table) => {
      table.dropColumn("stock_cancelled_at");
      table.dropColumn("stock_cancelled");
      table.dropColumn("cancelled_at");
      table.dropColumn("cancelled_by");
      table.dropColumn("cancel_reason");
    });
  }
};
