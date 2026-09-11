const db = require('../db');
const traccar = require('./traccar');
const mspf = require('./mspf');
const { logger } = require('../middleware/logger');
const { invalidateSyncRulesCache } = require('./groupMembership');

async function syncSourceGroupNames() {
  try {
    const rules = await db('group_sync_rules').select('*');
    if (rules.length === 0) return;

    for (const rule of rules) {
      const parts = rule.source_group_id.split('_');
      const rawId = parseInt(parts[parts.length - 1], 10);
      if (isNaN(rawId)) continue;

      try {
        if (rule.source === 'traccar') {
          const groups = await traccar.getGroups({ all: true });
          const match = groups.find(g => g.id === rawId);
          if (match && match.name !== rule.source_group_name) {
            await db('group_sync_rules').where({ id: rule.id }).update({ source_group_name: match.name });
            invalidateSyncRulesCache();
          }
        } else if (rule.source === 'mspf') {
          const bc = await mspf.getBc(rawId);
          if (bc?.name && bc.name !== rule.source_group_name) {
            await db('group_sync_rules').where({ id: rule.id }).update({ source_group_name: bc.name });
            invalidateSyncRulesCache();
          }
        }
      } catch {}
    }
  } catch (err) {
    logger.warn(`Sync group names error: ${err.message}`);
  }
}

async function runAutoSync() {
  // Dynamic sync groups do not insert static rows into device_groups (Add Mandiri).
  // Membership is resolved dynamically via groupMembership service.
  invalidateSyncRulesCache();
  await syncSourceGroupNames();
}

module.exports = { runAutoSync, syncSourceGroupNames };
