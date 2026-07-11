exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable("activity_logs");
  if (!exists) return;

  const columns = [
    ["event_type", (table) => table.string("event_type", 24).notNullable().defaultTo("business")],
    ["outcome", (table) => table.string("outcome", 24).notNullable().defaultTo("succeeded")],
    ["occurred_at", (table) => table.timestamp("occurred_at").nullable()],
    ["received_at", (table) => table.timestamp("received_at").nullable()],
    ["client_event_id", (table) => table.string("client_event_id", 80).nullable()],
    ["correlation_id", (table) => table.string("correlation_id", 80).nullable()]
  ];

  for (const [name, add] of columns) {
    if (!(await knex.schema.hasColumn("activity_logs", name))) {
      await knex.schema.alterTable("activity_logs", add);
    }
  }

  await knex("activity_logs").whereNull("occurred_at").update({ occurred_at: knex.ref("created_at") });
  await knex("activity_logs").whereNull("received_at").update({ received_at: knex.ref("created_at") });

  await knex.schema.alterTable("activity_logs", (table) => {
    table.unique(["client_event_id"], { indexName: "activity_logs_client_event_unique" });
    table.index(["event_type", "outcome", "occurred_at"], "activity_logs_type_outcome_time_idx");
    table.index(["correlation_id"], "activity_logs_correlation_idx");
  });
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable("activity_logs"))) return;
  await knex.schema.alterTable("activity_logs", (table) => {
    table.dropUnique(["client_event_id"], "activity_logs_client_event_unique");
    table.dropIndex(["event_type", "outcome", "occurred_at"], "activity_logs_type_outcome_time_idx");
    table.dropIndex(["correlation_id"], "activity_logs_correlation_idx");
    table.dropColumns("event_type", "outcome", "occurred_at", "received_at", "client_event_id", "correlation_id");
  });
};
