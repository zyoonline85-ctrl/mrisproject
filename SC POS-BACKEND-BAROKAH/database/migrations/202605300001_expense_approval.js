exports.up = async function up(knex) {
  await knex.schema.alterTable("expenses", (table) => {
    table.string("status", 24).notNullable().defaultTo("approved");
    table.string("approved_by", 40).nullable().references("id").inTable("users");
    table.timestamp("approved_at").nullable();
    table.string("rejected_by", 40).nullable().references("id").inTable("users");
    table.timestamp("rejected_at").nullable();
    table.text("rejection_note").nullable();
    table.string("updated_by", 40).nullable().references("id").inTable("users");
    table.timestamp("updated_at").nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("expenses", (table) => {
    table.dropColumn("updated_at");
    table.dropColumn("updated_by");
    table.dropColumn("rejection_note");
    table.dropColumn("rejected_at");
    table.dropColumn("rejected_by");
    table.dropColumn("approved_at");
    table.dropColumn("approved_by");
    table.dropColumn("status");
  });
};
