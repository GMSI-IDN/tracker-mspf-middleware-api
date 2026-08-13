exports.up = function (knex) {
  return knex.schema.alterTable('users', (table) => {
    table.string('timezone').nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('users', (table) => {
    table.dropColumn('timezone');
  });
};
