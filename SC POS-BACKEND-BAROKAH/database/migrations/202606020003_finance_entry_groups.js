exports.up = async function up(knex) {
  const hasGroups = await knex.schema.hasTable("finance_entry_groups");
  if (!hasGroups) {
    await knex.schema.createTable("finance_entry_groups", (table) => {
      table.string("id", 80).primary();
      table.string("name", 160).notNullable();
      table.string("account_code", 24).notNullable();
      table.string("group", 80).notNullable();
      table.string("outlet_id", 40).nullable().references("id").inTable("outlets");
      table.text("note").nullable();
      table.string("status", 24).notNullable().defaultTo("active");
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.timestamp("updated_at").nullable();
      table.index(["account_code"]);
      table.index(["outlet_id"]);
      table.unique(["name", "account_code", "outlet_id"], "finance_entry_groups_unique_pos");
    });
  }

  const hasFinanceGroupId = await knex.schema.hasColumn("balance_sheet_entries", "finance_group_id");
  if (!hasFinanceGroupId) {
    await knex.schema.alterTable("balance_sheet_entries", (table) => {
      table.string("finance_group_id", 80).nullable().index();
    });
  }
};

exports.down = async function down(knex) {
  const hasEntries = await knex.schema.hasTable("balance_sheet_entries");
  if (hasEntries) {
    const hasFinanceGroupId = await knex.schema.hasColumn("balance_sheet_entries", "finance_group_id");
    if (hasFinanceGroupId) {
      await knex.schema.alterTable("balance_sheet_entries", (table) => {
        table.dropColumn("finance_group_id");
      });
    }
  }
  await knex.schema.dropTableIfExists("finance_entry_groups");
};
