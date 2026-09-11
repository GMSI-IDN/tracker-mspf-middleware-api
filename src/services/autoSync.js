const db = require('../db');
const traccar = require('./traccar');
const mspf = require('./mspf');
const { logger } = require('../middleware/logger');

async function fetchTraccarDevices(groupId) {
  try {
    const data = await traccar.getDevices({ all: true });
    return (data || [])
      .filter(d => d.groupId === groupId)
      .map(d => ({ device_id: d.id, source: 'traccar' }));
  } catch {
    return [];
  }
}

async function fetchMspfDevices(bcId) {
  try {
    if (mspf.waitForInit) await mspf.waitForInit();
    const data = await mspf.getDevices({ 'bc[]': [bcId] });
    return (data.data || []).map(d => ({ device_id: d.id, source: 'mspf' }));
  } catch {
    return [];
  }
}

async function runAutoSync() {
  try {
    const rules = await db('group_sync_rules').select('*');
    if (rules.length === 0) return;

    let totalInserted = 0;
    for (const rule of rules) {
      const parts = rule.source_group_id.split('_');
      const rawId = parseInt(parts[parts.length - 1], 10);
      if (isNaN(rawId)) continue;

      const devices = rule.source === 'traccar'
        ? await fetchTraccarDevices(rawId)
        : await fetchMspfDevices(rawId);

      for (const d of devices) {
        try {
          await db('device_groups').insert({
            device_id: d.device_id,
            source: d.source,
            group_id: rule.middleware_group_id,
          }).onConflict(['device_id', 'source', 'group_id']).ignore();
          totalInserted++;
        } catch {}
      }

      // Update source group name if needed
      try {
        if (rule.source === 'traccar') {
          const groups = await traccar.getGroups({ all: true });
          const match = groups.find(g => g.id === rawId);
          if (match && match.name !== rule.source_group_name) {
            await db('group_sync_rules').where({ id: rule.id }).update({ source_group_name: match.name });
          }
        } else {
          const bc = await mspf.getBc(rawId);
          if (bc?.name && bc.name !== rule.source_group_name) {
            await db('group_sync_rules').where({ id: rule.id }).update({ source_group_name: bc.name });
          }
        }
      } catch {}
    }

    logger.info(`Auto-sync: ${totalInserted} device(s) processed from ${rules.length} rule(s)`);
  } catch (err) {
    logger.warn(`Auto-sync error: ${err.message}`);
  }
}

module.exports = { runAutoSync, fetchTraccarDevices, fetchMspfDevices };
