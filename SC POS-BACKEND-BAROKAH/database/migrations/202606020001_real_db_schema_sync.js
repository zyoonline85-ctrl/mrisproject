async function addColumnIfMissing(knex, tableName, columnName, addColumn) {
  const exists = await knex.schema.hasColumn(tableName, columnName);
  if (exists) return;
  await knex.schema.alterTable(tableName, (table) => {
    addColumn(table);
  });
}

async function dropColumnIfExists(knex, tableName, columnName) {
  const exists = await knex.schema.hasColumn(tableName, columnName);
  if (!exists) return;
  await knex.schema.alterTable(tableName, (table) => {
    table.dropColumn(columnName);
  });
}

exports.up = async function up(knex) {
  await addColumnIfMissing(knex, "purchases", "updated_by", (table) => {
    table.string("updated_by", 40).nullable();
  });
  await addColumnIfMissing(knex, "purchases", "updated_at", (table) => {
    table.timestamp("updated_at").nullable();
  });

  await addColumnIfMissing(knex, "expenses", "previous_amount", (table) => {
    table.integer("previous_amount").nullable();
  });
  await addColumnIfMissing(knex, "expenses", "corrected_by", (table) => {
    table.string("corrected_by", 40).nullable();
  });
  await addColumnIfMissing(knex, "expenses", "corrected_at", (table) => {
    table.timestamp("corrected_at").nullable();
  });
  await addColumnIfMissing(knex, "expenses", "correction_note", (table) => {
    table.text("correction_note").nullable();
  });

  await addColumnIfMissing(knex, "transactions", "discount_name", (table) => {
    table.string("discount_name", 160).nullable();
  });
  await addColumnIfMissing(knex, "transactions", "customer_name", (table) => {
    table.string("customer_name", 160).nullable();
  });
  await addColumnIfMissing(knex, "transactions", "customer_phone", (table) => {
    table.string("customer_phone", 60).nullable();
  });
  await addColumnIfMissing(knex, "transactions", "customer_points_before", (table) => {
    table.integer("customer_points_before").nullable();
  });
  await addColumnIfMissing(knex, "transactions", "customer_points_earned", (table) => {
    table.integer("customer_points_earned").nullable();
  });
  await addColumnIfMissing(knex, "transactions", "customer_points_after", (table) => {
    table.integer("customer_points_after").nullable();
  });

  await addColumnIfMissing(knex, "stock_transfers", "transfer_type", (table) => {
    table.string("transfer_type", 24).notNullable().defaultTo("regular");
  });
  await addColumnIfMissing(knex, "stock_transfers", "loan_return_for_transfer_id", (table) => {
    table.string("loan_return_for_transfer_id", 40).nullable();
  });

  await addColumnIfMissing(knex, "stock_opnames", "request_id", (table) => {
    table.string("request_id", 60).nullable();
  });
  await addColumnIfMissing(knex, "stock_opnames", "opening_quantity", (table) => {
    table.decimal("opening_quantity", 14, 3).nullable();
  });
  await addColumnIfMissing(knex, "stock_opnames", "incoming_quantity", (table) => {
    table.decimal("incoming_quantity", 14, 3).nullable();
  });
  await addColumnIfMissing(knex, "stock_opnames", "transfer_quantity", (table) => {
    table.decimal("transfer_quantity", 14, 3).nullable();
  });
  await addColumnIfMissing(knex, "stock_opnames", "transfer_out_quantity", (table) => {
    table.decimal("transfer_out_quantity", 14, 3).nullable();
  });
  await addColumnIfMissing(knex, "stock_opnames", "source", (table) => {
    table.string("source", 40).notNullable().defaultTo("admin_web");
  });
  await addColumnIfMissing(knex, "stock_opnames", "approved_by", (table) => {
    table.string("approved_by", 40).nullable();
  });
  await addColumnIfMissing(knex, "stock_opnames", "approved_at", (table) => {
    table.timestamp("approved_at").nullable();
  });
  await addColumnIfMissing(knex, "stock_opnames", "rejected_by", (table) => {
    table.string("rejected_by", 40).nullable();
  });
  await addColumnIfMissing(knex, "stock_opnames", "rejected_at", (table) => {
    table.timestamp("rejected_at").nullable();
  });
  await addColumnIfMissing(knex, "stock_opnames", "rejection_note", (table) => {
    table.text("rejection_note").nullable();
  });
};

exports.down = async function down(knex) {
  await dropColumnIfExists(knex, "stock_opnames", "rejection_note");
  await dropColumnIfExists(knex, "stock_opnames", "rejected_at");
  await dropColumnIfExists(knex, "stock_opnames", "rejected_by");
  await dropColumnIfExists(knex, "stock_opnames", "approved_at");
  await dropColumnIfExists(knex, "stock_opnames", "approved_by");
  await dropColumnIfExists(knex, "stock_opnames", "source");
  await dropColumnIfExists(knex, "stock_opnames", "transfer_out_quantity");
  await dropColumnIfExists(knex, "stock_opnames", "transfer_quantity");
  await dropColumnIfExists(knex, "stock_opnames", "incoming_quantity");
  await dropColumnIfExists(knex, "stock_opnames", "opening_quantity");
  await dropColumnIfExists(knex, "stock_opnames", "request_id");

  await dropColumnIfExists(knex, "stock_transfers", "loan_return_for_transfer_id");
  await dropColumnIfExists(knex, "stock_transfers", "transfer_type");

  await dropColumnIfExists(knex, "transactions", "customer_points_after");
  await dropColumnIfExists(knex, "transactions", "customer_points_earned");
  await dropColumnIfExists(knex, "transactions", "customer_points_before");
  await dropColumnIfExists(knex, "transactions", "customer_phone");
  await dropColumnIfExists(knex, "transactions", "customer_name");
  await dropColumnIfExists(knex, "transactions", "discount_name");

  await dropColumnIfExists(knex, "expenses", "correction_note");
  await dropColumnIfExists(knex, "expenses", "corrected_at");
  await dropColumnIfExists(knex, "expenses", "corrected_by");
  await dropColumnIfExists(knex, "expenses", "previous_amount");

  await dropColumnIfExists(knex, "purchases", "updated_at");
  await dropColumnIfExists(knex, "purchases", "updated_by");
};
