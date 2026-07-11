const { parseJson } = require("../../src/utils/json");

async function addColumnIfMissing(knex, tableName, columnName, addColumn) {
  if (await knex.schema.hasColumn(tableName, columnName)) return;
  await knex.schema.alterTable(tableName, (table) => addColumn(table));
}

function itemSnapshot(item) {
  const metadata = parseJson(item.metadata_json, {});
  const selectedVariants = Array.isArray(metadata.selected_variants) ? metadata.selected_variants : [];
  return {
    productId: item.product_id,
    productName: item.product_name || "",
    categoryId: item.category_id || "",
    categoryName: item.category_name || "",
    quantity: Number(item.quantity || 0),
    unitPrice: Number(item.unit_price || 0),
    subtotal: Number(item.subtotal || 0),
    variantIds: selectedVariants.map((variant) => variant.id).filter(Boolean),
    selectedVariants
  };
}

exports.up = async function up(knex) {
  await addColumnIfMissing(knex, "open_bills", "customer_printed_items_json", (table) => {
    table.json("customer_printed_items_json").nullable();
  });
  await addColumnIfMissing(knex, "open_bills", "kitchen_printed_items_json", (table) => {
    table.json("kitchen_printed_items_json").nullable();
  });
  await addColumnIfMissing(knex, "open_bill_items", "metadata_json", (table) => {
    table.json("metadata_json").nullable();
  });

  const bills = await knex("open_bills").where("status", "open").select("id");
  for (const bill of bills) {
    const items = await knex("open_bill_items").where({ open_bill_id: bill.id }).orderBy("id");
    const snapshot = items.map(itemSnapshot);
    await knex("open_bills").where({ id: bill.id }).update({
      customer_printed_items_json: JSON.stringify(snapshot),
      kitchen_printed_items_json: JSON.stringify(snapshot)
    });
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn("open_bill_items", "metadata_json")) {
    await knex.schema.alterTable("open_bill_items", (table) => table.dropColumn("metadata_json"));
  }
  if (await knex.schema.hasColumn("open_bills", "kitchen_printed_items_json")) {
    await knex.schema.alterTable("open_bills", (table) => table.dropColumn("kitchen_printed_items_json"));
  }
  if (await knex.schema.hasColumn("open_bills", "customer_printed_items_json")) {
    await knex.schema.alterTable("open_bills", (table) => table.dropColumn("customer_printed_items_json"));
  }
};
