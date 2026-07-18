exports.up = async function up(knex) {
  // 1. Tabel manual_daily_reports
  const dailyExists = await knex.schema.hasTable("manual_daily_reports");
  if (!dailyExists) {
    await knex.schema.createTable("manual_daily_reports", (table) => {
      table.string("id", 50).primary();
      table.string("outlet_id", 50).notNullable();
      table.date("report_date").notNullable();
      table.bigInteger("total_sales").notNullable().defaultTo(0);
      table.bigInteger("total_expense").notNullable().defaultTo(0);
      table.text("notes").nullable();
      table.string("created_by", 50).notNullable();
      table.datetime("created_at").notNullable();
      table.datetime("updated_at").notNullable();

      // Constraint unik kombinasi report_date + outlet_id
      table.unique(["report_date", "outlet_id"]);

      // Indexing untuk performa
      table.index(["outlet_id"]);
      table.index(["report_date"]);
    });
  }

  // 2. Tabel manual_logistic_reports
  const logisticExists = await knex.schema.hasTable("manual_logistic_reports");
  if (!logisticExists) {
    await knex.schema.createTable("manual_logistic_reports", (table) => {
      table.string("id", 50).primary();
      table.string("outlet_id", 50).notNullable();
      table.date("report_date").notNullable();
      table.text("details_json", "longtext").nullable();
      table.text("notes").nullable();
      table.string("created_by", 50).notNullable();
      table.datetime("created_at").notNullable();
      table.datetime("updated_at").notNullable();

      // Constraint unik kombinasi report_date + outlet_id
      table.unique(["report_date", "outlet_id"]);

      // Indexing untuk performa
      table.index(["outlet_id"]);
      table.index(["report_date"]);
    });
  }
};

exports.down = async function down(knex) {
  const logisticExists = await knex.schema.hasTable("manual_logistic_reports");
  if (logisticExists) {
    await knex.schema.dropTable("manual_logistic_reports");
  }

  const dailyExists = await knex.schema.hasTable("manual_daily_reports");
  if (dailyExists) {
    await knex.schema.dropTable("manual_daily_reports");
  }
};
