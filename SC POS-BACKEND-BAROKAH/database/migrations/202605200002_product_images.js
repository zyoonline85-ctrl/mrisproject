exports.up = async function up(knex) {
  const hasImageUrl = await knex.schema.hasColumn("products", "image_url");
  const hasImagePath = await knex.schema.hasColumn("products", "image_path");

  if (!hasImageUrl || !hasImagePath) {
    await knex.schema.alterTable("products", (table) => {
      if (!hasImageUrl) table.string("image_url", 255).nullable();
      if (!hasImagePath) table.string("image_path", 255).nullable();
    });
  }
};

exports.down = async function down(knex) {
  const hasImageUrl = await knex.schema.hasColumn("products", "image_url");
  const hasImagePath = await knex.schema.hasColumn("products", "image_path");

  if (hasImageUrl || hasImagePath) {
    await knex.schema.alterTable("products", (table) => {
      if (hasImagePath) table.dropColumn("image_path");
      if (hasImageUrl) table.dropColumn("image_url");
    });
  }
};
