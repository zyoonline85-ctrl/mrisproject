exports.up = async function up(knex) {
  const hasProductVariants = await knex.schema.hasTable("product_variants");
  if (hasProductVariants) {
    const hasSortOrder = await knex.schema.hasColumn("product_variants", "sort_order");
    if (!hasSortOrder) {
      await knex.schema.alterTable("product_variants", (table) => {
        table.integer("sort_order").notNullable().defaultTo(0);
      });
    }
  }

  const hasTransactionItems = await knex.schema.hasTable("transaction_items");
  if (hasTransactionItems) {
    const hasMetadata = await knex.schema.hasColumn("transaction_items", "metadata_json");
    if (!hasMetadata) {
      await knex.schema.alterTable("transaction_items", (table) => {
        table.json("metadata_json").nullable();
      });
    }
  }
};

exports.down = async function down(knex) {
  const hasProductVariants = await knex.schema.hasTable("product_variants");
  if (hasProductVariants) {
    const hasSortOrder = await knex.schema.hasColumn("product_variants", "sort_order");
    if (hasSortOrder) {
      await knex.schema.alterTable("product_variants", (table) => {
        table.dropColumn("sort_order");
      });
    }
  }

  const hasTransactionItems = await knex.schema.hasTable("transaction_items");
  if (hasTransactionItems) {
    const hasMetadata = await knex.schema.hasColumn("transaction_items", "metadata_json");
    if (hasMetadata) {
      await knex.schema.alterTable("transaction_items", (table) => {
        table.dropColumn("metadata_json");
      });
    }
  }
};
