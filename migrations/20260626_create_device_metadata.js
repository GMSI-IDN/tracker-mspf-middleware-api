exports.up = async function (knex) {
  const exists = await knex.schema.hasTable('device_metadata');
  if (exists) return;
  await knex.schema.createTable('device_metadata', (table) => {
    table.integer('device_id').notNullable();
    table.string('source').notNullable();
    table.text('data').notNullable().defaultTo('{}');
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.primary(['device_id', 'source']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('device_metadata');
};
