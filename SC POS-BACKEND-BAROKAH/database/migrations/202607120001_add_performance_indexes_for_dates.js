async function indexExists(knex, tableName, indexName) {
  const [rows] = await knex.raw(
    "SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1",
    [tableName, indexName]
  );
  return rows.length > 0;
}

exports.up = async function up(knex) {
  // 1. transactions(transaction_date)
  if (!(await indexExists(knex, "transactions", "idx_transactions_date"))) {
    await knex.schema.alterTable("transactions", (table) => {
      table.index(["transaction_date"], "idx_transactions_date");
    });
  }

  // 2. purchases(purchase_date)
  if (!(await indexExists(knex, "purchases", "idx_purchases_date"))) {
    await knex.schema.alterTable("purchases", (table) => {
      table.index(["purchase_date"], "idx_purchases_date");
    });
  }

  // 3. expenses(expense_date)
  if (!(await indexExists(knex, "expenses", "idx_expenses_date"))) {
    await knex.schema.alterTable("expenses", (table) => {
      table.index(["expense_date"], "idx_expenses_date");
    });
  }
};

exports.down = async function down(knex) {
  // 1. transactions(transaction_date)
  if (await indexExists(knex, "transactions", "idx_transactions_date")) {
    await knex.schema.alterTable("transactions", (table) => {
      table.dropIndex(["transaction_date"], "idx_transactions_date");
    });
  }

  // 2. purchases(purchase_date)
  if (await indexExists(knex, "purchases", "idx_purchases_date")) {
    await knex.schema.alterTable("purchases", (table) => {
      table.dropIndex(["purchase_date"], "idx_purchases_date");
    });
  }

  // 3. expenses(expense_date)
  if (await indexExists(knex, "expenses", "idx_expenses_date")) {
    await knex.schema.alterTable("expenses", (table) => {
      table.dropIndex(["expense_date"], "idx_expenses_date");
    });
  }
};
