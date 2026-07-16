exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable("daily_reports");
  if (!exists) {
    await knex.schema.createTable("daily_reports", (table) => {
      table.string("id", 50).primary();
      table.string("outlet_id", 50).notNullable();
      table.date("report_date").notNullable();
      table.string("cashier_id", 50).notNullable();
      table.integer("cash_income").notNullable().defaultTo(0);
      table.integer("transfer_income").notNullable().defaultTo(0);
      table.integer("qris_income").notNullable().defaultTo(0);
      table.integer("total_income").notNullable().defaultTo(0);
      table.integer("total_expense").notNullable().defaultTo(0);
      table.integer("return_cash_amount").notNullable().defaultTo(0);
      table.date("return_cash_date").nullable().defaultTo(null);
      table.integer("gross_profit").notNullable().defaultTo(0);
      table.integer("drawer_money").notNullable().defaultTo(0);
      table.string("status", 20).notNullable().defaultTo("pending");
      table.text("details_json", "longtext").nullable();
      table.string("approved_by", 50).nullable().defaultTo(null);
      table.datetime("approved_at").nullable().defaultTo(null);
      table.datetime("created_at").notNullable();
      table.datetime("updated_at").notNullable();
      
      table.index(["outlet_id"]);
      table.index(["report_date"]);
      table.index(["status"]);
    });
  }
};

exports.down = async function down(knex) {
  const exists = await knex.schema.hasTable("daily_reports");
  if (exists) {
    await knex.schema.dropTable("daily_reports");
  }
};
