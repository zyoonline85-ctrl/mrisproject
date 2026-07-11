exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn("print_templates", "footer_text");
  if (!hasColumn) {
    await knex.schema.alterTable("print_templates", (table) => {
      table.text("footer_text").nullable();
    });
  }
};

exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn("print_templates", "footer_text");
  if (hasColumn) {
    await knex.schema.alterTable("print_templates", (table) => {
      table.dropColumn("footer_text");
    });
  }
};
