exports.up = async function up(knex) {
  await knex.schema.createTable("metadata", (table) => {
    table.string("key", 80).primary();
    table.json("value").nullable();
  });

  await knex.schema.createTable("permissions", (table) => {
    table.string("key", 80).primary();
    table.string("group", 80).notNullable();
    table.string("label", 120).notNullable();
    table.string("route", 160).nullable();
    table.json("actions").notNullable();
  });

  await knex.schema.createTable("roles", (table) => {
    table.string("id", 40).primary();
    table.string("name", 80).notNullable();
    table.text("description").nullable();
    table.json("permissions").notNullable();
  });

  await knex.schema.createTable("outlets", (table) => {
    table.string("id", 40).primary();
    table.string("name", 120).notNullable();
    table.string("code", 24).notNullable().unique();
    table.text("address").notNullable();
    table.string("phone", 40).nullable();
    table.string("status", 24).notNullable().defaultTo("active");
    table.date("opened_at").nullable();
  });

  await knex.schema.createTable("users", (table) => {
    table.string("id", 40).primary();
    table.string("name", 120).notNullable();
    table.string("username", 80).notNullable().unique();
    table.string("email", 160).notNullable().unique();
    table.string("password_hash", 160).notNullable();
    table.string("pin_hash", 160).nullable();
    table.string("role_id", 40).notNullable().references("id").inTable("roles");
    table.string("status", 24).notNullable().defaultTo("active");
    table.timestamp("last_login_at").nullable();
    table.timestamp("password_changed_at").nullable();
    table.timestamp("password_reset_at").nullable();
  });

  await knex.schema.createTable("user_outlets", (table) => {
    table.string("user_id", 40).notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.string("outlet_id", 40).notNullable().references("id").inTable("outlets").onDelete("CASCADE");
    table.primary(["user_id", "outlet_id"]);
  });

  await knex.schema.createTable("customers", (table) => {
    table.string("id", 40).primary();
    table.string("outlet_id", 40).notNullable().references("id").inTable("outlets");
    table.string("name", 120).notNullable();
    table.string("phone", 40).notNullable();
    table.string("barcode", 80).notNullable();
    table.integer("points").notNullable().defaultTo(0);
    table.string("status", 24).notNullable().defaultTo("active");
    table.date("registered_at").nullable();
    table.unique(["outlet_id", "phone"]);
    table.unique(["outlet_id", "barcode"]);
  });

  await knex.schema.createTable("categories", (table) => {
    table.string("id", 40).primary();
    table.string("name", 120).notNullable().unique();
    table.integer("sort_order").notNullable().defaultTo(0);
    table.string("status", 24).notNullable().defaultTo("active");
  });

  await knex.schema.createTable("products", (table) => {
    table.string("id", 40).primary();
    table.string("category_id", 40).notNullable().references("id").inTable("categories");
    table.string("sku", 80).notNullable().unique();
    table.string("name", 160).notNullable();
    table.string("status", 24).notNullable().defaultTo("active");
  });

  await knex.schema.createTable("product_prices", (table) => {
    table.string("id", 40).primary();
    table.string("product_id", 40).notNullable().references("id").inTable("products").onDelete("CASCADE");
    table.string("outlet_id", 40).notNullable().references("id").inTable("outlets").onDelete("CASCADE");
    table.integer("price").notNullable().defaultTo(0);
    table.string("status", 24).notNullable().defaultTo("active");
    table.unique(["product_id", "outlet_id"]);
  });

  await knex.schema.createTable("raw_materials", (table) => {
    table.string("id", 40).primary();
    table.string("name", 120).notNullable().unique();
    table.string("unit", 40).notNullable();
    table.decimal("low_stock_threshold", 14, 3).notNullable().defaultTo(0);
    table.integer("last_purchase_price").notNullable().defaultTo(0);
    table.date("last_purchase_date").nullable();
    table.string("last_purchase_outlet_id", 40).nullable().references("id").inTable("outlets");
    table.string("status", 24).notNullable().defaultTo("active");
  });

  await knex.schema.createTable("product_compositions", (table) => {
    table.string("id", 40).primary();
    table.string("product_id", 40).notNullable().references("id").inTable("products").onDelete("CASCADE");
    table.string("material_id", 40).notNullable().references("id").inTable("raw_materials");
    table.decimal("quantity", 14, 3).notNullable().defaultTo(0);
    table.string("unit", 40).notNullable();
    table.unique(["product_id", "material_id"]);
  });

  await knex.schema.createTable("suppliers", (table) => {
    table.string("id", 40).primary();
    table.string("name", 140).notNullable().unique();
    table.string("phone", 40).nullable();
    table.string("status", 24).notNullable().defaultTo("active");
  });

  await knex.schema.createTable("purchases", (table) => {
    table.string("id", 40).primary();
    table.string("outlet_id", 40).notNullable().references("id").inTable("outlets");
    table.string("supplier_id", 40).notNullable().references("id").inTable("suppliers");
    table.date("purchase_date").notNullable();
    table.string("status", 24).notNullable().defaultTo("draft");
    table.integer("total").notNullable().defaultTo(0);
  });

  await knex.schema.createTable("purchase_items", (table) => {
    table.string("id", 40).primary();
    table.string("purchase_id", 40).notNullable().references("id").inTable("purchases").onDelete("CASCADE");
    table.string("material_id", 40).notNullable().references("id").inTable("raw_materials");
    table.decimal("quantity", 14, 3).notNullable().defaultTo(0);
    table.string("unit", 40).notNullable();
    table.integer("unit_price").notNullable().defaultTo(0);
    table.integer("subtotal").notNullable().defaultTo(0);
  });

  await knex.schema.createTable("raw_material_stocks", (table) => {
    table.string("id", 40).primary();
    table.string("outlet_id", 40).notNullable().references("id").inTable("outlets").onDelete("CASCADE");
    table.string("material_id", 40).notNullable().references("id").inTable("raw_materials").onDelete("CASCADE");
    table.decimal("quantity", 14, 3).notNullable().defaultTo(0);
    table.string("unit", 40).notNullable();
    table.integer("last_purchase_price").notNullable().defaultTo(0);
    table.date("last_purchase_date").nullable();
    table.integer("stock_value").notNullable().defaultTo(0);
    table.unique(["outlet_id", "material_id"]);
  });

  await knex.schema.createTable("stock_transfers", (table) => {
    table.string("id", 40).primary();
    table.string("from_outlet_id", 40).notNullable().references("id").inTable("outlets");
    table.string("to_outlet_id", 40).notNullable().references("id").inTable("outlets");
    table.string("requested_by", 40).nullable().references("id").inTable("users");
    table.string("approved_by", 40).nullable().references("id").inTable("users");
    table.string("status", 24).notNullable().defaultTo("pending");
    table.date("transfer_date").notNullable();
  });

  await knex.schema.createTable("stock_transfer_items", (table) => {
    table.string("id", 40).primary();
    table.string("transfer_id", 40).notNullable().references("id").inTable("stock_transfers").onDelete("CASCADE");
    table.string("material_id", 40).notNullable().references("id").inTable("raw_materials");
    table.decimal("quantity", 14, 3).notNullable().defaultTo(0);
    table.string("unit", 40).notNullable();
  });

  await knex.schema.createTable("stock_opnames", (table) => {
    table.string("id", 40).primary();
    table.string("outlet_id", 40).notNullable().references("id").inTable("outlets");
    table.string("material_id", 40).notNullable().references("id").inTable("raw_materials");
    table.decimal("system_quantity", 14, 3).notNullable().defaultTo(0);
    table.decimal("actual_quantity", 14, 3).notNullable().defaultTo(0);
    table.string("unit", 40).notNullable();
    table.decimal("difference", 14, 3).notNullable().defaultTo(0);
    table.text("note").nullable();
    table.string("created_by", 40).nullable().references("id").inTable("users");
    table.date("opname_date").notNullable();
    table.string("batch_id", 60).nullable();
    table.decimal("damage_quantity", 14, 3).nullable();
    table.integer("unit_price").nullable();
    table.integer("loss_amount").nullable();
    table.decimal("computed_sales_quantity", 14, 3).nullable();
  });

  await knex.schema.createTable("dining_tables", (table) => {
    table.string("id", 40).primary();
    table.string("outlet_id", 40).notNullable().references("id").inTable("outlets").onDelete("CASCADE");
    table.string("number", 40).notNullable();
    table.string("status", 24).notNullable().defaultTo("active");
    table.unique(["outlet_id", "number"]);
  });

  await knex.schema.createTable("expense_categories", (table) => {
    table.string("id", 40).primary();
    table.string("name", 120).notNullable().unique();
    table.integer("sort_order").notNullable().defaultTo(0);
    table.string("status", 24).notNullable().defaultTo("active");
  });

  await knex.schema.createTable("print_settings", (table) => {
    table.string("id", 40).primary();
    table.string("printer_name", 140).notNullable();
    table.string("printer_status", 24).notNullable().defaultTo("active");
    table.string("mode", 60).notNullable().defaultTo("single_printer");
  });

  await knex.schema.createTable("print_templates", (table) => {
    table.string("key", 60).primary();
    table.string("label", 120).notNullable();
    table.boolean("enabled").notNullable().defaultTo(true);
    table.text("footer_text").nullable();
  });

  await knex.schema.createTable("transactions", (table) => {
    table.string("id", 40).primary();
    table.string("order_number", 80).notNullable().unique();
    table.string("outlet_id", 40).notNullable().references("id").inTable("outlets");
    table.string("cashier_id", 40).notNullable().references("id").inTable("users");
    table.string("customer_id", 40).nullable().references("id").inTable("customers");
    table.string("table_id", 40).nullable().references("id").inTable("dining_tables");
    table.string("service_type", 40).notNullable();
    table.timestamp("transaction_date").notNullable();
    table.integer("subtotal").notNullable().defaultTo(0);
    table.integer("discount").notNullable().defaultTo(0);
    table.integer("tax").notNullable().defaultTo(0);
    table.integer("total").notNullable().defaultTo(0);
    table.string("status", 24).notNullable().defaultTo("paid");
  });

  await knex.schema.createTable("transaction_items", (table) => {
    table.string("id", 40).primary();
    table.string("transaction_id", 40).notNullable().references("id").inTable("transactions").onDelete("CASCADE");
    table.string("product_id", 40).notNullable().references("id").inTable("products");
    table.integer("quantity").notNullable().defaultTo(1);
    table.integer("unit_price").notNullable().defaultTo(0);
    table.integer("subtotal").notNullable().defaultTo(0);
  });

  await knex.schema.createTable("payments", (table) => {
    table.string("id", 40).primary();
    table.string("transaction_id", 40).notNullable().references("id").inTable("transactions").onDelete("CASCADE");
    table.string("method", 40).notNullable();
    table.integer("amount").notNullable().defaultTo(0);
    table.string("status", 24).notNullable().defaultTo("paid");
    table.timestamp("paid_at").nullable();
  });

  await knex.schema.createTable("expenses", (table) => {
    table.string("id", 40).primary();
    table.string("outlet_id", 40).notNullable().references("id").inTable("outlets");
    table.string("category", 120).notNullable();
    table.text("description").nullable();
    table.integer("amount").notNullable().defaultTo(0);
    table.date("expense_date").notNullable();
    table.string("created_by", 40).nullable().references("id").inTable("users");
  });

  await knex.schema.createTable("report_snapshots", (table) => {
    table.string("key", 80).primary();
    table.json("payload").notNullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("report_snapshots");
  await knex.schema.dropTableIfExists("expenses");
  await knex.schema.dropTableIfExists("payments");
  await knex.schema.dropTableIfExists("transaction_items");
  await knex.schema.dropTableIfExists("transactions");
  await knex.schema.dropTableIfExists("print_templates");
  await knex.schema.dropTableIfExists("print_settings");
  await knex.schema.dropTableIfExists("expense_categories");
  await knex.schema.dropTableIfExists("dining_tables");
  await knex.schema.dropTableIfExists("stock_opnames");
  await knex.schema.dropTableIfExists("stock_transfer_items");
  await knex.schema.dropTableIfExists("stock_transfers");
  await knex.schema.dropTableIfExists("raw_material_stocks");
  await knex.schema.dropTableIfExists("purchase_items");
  await knex.schema.dropTableIfExists("purchases");
  await knex.schema.dropTableIfExists("suppliers");
  await knex.schema.dropTableIfExists("product_compositions");
  await knex.schema.dropTableIfExists("raw_materials");
  await knex.schema.dropTableIfExists("product_prices");
  await knex.schema.dropTableIfExists("products");
  await knex.schema.dropTableIfExists("categories");
  await knex.schema.dropTableIfExists("customers");
  await knex.schema.dropTableIfExists("user_outlets");
  await knex.schema.dropTableIfExists("users");
  await knex.schema.dropTableIfExists("outlets");
  await knex.schema.dropTableIfExists("roles");
  await knex.schema.dropTableIfExists("permissions");
  await knex.schema.dropTableIfExists("metadata");
};
