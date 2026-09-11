exports.up = async function (knex) {
  const hasActive = await knex.schema.hasColumn('users', 'is_active');
  if (!hasActive) {
    await knex.schema.alterTable('users', (table) => {
      table.boolean('is_active').notNullable().defaultTo(true);
      table.integer('token_version').notNullable().defaultTo(1);
    });
  }
};

exports.down = async function (knex) {
  const hasActive = await knex.schema.hasColumn('users', 'is_active');
  if (hasActive) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('is_active');
      table.dropColumn('token_version');
    });
  }
};
