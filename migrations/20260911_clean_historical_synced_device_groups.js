// Clean up historical auto-sync rows from device_groups so device_groups strictly holds manual additions (Add Mandiri).
// Synced group devices are now dynamically resolved via groupMembership service without polluting device_groups table.

exports.up = async function (knex) {
  const hasRules = await knex.schema.hasTable('group_sync_rules');
  const hasDeviceGroups = await knex.schema.hasTable('device_groups');
  if (!hasRules || !hasDeviceGroups) return;

  const rules = await knex('group_sync_rules').select('middleware_group_id', 'source', 'source_group_id');
  if (rules.length === 0) return;

  for (const rule of rules) {
    // Delete any rows previously dumped into device_groups by the legacy auto-sync worker
    await knex('device_groups')
      .where({
        group_id: rule.middleware_group_id,
        source: rule.source,
      })
      .delete();
  }
};

exports.down = async function () {
  // No rollback needed as synced devices are resolved dynamically at runtime
};
