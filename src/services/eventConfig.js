// ponytail: in-memory event configs map ceiling: multi-instance node cluster without pubsub cache invalidation -> upgrade path: Redis pub/sub for cross-instance event_configs cache sync
const db = require('../db');
const traccar = require('./traccar');
const mspf = require('./mspf');

let configCacheMap = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 60000;

const TRACCAR_CATALOG = [
  { eventType: 'ignitionOn', originalName: 'Ignition ON', defaultLevel: 'success', defaultColor: '#10B981' },
  { eventType: 'ignitionOff', originalName: 'Ignition OFF', defaultLevel: 'info', defaultColor: '#3B82F6' },
  { eventType: 'geofenceEnter', originalName: 'Geofence Enter', defaultLevel: 'warning', defaultColor: '#F59E0B' },
  { eventType: 'geofenceExit', originalName: 'Geofence Exit', defaultLevel: 'warning', defaultColor: '#F59E0B' },
  { eventType: 'overspeed', originalName: 'Overspeed', defaultLevel: 'danger', defaultColor: '#EF4444' },
  { eventType: 'alarm', originalName: 'Alarm', defaultLevel: 'danger', defaultColor: '#EF4444' },
  { eventType: 'deviceMoving', originalName: 'Device Moving', defaultLevel: 'info', defaultColor: '#3B82F6' },
  { eventType: 'deviceStopped', originalName: 'Device Stopped', defaultLevel: 'info', defaultColor: '#3B82F6' },
  { eventType: 'deviceOnline', originalName: 'Device Online', defaultLevel: 'success', defaultColor: '#10B981' },
  { eventType: 'deviceOffline', originalName: 'Device Offline', defaultLevel: 'warning', defaultColor: '#F59E0B' },
  { eventType: 'maintenance', originalName: 'Maintenance', defaultLevel: 'warning', defaultColor: '#F59E0B' },
  { eventType: 'driverChanged', originalName: 'Driver Changed', defaultLevel: 'info', defaultColor: '#3B82F6' },
  { eventType: 'commandResult', originalName: 'Command Result', defaultLevel: 'info', defaultColor: '#6B7280' },
  { eventType: 'textMessage', originalName: 'Text Message', defaultLevel: 'info', defaultColor: '#3B82F6' },
  { eventType: 'deviceUnknown', originalName: 'Device Unknown', defaultLevel: 'info', defaultColor: '#6B7280' },
];

const FOXLOGGER_CATALOG = [
  { eventType: 'Power Cut Alarm', originalName: 'Power Cut Alarm', defaultLevel: 'danger', defaultColor: '#EF4444' },
  { eventType: 'Fuel Steal Alarm', originalName: 'Fuel Steal Alarm', defaultLevel: 'danger', defaultColor: '#EF4444' },
];

function getDefaultLevelAndColor(type = '') {
  const t = String(type).toLowerCase();
  if (t === 'alarm' || t === 'overspeed' || t.includes('sos') || t.includes('cut') || t.includes('steal') || t.includes('crash') || t.includes('danger')) {
    return { level: 'danger', color: '#EF4444' };
  }
  if (t.includes('geofence') || t === 'deviceoffline' || t === 'maintenance' || t.includes('battery') || t.includes('volt') || t.includes('warning')) {
    return { level: 'warning', color: '#F59E0B' };
  }
  if (t === 'ignitionon' || t === 'deviceonline' || t.includes('resume')) {
    return { level: 'success', color: '#10B981' };
  }
  return { level: 'info', color: '#3B82F6' };
}

async function loadConfigCache(force = false) {
  const now = Date.now();
  if (!force && configCacheMap && (now - lastCacheTime < CACHE_TTL_MS)) {
    return configCacheMap;
  }
  try {
    const rows = await db('event_configs').select('*');
    const map = new Map();
    for (const r of rows) {
      map.set(`${r.source}:${r.event_key}`, r);
      if (r.external_id) {
        map.set(`${r.source}:id:${r.external_id}`, r);
      }
      map.set(`${r.source}:${r.event_type}`, r);
    }
    configCacheMap = map;
    lastCacheTime = now;
    return map;
  } catch (err) {
    if (!configCacheMap) configCacheMap = new Map();
    return configCacheMap;
  }
}

function resolveConfig(source, eventKeyOrType, externalId) {
  const map = configCacheMap || new Map();
  let conf = null;

  if (externalId && map.has(`${source}:id:${externalId}`)) {
    conf = map.get(`${source}:id:${externalId}`);
  } else if (map.has(`${source}:${eventKeyOrType}`)) {
    conf = map.get(`${source}:${eventKeyOrType}`);
  }

  if (conf) {
    const isEnabled = !(conf.is_enabled === false || conf.is_enabled === 0 || conf.is_enabled === '0');
    return {
      level: conf.level,
      color: conf.color || getDefaultLevelAndColor(eventKeyOrType).color,
      customLabel: conf.custom_label || null,
      isEnabled,
      configured: true,
    };
  }

  const def = getDefaultLevelAndColor(eventKeyOrType);
  return {
    level: def.level,
    color: def.color,
    customLabel: null,
    isEnabled: true,
    configured: false,
  };
}

