// ponytail: JSON column permissions ceiling: no cross-user relational queries on permissions -> upgrade path: relational role_permissions table if dynamic roles grow
// ponytail: single table command_logs ceiling: >10M rows/month -> upgrade path: time-series partitioning or stream to ClickHouse/OpenSearch

exports.up = async function (knex) {
  const hasPermissions = await knex.schema.hasColumn('users', 'permissions');
  if (!hasPermissions) {
    await knex.schema.alterTable('users', (table) => {
      table.text('permissions').notNullable().defaultTo('{"canCutEngine":false}');
    });
  }

  const hasCommandLogs = await knex.schema.hasTable('command_logs');
  if (!hasCommandLogs) {
    await knex.schema.createTable('command_logs', (table) => {
      table.increments('id').primary();
      table.integer('user_id').nullable();
      table.string('username').nullable();
      table.string('role').nullable();
      table.integer('device_id').notNullable();
      table.string('device_name').nullable();
      table.string('source').notNullable();
      table.string('command_type').notNullable();
      table.text('payload').nullable();
      table.boolean('confirmed').defaultTo(false);
      table.string('reason').nullable();
      table.string('status').notNullable(); // SUCCESS | FAILED | REJECTED
      table.text('error_message').nullable();
      table.string('ip_address').nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

      table.index(['device_id', 'created_at']);
      table.index(['user_id', 'created_at']);
    });
  }
};

exports.down = async function (knex) {
  const hasCommandLogs = await knex.schema.hasTable('command_logs');
  if (hasCommandLogs) {
    await knex.schema.dropTableIfExists('command_logs');
  }

  const hasPermissions = await knex.schema.hasColumn('users', 'permissions');
  if (hasPermissions) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('permissions');
    });
  }
};
