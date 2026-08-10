exports.up = async function (knex) {
  const exists = await knex.schema.hasTable('device_metadata');
  const hasOwner = exists && await knex.schema.hasColumn('device_metadata', 'owner');
  if (hasOwner) return;

  await knex.schema.createTable('device_metadata_new', (table) => {
    table.integer('device_id').notNullable();
    table.string('source').notNullable();
    table.string('owner').notNullable().defaultTo('admin');
    table.text('data').notNullable().defaultTo('{}');
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.integer('updated_by').nullable();
    table.primary(['device_id', 'source', 'owner']);
  });

  if (exists) {
    const rows = await knex('device_metadata').select('*');
    if (rows.length > 0) {
      await knex('device_metadata_new').insert(rows.map(r => ({
        device_id: r.device_id,
        source: r.source,
        owner: 'admin',
        data: r.data,
        updated_at: r.updated_at,
        updated_by: null,
      })));
    }
    await knex.schema.dropTableIfExists('device_metadata');
  }

  await knex.schema.renameTable('device_metadata_new', 'device_metadata');
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('device_metadata');
  await knex.schema.createTable('device_metadata', (table) => {
    table.integer('device_id').notNullable();
    table.string('source').notNullable();
    table.text('data').notNullable().defaultTo('{}');
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.primary(['device_id', 'source']);
  });
};
