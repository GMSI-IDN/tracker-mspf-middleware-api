exports.up = async function (knex) {
  const hasEmail = await knex.schema.hasColumn('users', 'email');
  if (!hasEmail) {
    await knex.schema.alterTable('users', (table) => {
      table.string('email').nullable().unique();
      table.string('first_name').nullable();
      table.string('last_name').nullable();
    });
  }
};

exports.down = async function (knex) {
  const hasEmail = await knex.schema.hasColumn('users', 'email');
  if (hasEmail) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('email');
      table.dropColumn('first_name');
      table.dropColumn('last_name');
    });
  }
};
