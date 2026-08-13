const cache = require('./cache');
const traccar = require('./traccar');
const mspf = require('./mspf');
const foxlogger = require('./foxlogger');
const deviceRouter = require('./deviceRouter');
const config = require('../config');
const { logger } = require('../middleware/logger');
const { statusTracker } = require('../utils/liveStatus');

const mspfBcCache = { ids: [], ts: 0 };
const MSPF_BC_CACHE_TTL = 300000;

let emitHooks = { onPosition: null, onStatus: null };
let lastHeartbeatAt = 0;

function setEmitHooks(hooks = {}) {
  emitHooks.onPosition = hooks.onPosition || null;
  emitHooks.onStatus = hooks.onStatus || null;
}

function getMspfBcIds() {
  const merged = cache.get('devices:merged');
  if (!merged) return [];
  return [...new Set(merged
    .filter(d => d.source === 'mspf' && d.group)
    .map(d => parseInt(d.group.replace('mspf_', ''), 10))
  )];
}

function getActiveIds(source) {
  const merged = cache.get('devices:merged');
  if (!merged) return null;
  return new Set(merged.filter(d => d.source === source).map(d => d.id));
}

function getActiveFoxloggerIds() {
  const merged = cache.get('devices:merged');
  if (!merged) return null;
  return new Set(merged.filter(d => d.source === 'foxlogger').map(d => d.id));
}

function normalizePosition(p) {
  return {
    ...p,
    voltage: p.attributes?.power ?? p.attributes?.voltage ?? p.attributes?.volt ?? undefined,
    internalBattery: p.attributes?.addr_IB ?? p.attributes?.battery ?? undefined,
    batteryLevel: p.attributes?.batteryLevel ?? undefined,
    ignition: p.attributes?.ignition ?? undefined,
  };
}

async function getBcIdsFallback() {
  if (Date.now() - mspfBcCache.ts < MSPF_BC_CACHE_TTL) return mspfBcCache.ids;
  try {
    const bcs = await mspf.getBcList();
    const ids = (bcs?.data || bcs || []).map(b => b.id).filter(Boolean);
    mspfBcCache.ids = ids;
    mspfBcCache.ts = Date.now();
    logger.info(`[PositionSync] BC IDs from API: ${ids.join(', ')}`);
    return ids;
  } catch { return []; }
}

async function feedAndEmit(positions) {
  if (!emitHooks.onPosition && !emitHooks.onStatus) return;
  const now = Date.now();
  const tasks = [];
  for (const p of positions) {
    if (!p.deviceId) continue;
    const thresholds = statusTracker.resolveThresholds(p.source);
    tasks.push((async () => {
      const res = statusTracker.notePosition(p, { now, ...thresholds });
      const isPolled = p.source === 'mspf' || p.source === 'foxlogger';
      if (isPolled && res.shouldEmitPos && emitHooks.onPosition) {
        await emitHooks.onPosition(p);
      }
      if (res.statusChanged && res.status === 'online' && emitHooks.onStatus) {
        await emitHooks.onStatus({ deviceId: p.deviceId, source: p.source, status: 'online', lastUpdate: p.deviceTime });
      }
    })());
  }
  const CHUNK = 10;
  for (let i = 0; i < tasks.length; i += CHUNK) {
    await Promise.allSettled(tasks.slice(i, i + CHUNK));
  }
}

async function evaluateOffline() {
  if (!emitHooks.onStatus) return;
  const merged = cache.get('devices:merged');
  if (!merged) return;
  const now = Date.now();
  const tasks = [];
  for (const d of merged) {
    if (!d.id || !d.source) continue;
    const thresholds = statusTracker.resolveThresholds(d.source);
    tasks.push((async () => {
      const lastKnown = statusTracker.getLastKnownTime(d.id, d.source) || (d.lastUpdate ? new Date(d.lastUpdate).getTime() : 0);
      const transition = statusTracker.evaluateStale(d.id, d.source, lastKnown, { now, ...thresholds });
      if (transition === 'offline' && emitHooks.onStatus) {
        await emitHooks.onStatus({ deviceId: d.id, source: d.source, status: 'offline', lastUpdate: d.lastUpdate });
      }
    })());
  }
  const CHUNK = 10;
  for (let i = 0; i < tasks.length; i += CHUNK) {
    await Promise.allSettled(tasks.slice(i, i + CHUNK));
  }
}

function maybeHeartbeat() {
  if (!emitHooks.onStatus) return;
  if (config.live.heartbeatMs <= 0) return;
  const now = Date.now();
  if (now - lastHeartbeatAt < config.live.heartbeatMs) return;
  lastHeartbeatAt = now;
  const devices = statusTracker.heartbeatDevices();
  for (const d of devices) {
    try {
      emitHooks.onStatus({
        deviceId: d.deviceId,
        source: d.source,
        status: d.status,
        lastUpdate: d.lastKnownTime > 0 ? new Date(d.lastKnownTime).toISOString() : undefined,
      });
    } catch {}
  }
}

