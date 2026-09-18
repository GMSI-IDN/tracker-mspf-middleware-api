// ponytail: event_configs table ceiling: single flat table without per-tenant or per-user custom level overrides -> upgrade path: add tenant_id or user_id column if multi-tenant level customization needed
exports.up = async function (knex) {
  const exists = await knex.schema.hasTable('event_configs');
  if (exists) return;
  await knex.schema.createTable('event_configs', (table) => {
    table.increments('id').primary();
    table.string('source', 50).notNullable();
    table.string('event_key', 100).notNullable();
    table.bigInteger('external_id').nullable();
    table.string('event_type', 100).notNullable();
    table.string('original_name', 150).notNullable();
    table.string('custom_label', 150).nullable();
    table.string('level', 20).notNullable().defaultTo('info');
    table.string('color', 30).nullable();
    table.boolean('is_enabled').notNullable().defaultTo(true);
    table.timestamps(true, true);
    table.unique(['source', 'event_key']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('event_configs');
};
