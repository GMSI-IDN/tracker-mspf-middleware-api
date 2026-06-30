exports.up = function (knex) {
  return knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.string('username').notNullable().unique();
    table.string('password_hash').notNullable();
    table.enu('role', ['admin', 'customer']).notNullable().defaultTo('customer');
    table.text('groups').notNullable().defaultTo('[]');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('users');
};
