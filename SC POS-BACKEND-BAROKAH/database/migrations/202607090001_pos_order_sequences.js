const TABLE_NAME = "pos_order_sequences";
const UNIQUE_NAME = "pos_order_sequences_outlet_id_sequence_date_unique";
const FK_NAME = "pos_order_sequences_outlet_id_foreign";

async function indexExists(knex, indexName) {
  const [rows] = await knex.raw(
    "SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1",
    [TABLE_NAME, indexName]
  );
  return rows.length > 0;
}

async function foreignKeyExists(knex, constraintName) {
  const [rows] = await knex.raw(
    "SELECT 1 FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? LIMIT 1",
    [TABLE_NAME, constraintName]
  );
  return rows.length > 0;
}

async function columnDefinition(knex, tableName, columnName) {
  const [rows] = await knex.raw(
    "SELECT COLUMN_TYPE, CHARACTER_SET_NAME, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1",
    [tableName, columnName]
  );
  return rows[0] || null;
}

function safeColumnToken(value) {
  if (!value || !/^[a-zA-Z0-9_(),]+$/.test(value)) {
    throw new Error(`Unsafe column definition token: ${value}`);
  }
  return value;
}

async function alignOutletForeignKeyColumn(knex) {
  const outletId = await columnDefinition(knex, "outlets", "id");
  if (!outletId) return;

  const columnType = safeColumnToken(outletId.COLUMN_TYPE);
  const charset = outletId.CHARACTER_SET_NAME
    ? ` CHARACTER SET ${safeColumnToken(outletId.CHARACTER_SET_NAME)}`
    : "";
  const collation = outletId.COLLATION_NAME
    ? ` COLLATE ${safeColumnToken(outletId.COLLATION_NAME)}`
    : "";

  await knex.raw("ALTER TABLE ?? ENGINE=InnoDB", [TABLE_NAME]);
  await knex.raw(
    `ALTER TABLE ?? MODIFY ?? ${columnType}${charset}${collation} NOT NULL`,
    [TABLE_NAME, "outlet_id"]
  );
}

exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable(TABLE_NAME);

  if (!exists) {
    await knex.schema.createTable(TABLE_NAME, (table) => {
      table.string("id", 40).primary();
      table.string("outlet_id", 40).notNullable();
      table.date("sequence_date").notNullable();
      table.integer("last_number").notNullable().defaultTo(0);
      table.timestamp("created_at").notNullable();
      table.timestamp("updated_at").notNullable();
    });
  } else {
    await knex.raw("ALTER TABLE ?? ENGINE=InnoDB", [TABLE_NAME]);
  }

  await alignOutletForeignKeyColumn(knex);

  if (!(await indexExists(knex, UNIQUE_NAME))) {
    await knex.schema.alterTable(TABLE_NAME, (table) => {
      table.unique(["outlet_id", "sequence_date"], UNIQUE_NAME);
    });
  }

  if (!(await foreignKeyExists(knex, FK_NAME))) {
    await knex.schema.alterTable(TABLE_NAME, (table) => {
      table.foreign("outlet_id", FK_NAME).references("id").inTable("outlets").onDelete("CASCADE");
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE_NAME);
};
