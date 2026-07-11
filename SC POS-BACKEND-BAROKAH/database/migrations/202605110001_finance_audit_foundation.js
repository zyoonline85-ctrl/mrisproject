async function createTableIfMissing(knex, tableName, callback) {
  if (!(await knex.schema.hasTable(tableName))) {
    await knex.schema.createTable(tableName, callback);
  }
}

async function addColumnIfMissing(knex, tableName, columnName, callback) {
  if (!(await knex.schema.hasColumn(tableName, columnName))) {
    await knex.schema.alterTable(tableName, callback);
  }
}

exports.up = async function up(knex) {
  await createTableIfMissing(knex, "raw_material_categories", (table) => {
    table.string("id", 40).primary();
    table.string("name", 120).notNullable();
    table.string("type", 24).notNullable().defaultTo("hpp");
    table.string("account_code", 24).nullable();
    table.integer("sort_order").notNullable().defaultTo(0);
    table.string("status", 24).notNullable().defaultTo("active");
    table.unique(["name", "type"]);
  });

  await addColumnIfMissing(knex, "raw_materials", "type", (table) => {
    table.string("type", 24).notNullable().defaultTo("hpp");
  });
  await addColumnIfMissing(knex, "raw_materials", "category_id", (table) => {
    table.string("category_id", 40).nullable().references("id").inTable("raw_material_categories");
  });
  await addColumnIfMissing(knex, "raw_materials", "account_code", (table) => {
    table.string("account_code", 24).nullable();
  });

  await addColumnIfMissing(knex, "expense_categories", "account_code", (table) => {
    table.string("account_code", 24).nullable();
  });

  await addColumnIfMissing(knex, "categories", "account_code", (table) => {
    table.string("account_code", 24).nullable();
  });

  await addColumnIfMissing(knex, "transactions", "note", (table) => {
    table.text("note").nullable();
  });
  await addColumnIfMissing(knex, "transactions", "discount_id", (table) => {
    table.string("discount_id", 40).nullable();
  });
  await addColumnIfMissing(knex, "transactions", "discount_type", (table) => {
    table.string("discount_type", 24).nullable();
  });
  await addColumnIfMissing(knex, "transactions", "discount_value", (table) => {
    table.integer("discount_value").nullable();
  });

  await createTableIfMissing(knex, "payment_methods", (table) => {
    table.string("id", 40).primary();
    table.string("name", 80).notNullable().unique();
    table.string("code", 40).notNullable().unique();
    table.string("account_code", 24).nullable();
    table.integer("sort_order").notNullable().defaultTo(0);
    table.string("status", 24).notNullable().defaultTo("active");
  });

  await addColumnIfMissing(knex, "payments", "payment_method_id", (table) => {
    table.string("payment_method_id", 40).nullable().references("id").inTable("payment_methods");
  });
  await addColumnIfMissing(knex, "payments", "change_amount", (table) => {
    table.integer("change_amount").notNullable().defaultTo(0);
  });

  await knex.schema.alterTable("purchases", (table) => {
    table.string("supplier_id", 40).nullable().alter();
  });
  await addColumnIfMissing(knex, "purchases", "payment_type", (table) => {
    table.string("payment_type", 24).notNullable().defaultTo("lunas");
  });
  await addColumnIfMissing(knex, "purchases", "source", (table) => {
    table.string("source", 40).notNullable().defaultTo("admin_web");
  });
  await addColumnIfMissing(knex, "purchases", "batch_id", (table) => {
    table.string("batch_id", 60).nullable();
  });
  await addColumnIfMissing(knex, "purchases", "note", (table) => {
    table.text("note").nullable();
  });
  await addColumnIfMissing(knex, "purchases", "created_by", (table) => {
    table.string("created_by", 40).nullable().references("id").inTable("users");
  });
  await addColumnIfMissing(knex, "purchases", "approved_by", (table) => {
    table.string("approved_by", 40).nullable().references("id").inTable("users");
  });
  await addColumnIfMissing(knex, "purchases", "approved_at", (table) => {
    table.timestamp("approved_at").nullable();
  });
  await addColumnIfMissing(knex, "purchases", "rejected_by", (table) => {
    table.string("rejected_by", 40).nullable().references("id").inTable("users");
  });
  await addColumnIfMissing(knex, "purchases", "rejected_at", (table) => {
    table.timestamp("rejected_at").nullable();
  });
  await addColumnIfMissing(knex, "purchases", "rejection_note", (table) => {
    table.text("rejection_note").nullable();
  });

  await addColumnIfMissing(knex, "stock_transfers", "rejection_note", (table) => {
    table.text("rejection_note").nullable();
  });
  await addColumnIfMissing(knex, "stock_transfers", "source", (table) => {
    table.string("source", 40).notNullable().defaultTo("admin_web");
  });
  await addColumnIfMissing(knex, "stock_transfers", "batch_id", (table) => {
    table.string("batch_id", 60).nullable();
  });
  await addColumnIfMissing(knex, "stock_transfers", "note", (table) => {
    table.text("note").nullable();
  });

  await addColumnIfMissing(knex, "stock_opnames", "status", (table) => {
    table.string("status", 40).notNullable().defaultTo("pas");
  });

  await createTableIfMissing(knex, "discounts", (table) => {
    table.string("id", 40).primary();
    table.string("name", 120).notNullable();
    table.string("type", 24).notNullable();
    table.integer("value").notNullable().defaultTo(0);
    table.date("starts_at").nullable();
    table.date("ends_at").nullable();
    table.string("status", 24).notNullable().defaultTo("active");
  });

  await createTableIfMissing(knex, "discount_outlets", (table) => {
    table.string("discount_id", 40).notNullable().references("id").inTable("discounts").onDelete("CASCADE");
    table.string("outlet_id", 40).notNullable().references("id").inTable("outlets").onDelete("CASCADE");
    table.primary(["discount_id", "outlet_id"]);
  });

  await createTableIfMissing(knex, "product_variants", (table) => {
    table.string("id", 40).primary();
    table.string("product_id", 40).notNullable().references("id").inTable("products").onDelete("CASCADE");
    table.string("name", 120).notNullable();
    table.string("sku", 80).nullable().unique();
    table.integer("price_delta").notNullable().defaultTo(0);
    table.string("status", 24).notNullable().defaultTo("active");
  });

  await createTableIfMissing(knex, "activity_logs", (table) => {
    table.string("id", 40).primary();
    table.string("actor_user_id", 40).nullable().references("id").inTable("users");
    table.string("actor_role", 40).nullable();
    table.string("outlet_id", 40).nullable().references("id").inTable("outlets");
    table.string("source", 40).notNullable().defaultTo("backend");
    table.string("module", 80).notNullable();
    table.string("action", 80).notNullable();
    table.string("entity_type", 80).nullable();
    table.string("entity_id", 80).nullable();
    table.text("description").nullable();
    table.json("metadata_json").nullable();
    table.string("ip_address", 80).nullable();
    table.string("device_id", 120).nullable();
    table.string("app_version", 80).nullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.index(["outlet_id", "created_at"]);
    table.index(["actor_user_id", "created_at"]);
    table.index(["source", "module", "action"]);
  });

  await createTableIfMissing(knex, "financial_accounts", (table) => {
    table.string("id", 40).primary();
    table.string("code", 24).notNullable().unique();
    table.string("name", 160).notNullable();
    table.string("report_group", 60).notNullable();
    table.string("normal_balance", 20).notNullable().defaultTo("debit");
    table.integer("sort_order").notNullable().defaultTo(0);
    table.string("status", 24).notNullable().defaultTo("active");
  });

  await createTableIfMissing(knex, "balance_sheet_entries", (table) => {
    table.string("id", 40).primary();
    table.string("account_code", 24).notNullable();
    table.string("name", 160).notNullable();
    table.string("group", 80).notNullable();
    table.string("movement_type", 12).nullable();
    table.integer("amount").notNullable().defaultTo(0);
    table.date("entry_date").notNullable();
    table.string("outlet_id", 40).nullable().references("id").inTable("outlets");
    table.text("note").nullable();
    table.string("status", 24).notNullable().defaultTo("active");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("balance_sheet_entries");
  await knex.schema.dropTableIfExists("financial_accounts");
  await knex.schema.dropTableIfExists("activity_logs");
  await knex.schema.dropTableIfExists("product_variants");
  await knex.schema.dropTableIfExists("discount_outlets");
  await knex.schema.dropTableIfExists("discounts");
  await knex.schema.alterTable("stock_opnames", (table) => {
    table.dropColumn("status");
  });
  await knex.schema.alterTable("stock_transfers", (table) => {
    table.dropColumn("note");
    table.dropColumn("batch_id");
    table.dropColumn("source");
    table.dropColumn("rejection_note");
  });
  await knex.schema.alterTable("purchases", (table) => {
    table.dropColumn("rejection_note");
    table.dropColumn("rejected_at");
    table.dropColumn("rejected_by");
    table.dropColumn("approved_at");
    table.dropColumn("approved_by");
    table.dropColumn("created_by");
    table.dropColumn("note");
    table.dropColumn("batch_id");
    table.dropColumn("source");
    table.dropColumn("payment_type");
    table.string("supplier_id", 40).notNullable().alter();
  });
  await knex.schema.alterTable("payments", (table) => {
    table.dropColumn("change_amount");
    table.dropColumn("payment_method_id");
  });
  await knex.schema.dropTableIfExists("payment_methods");
  await knex.schema.alterTable("transactions", (table) => {
    table.dropColumn("discount_value");
    table.dropColumn("discount_type");
    table.dropColumn("discount_id");
    table.dropColumn("note");
  });
  await knex.schema.alterTable("categories", (table) => {
    table.dropColumn("account_code");
  });
  await knex.schema.alterTable("expense_categories", (table) => {
    table.dropColumn("account_code");
  });
  await knex.schema.alterTable("raw_materials", (table) => {
    table.dropColumn("account_code");
    table.dropColumn("category_id");
    table.dropColumn("type");
  });
  await knex.schema.dropTableIfExists("raw_material_categories");
};
