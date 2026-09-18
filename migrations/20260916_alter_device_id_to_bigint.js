// ponytail: device_id as bigint ceiling: alphanumeric non-numeric device IDs -> upgrade path: text/varchar device_id migration if hardware vendor uses alphanumeric serials instead of IMEI/integers

exports.up = async function (knex) {
  const isPg = knex.client.config.client === 'pg' || knex.client.dialect === 'postgresql';
  if (!isPg) return;

  const tables = ['device_metadata', 'device_groups', 'command_logs'];
  for (const table of tables) {
    const exists = await knex.schema.hasTable(table);
    if (exists) {
      await knex.raw(`ALTER TABLE "${table}" ALTER COLUMN "device_id" TYPE BIGINT`);
    }
  }
};

exports.down = async function (knex) {
  const isPg = knex.client.config.client === 'pg' || knex.client.dialect === 'postgresql';
  if (!isPg) return;

  const tables = ['device_metadata', 'device_groups', 'command_logs'];
  for (const table of tables) {
    const exists = await knex.schema.hasTable(table);
    if (exists) {
      await knex.raw(`ALTER TABLE "${table}" ALTER COLUMN "device_id" TYPE INTEGER`);
    }
  }
};
