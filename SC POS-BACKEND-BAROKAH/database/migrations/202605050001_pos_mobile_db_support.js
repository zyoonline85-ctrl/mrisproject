exports.up = async function up(knex) {
  const hasTransactionsClientRef = await knex.schema.hasColumn("transactions", "client_ref");
  if (!hasTransactionsClientRef) {
    await knex.schema.alterTable("transactions", (table) => {
      table.string("client_ref", 120).nullable().unique();
      table.string("customer_name", 160).nullable();
      table.string("customer_phone", 40).nullable();
      table.integer("customer_points_before").notNullable().defaultTo(0);
      table.integer("customer_points_earned").notNullable().defaultTo(0);
      table.integer("customer_points_after").notNullable().defaultTo(0);
    });
  }

  const hasPaymentsChangeAmount = await knex.schema.hasColumn("payments", "change_amount");
  if (!hasPaymentsChangeAmount) {
    await knex.schema.alterTable("payments", (table) => {
      table.integer("change_amount").notNullable().defaultTo(0);
    });
  }

  const hasExpensesClientRef = await knex.schema.hasColumn("expenses", "client_ref");
  if (!hasExpensesClientRef) {
    await knex.schema.alterTable("expenses", (table) => {
      table.string("client_ref", 120).nullable().unique();
    });
  }

  const hasOpenBills = await knex.schema.hasTable("open_bills");
  if (!hasOpenBills) {
    await knex.schema.createTable("open_bills", (table) => {
      table.string("id", 40).primary();
      table.string("client_ref", 120).nullable().unique();
      table.string("order_number", 80).notNullable().unique();
      table.string("outlet_id", 40).notNullable().references("id").inTable("outlets").onDelete("CASCADE");
      table.string("cashier_id", 40).notNullable().references("id").inTable("users");
      table.string("table_id", 40).nullable().references("id").inTable("dining_tables");
      table.string("table_number", 40).notNullable();
      table.string("customer_id", 40).nullable().references("id").inTable("customers");
      table.string("customer_name", 160).nullable();
      table.string("customer_phone", 40).nullable();
      table.integer("customer_points").notNullable().defaultTo(0);
      table.integer("total").notNullable().defaultTo(0);
      table.string("status", 24).notNullable().defaultTo("open");
      table.timestamp("created_at").notNullable();
      table.timestamp("updated_at").notNullable();
    });
  }

  const hasOpenBillItems = await knex.schema.hasTable("open_bill_items");
  if (!hasOpenBillItems) {
    await knex.schema.createTable("open_bill_items", (table) => {
      table.string("id", 40).primary();
      table.string("open_bill_id", 40).notNullable().references("id").inTable("open_bills").onDelete("CASCADE");
      table.string("product_id", 40).notNullable().references("id").inTable("products");
      table.string("product_name", 160).nullable();
      table.string("category_id", 40).nullable().references("id").inTable("categories");
      table.string("category_name", 120).nullable();
      table.integer("quantity").notNullable().defaultTo(1);
      table.integer("unit_price").notNullable().defaultTo(0);
      table.integer("subtotal").notNullable().defaultTo(0);
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("open_bill_items");
  await knex.schema.dropTableIfExists("open_bills");

  if (await knex.schema.hasColumn("expenses", "client_ref")) {
    await knex.schema.alterTable("expenses", (table) => {
      table.dropColumn("client_ref");
    });
  }

  if (await knex.schema.hasColumn("payments", "change_amount")) {
    await knex.schema.alterTable("payments", (table) => {
      table.dropColumn("change_amount");
    });
  }

  if (await knex.schema.hasColumn("transactions", "client_ref")) {
    await knex.schema.alterTable("transactions", (table) => {
      table.dropColumn("client_ref");
      table.dropColumn("customer_name");
      table.dropColumn("customer_phone");
      table.dropColumn("customer_points_before");
      table.dropColumn("customer_points_earned");
      table.dropColumn("customer_points_after");
    });
  }
};