async function syncPositions() {
  let bcIds = getMspfBcIds();
  if (bcIds.length === 0) {
    bcIds = await getBcIdsFallback();
    if (bcIds.length === 0) {
      logger.warn('[PositionSync] no BC IDs (device cache + API both failed), skipping...');
      await evaluateOffline();
      maybeHeartbeat();
      return;
    }
  }

  let merged = cache.get('devices:merged');
  let expT = merged?.filter(d => d.source === 'traccar').length || 0;
  let expM = merged?.filter(d => d.source === 'mspf').length || 0;
  let expF = merged?.filter(d => d.source === 'foxlogger').length || 0;
  let actT = 0, actM = 0, actF = 0;

  const [traccarResult, mspfResult, foxloggerResult] = await Promise.allSettled([
    traccar.getPositions(),
    mspf.getPositions({ limit: 1000, bc: bcIds }),
    foxlogger.getPositions(),
  ]);

  let positions = [];
  let useStale = false;
  if (mspfResult.status !== 'fulfilled') {
    logger.warn(`[PositionSync] MSPF failed: ${mspfResult.reason?.message || 'unknown error'}`);
    const old = cache.get('positions:merged');
    if (old && old.length > 0) {
      positions = old;
      useStale = true;
    }
  }

  if (!useStale) {
    const now = new Date().toISOString();

    if (traccarResult.status === 'fulfilled' && traccarResult.value) {
      for (const p of traccarResult.value) {
        positions.push(normalizePosition({ ...p, serverTime: p.serverTime || now, source: 'traccar' }));
        actT++;
      }
    }

    if (mspfResult.status === 'fulfilled' && mspfResult.value) {
      let activeIds = getActiveIds('mspf');
      if (!activeIds) {
        logger.warn('[PositionSync] device cache expired, rebuilding...');
        const [t, m, f] = await Promise.allSettled([
          traccar.getDevices({ all: true }),
          mspf.waitForInit().then(() => mspf.getDevices()),
          foxlogger.waitForInit().then(() => foxlogger.getDevices()),
        ]);
        const rebuild = [];
        if (t.status === 'fulfilled' && t.value) {
          for (const d of t.value) rebuild.push({ id: d.id, name: d.name, uniqueId: d.uniqueId, status: d.status || 'offline', source: 'traccar', group: `traccar_${d.groupId}`, lastUpdate: d.lastUpdate || (d.attributes?.motionTime ? new Date(d.attributes.motionTime).toISOString() : undefined), voltage: d.attributes?.power ?? undefined, attributes: d.attributes || {} });
        }
        if (m.status === 'fulfilled' && m.value?.data) rebuild.push(...m.value.data);
        if (f.status === 'fulfilled' && f.value?.data) rebuild.push(...f.value.data);
        rebuild.sort((a, b) => {
          const aId = String(a.id).padStart(20, '0');
          const bId = String(b.id).padStart(20, '0');
          if (aId !== bId) return aId < bId ? -1 : 1;
          if (a.source < b.source) return -1;
          if (a.source > b.source) return 1;
          return 0;
        });
        deviceRouter.buildDeviceMap(rebuild);
        cache.set('devices:merged', rebuild, config.cache.ttl || 120);
        logger.info(`Device cache rebuilt: ${rebuild.length} devices`);
        merged = rebuild;
        expT = merged.filter(d => d.source === 'traccar').length;
        expM = merged.filter(d => d.source === 'mspf').length;
        activeIds = new Set(merged.filter(d => d.source === 'mspf').map(d => d.id));
      }
      if (activeIds && activeIds.size > 0) {
        for (const p of mspfResult.value) {
          if (activeIds.has(p.deviceId)) {
            positions.push(normalizePosition({ ...p, serverTime: p.serverTime || now, source: 'mspf' }));
            actM++;
          }
        }
      }
    }

    if (foxloggerResult.status === 'fulfilled' && foxloggerResult.value) {
      let foxActiveIds = getActiveFoxloggerIds();
      if (foxActiveIds && foxActiveIds.size > 0) {
        const foxPosByImei = {};
        for (const p of foxloggerResult.value) foxPosByImei[p.deviceId] = p;
        for (const imei of foxActiveIds) {
          const pos = foxPosByImei[imei];
          if (pos) {
            positions.push(normalizePosition({ ...pos, serverTime: pos.serverTime || now, source: 'foxlogger' }));
            actF++;
          }
        }
      }
    }

    positions.sort((a, b) => new Date(b.deviceTime || 0) - new Date(a.deviceTime || 0));
    cache.set('positions:merged', positions, 30);
  }

  await feedAndEmit(positions);
  await evaluateOffline();
  maybeHeartbeat();

  logger.info(`[PositionSync] cached: traccar ${actT}/${expT}, mspf ${actM}/${expM}, foxlogger ${actF}/${expF}`);

  const mem = process.memoryUsage();
  logger.info(`[Cache] RSS:${Math.round(mem.rss / 1024 / 1024)}MB | Heap:${Math.round(mem.heapUsed / 1024 / 1024)}MB | Keys:${cache.keys().length}`);
}

async function startPositionSync() {
  if (cache.get('positions:merged')) return;
  logger.info('[PositionSync] initial sync...');
  await syncPositions();
  setInterval(syncPositions, 10000);
}

module.exports = { startPositionSync, syncPositions, setEmitHooks };
