exports.up = async function (knex) {
  const exists = await knex.schema.hasTable('group_sync_rules');
  if (exists) return;
  await knex.schema.createTable('group_sync_rules', (table) => {
    table.increments('id').primary();
    table.integer('middleware_group_id').notNullable().references('groups.id').onDelete('CASCADE');
    table.string('source').notNullable();
    table.string('source_group_id').notNullable();
    table.string('source_group_name').defaultTo('');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['middleware_group_id', 'source', 'source_group_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('group_sync_rules');
};
