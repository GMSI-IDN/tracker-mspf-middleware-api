exports.up = async function (knex) {
  const exists = await knex.schema.hasTable('custom_attribute_rules');
  if (exists) return;
  await knex.schema.createTable('custom_attribute_rules', (table) => {
    table.increments('id').primary();
    table.integer('group_id').notNullable().references('groups.id').onDelete('CASCADE');
    table.string('name').notNullable();
    table.string('source_field').nullable();
    table.string('mode').notNullable().defaultTo('passthrough');
    table.text('formula').nullable();
    table.boolean('default_visible').defaultTo(true);
    table.boolean('enabled').defaultTo(true);
    table.integer('priority').defaultTo(0);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('custom_attribute_rules');
};
