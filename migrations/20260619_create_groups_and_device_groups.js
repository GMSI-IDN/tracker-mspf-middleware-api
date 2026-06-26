exports.up = async function (knex) {
  const hasGroups = await knex.schema.hasTable('groups');
  const hasDeviceGroups = await knex.schema.hasTable('device_groups');
  if (hasGroups && hasDeviceGroups) return;

  await knex.schema.createTable('groups', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable().unique();
    table.string('description').defaultTo('');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('device_groups', (table) => {
    table.increments('id').primary();
    table.integer('device_id').notNullable();
    table.string('source').notNullable();
    table.integer('group_id').notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['device_id', 'source', 'group_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('device_groups');
  await knex.schema.dropTableIfExists('groups');
};
