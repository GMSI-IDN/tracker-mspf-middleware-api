const db = require('../db');
const cache = require('./cache');

const SYNC_RULES_CACHE_KEY = 'rules:group_sync';
const ALL_GROUPS_CACHE_KEY = 'cache:all_groups';

async function getActiveSyncRules() {
  let rules = cache.get(SYNC_RULES_CACHE_KEY);
  if (!rules) {
    rules = await db('group_sync_rules').select('id', 'middleware_group_id', 'source', 'source_group_id', 'source_group_name');
    cache.set(SYNC_RULES_CACHE_KEY, rules, 60);
  }
  return rules;
}

function invalidateSyncRulesCache() {
  cache.del(SYNC_RULES_CACHE_KEY);
}

async function getAllGroups() {
  let groups = cache.get(ALL_GROUPS_CACHE_KEY);
  if (!groups) {
    groups = await db('groups').select('id', 'name', 'description');
    cache.set(ALL_GROUPS_CACHE_KEY, groups, 60);
  }
  return groups;
}

function invalidateGroupsCache() {
  cache.del(ALL_GROUPS_CACHE_KEY);
}

// Check if a device belongs to a specific sync rule
function deviceMatchesSyncRule(device, rule) {
  if (!device || !rule || device.source !== rule.source) return false;

  // Match by device.group string (e.g. 'mspf_10000023' or 'traccar_10')
  if (device.group && device.group === rule.source_group_id) return true;

  // Fallback match by raw group/BC ID
  const parts = String(rule.source_group_id || '').split('_');
  const rawId = parts[parts.length - 1];
  if (!rawId) return false;

  if (device.source === 'mspf') {
    const devBc = device.attributes?.bcId ?? device.bcId;
    if (devBc !== undefined && String(devBc) === rawId) return true;
  } else if (device.source === 'traccar') {
    const devGroupId = device.groupId;
    if (devGroupId !== undefined && String(devGroupId) === rawId) return true;
  }

  return false;
}

// Get set of allowed device keys ("source:id") for given custom group IDs
async function getAllowedDeviceKeys(groupIds) {
  if (!groupIds || groupIds.length === 0) return new Set();

  const allowed = new Set();
  const groupSet = new Set(groupIds.map(id => parseInt(id, 10)));

  // 1. Manual additions in device_groups
  const manualRows = await db('device_groups')
    .whereIn('group_id', Array.from(groupSet))
    .select('device_id', 'source');
  for (const m of manualRows) {
    allowed.add(`${m.source}:${m.device_id}`);
  }

  // 2. Dynamic group sync rules
  const syncRules = await getActiveSyncRules();
  const activeRules = syncRules.filter(r => groupSet.has(parseInt(r.middleware_group_id, 10)));

  if (activeRules.length > 0) {
    const allDevices = cache.get('devices:merged') || [];
    for (const d of allDevices) {
      for (const rule of activeRules) {
        if (deviceMatchesSyncRule(d, rule)) {
          allowed.add(`${d.source}:${d.id}`);
          break;
        }
      }
    }
  }

  return allowed;
}

// Check if a single device is allowed for a user's custom groups
async function isDeviceAllowedForGroups(deviceId, source, userGroupIds) {
  if (!userGroupIds || userGroupIds.length === 0) return false;

  const idNum = parseInt(deviceId, 10);
  const groupSet = new Set(userGroupIds.map(id => parseInt(id, 10)));

  // 1. Check manual addition in device_groups
  const manual = await db('device_groups')
    .where({ device_id: idNum, source })
    .whereIn('group_id', Array.from(groupSet))
    .first();
  if (manual) return true;

  // 2. Check dynamic group sync rules
  const syncRules = await getActiveSyncRules();
  const activeRules = syncRules.filter(r => groupSet.has(parseInt(r.middleware_group_id, 10)) && r.source === source);
  if (activeRules.length === 0) return false;

  let allDevices = cache.get('devices:merged');
  let devObj = null;
  if (allDevices && allDevices.length > 0) {
    devObj = allDevices.find(d => (d.id === idNum || String(d.id) === String(deviceId)) && d.source === source);
  } else {
    // If cache not yet populated, fetch single device directly to inspect upstream group
    if (source === 'traccar') {
      const traccar = require('./traccar');
      const devs = await traccar.getDevices({ id: idNum }).catch(() => []);
      if (devs[0]) devObj = { id: devs[0].id, source: 'traccar', group: `traccar_${devs[0].groupId}`, groupId: devs[0].groupId };
    } else if (source === 'mspf') {
      const mspf = require('./mspf');
      const d = await mspf.getDevice(idNum).catch(() => null);
      if (d) devObj = { id: d.id, source: 'mspf', group: d.group || `mspf_${d.bcId || d.attributes?.bcId}`, bcId: d.bcId || d.attributes?.bcId };
    }
  }

  if (devObj) {
    for (const rule of activeRules) {
      if (deviceMatchesSyncRule(devObj, rule)) return true;
    }
  }

  return false;
}

// Enrich devices with customGroups array and filter according to access rules
async function enrichAndFilterDevices(devices, targetGroupIds = null, isUserAdmin = false) {
  if (!devices || devices.length === 0) return [];

  const [syncRules, allGroups, manualRows] = await Promise.all([
    getActiveSyncRules(),
    getAllGroups(),
    db('device_groups').select('device_id', 'source', 'group_id'),
  ]);

  const groupNameMap = new Map(allGroups.map(g => [parseInt(g.id, 10), g.name]));

  // Index manual mappings: key "source:device_id" -> Set of group_ids
  const manualMap = new Map();
  for (const row of manualRows) {
    const k = `${row.source}:${row.device_id}`;
    if (!manualMap.has(k)) manualMap.set(k, new Set());
    manualMap.get(k).add(parseInt(row.group_id, 10));
  }

  const allowedGroupSet = targetGroupIds ? new Set(targetGroupIds.map(id => parseInt(id, 10))) : null;
  const filtered = [];

  for (const d of devices) {
    const customGroupIds = new Set();

    // A. Manual additions from device_groups
    const k = `${d.source}:${d.id}`;
    const manualGids = manualMap.get(k);
    if (manualGids) {
      for (const gid of manualGids) {
        if (!allowedGroupSet || allowedGroupSet.has(gid)) {
          customGroupIds.add(gid);
        }
      }
    }

    // B. Dynamic group sync rules
    if (syncRules.length > 0) {
      for (const rule of syncRules) {
        if (deviceMatchesSyncRule(d, rule)) {
          const ruleGid = parseInt(rule.middleware_group_id, 10);
          if (!allowedGroupSet || allowedGroupSet.has(ruleGid)) {
            customGroupIds.add(ruleGid);
          }
        }
      }
    }

    // If filtering by specific groups (customer or admin ?group=X), device must belong to at least one target group
    if (allowedGroupSet && customGroupIds.size === 0) {
      continue;
    }

    // Attach customGroups array
    const customGroups = [];
    for (const gid of customGroupIds) {
      const gname = groupNameMap.get(gid) || `Group ${gid}`;
      customGroups.push({ id: gid, name: gname });
    }
    d.customGroups = customGroups;
    filtered.push(d);
  }

  return filtered;
}

module.exports = {
  getActiveSyncRules,
  invalidateSyncRulesCache,
  getAllGroups,
  invalidateGroupsCache,
  deviceMatchesSyncRule,
  getAllowedDeviceKeys,
  isDeviceAllowedForGroups,
  enrichAndFilterDevices,
};