async function getEventCatalog() {
  const [dbRows, mspfMonitors, traccarGeofences] = await Promise.all([
    db('event_configs').select('*').catch(() => []),
    Promise.resolve(mspf.getMonitors?.()).catch(() => []),
    Promise.resolve(traccar.getGeofences?.()).catch(() => []),
  ]);

  const savedMap = new Map();
  for (const r of dbRows) {
    savedMap.set(`${r.source}:${r.event_key}`, r);
  }

  const catalog = [];

  // 1. Traccar Standard Events
  for (const item of TRACCAR_CATALOG) {
    const key = `${item.eventType}`;
    const saved = savedMap.get(`traccar:${key}`);
    catalog.push({
      source: 'traccar',
      eventKey: key,
      externalId: null,
      eventType: item.eventType,
      originalName: item.originalName,
      customLabel: saved?.custom_label || null,
      level: saved?.level || item.defaultLevel,
      color: saved?.color || item.defaultColor,
      isEnabled: saved ? saved.is_enabled !== false : true,
      configured: Boolean(saved),
    });
  }

  // 2. Traccar Geofences (Zone specific)
  if (Array.isArray(traccarGeofences)) {
    for (const g of traccarGeofences) {
      if (!g.id) continue;
      const key = `geofence:${g.id}`;
      const saved = savedMap.get(`traccar:${key}`);
      catalog.push({
        source: 'traccar',
        eventKey: key,
        externalId: g.id,
        eventType: 'geofence',
        originalName: g.name || `Geofence ${g.id}`,
        customLabel: saved?.custom_label || null,
        level: saved?.level || 'warning',
        color: saved?.color || '#F59E0B',
        isEnabled: saved ? saved.is_enabled !== false : true,
        configured: Boolean(saved),
      });
    }
  }

  // 3. MSPF Monitors
  if (Array.isArray(mspfMonitors)) {
    for (const m of mspfMonitors) {
      const monitorId = m.id || m.monitorId;
      if (!monitorId) continue;
      const key = `monitor:${monitorId}`;
      const saved = savedMap.get(`mspf:${key}`);
      const def = getDefaultLevelAndColor(m.name || 'monitor');
      catalog.push({
        source: 'mspf',
        eventKey: key,
        externalId: monitorId,
        eventType: 'monitor',
        originalName: m.name || `Monitor ${monitorId}`,
        customLabel: saved?.custom_label || null,
        level: saved?.level || def.level,
        color: saved?.color || def.color,
        isEnabled: saved ? saved.is_enabled !== false : true,
        configured: Boolean(saved),
      });
    }
  }

  // 4. FoxLogger Alarms
  for (const item of FOXLOGGER_CATALOG) {
    const key = `alarm:${item.eventType}`;
    const saved = savedMap.get(`foxlogger:${key}`);
    catalog.push({
      source: 'foxlogger',
      eventKey: key,
      externalId: null,
      eventType: 'alarm',
      originalName: item.originalName,
      customLabel: saved?.custom_label || null,
      level: saved?.level || item.defaultLevel,
      color: saved?.color || item.defaultColor,
      isEnabled: saved ? saved.is_enabled !== false : true,
      configured: Boolean(saved),
    });
  }

  return catalog;
}

async function getSavedConfigs() {
  return db('event_configs').select('*').orderBy('source').orderBy('event_type');
}

async function upsertEventConfig(configItem) {
  const { source, eventKey, externalId, eventType, originalName, customLabel, level, color, isEnabled } = configItem;
  if (!source || !eventKey || !eventType) {
    throw new Error('source, eventKey, and eventType are required');
  }

  const existing = await db('event_configs').where({ source, event_key: eventKey }).first();
  const payload = {
    source,
    event_key: eventKey,
    external_id: externalId ? parseInt(externalId, 10) : null,
    event_type: eventType,
    original_name: originalName || eventKey,
    custom_label: customLabel !== undefined ? customLabel : (existing?.custom_label ?? null),
    level: level || existing?.level || 'info',
    color: color !== undefined ? color : (existing?.color ?? null),
    is_enabled: isEnabled !== undefined ? Boolean(isEnabled) : (existing ? existing.is_enabled !== false : true),
    updated_at: new Date(),
  };

  if (existing) {
    await db('event_configs').where({ id: existing.id }).update(payload);
  } else {
    payload.created_at = new Date();
    await db('event_configs').insert(payload);
  }

  await loadConfigCache(true);
}

async function upsertBatchEventConfigs(items) {
  if (!Array.isArray(items)) throw new Error('items must be an array');
  for (const item of items) {
    await upsertEventConfig(item);
  }
  await loadConfigCache(true);
}

module.exports = {
  loadConfigCache,
  resolveConfig,
  getEventCatalog,
  getSavedConfigs,
  upsertEventConfig,
  upsertBatchEventConfigs,
  getDefaultLevelAndColor,
};
