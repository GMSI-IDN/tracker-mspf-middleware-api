const cache = require('./cache');
const traccar = require('./traccar');
const mspf = require('./mspf');
const deviceRouter = require('./deviceRouter');
const config = require('../config');
const { logger } = require('../middleware/logger');

const mspfBcCache = { ids: [], ts: 0 };
const MSPF_BC_CACHE_TTL = 300000;

function getMspfBcIds() {
  const merged = cache.get('devices:merged');
  if (!merged) return [];
  return [...new Set(merged
    .filter(d => d.source === 'mspf' && d.group)
    .map(d => parseInt(d.group.replace('mspf_', ''), 10))
  )];
}

function getActiveMspfIds() {
  const merged = cache.get('devices:merged');
  if (!merged) return null;
  return new Set(merged.filter(d => d.source === 'mspf').map(d => d.id));
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

async function syncPositions() {
  let bcIds = getMspfBcIds();
  if (bcIds.length === 0) {
    bcIds = await getBcIdsFallback();
    if (bcIds.length === 0) {
      logger.warn('[PositionSync] no BC IDs (device cache + API both failed), skipping...');
      return;
    }
  }

  let merged = cache.get('devices:merged');
  let expT = merged?.filter(d => d.source === 'traccar').length || 0;
  let expM = merged?.filter(d => d.source === 'mspf').length || 0;
  let actT = 0, actM = 0;

  const [traccarResult, mspfResult] = await Promise.allSettled([
    traccar.getPositions(),
    mspf.getPositions({ limit: 1000, bc: bcIds }),
  ]);

  if (mspfResult.status !== 'fulfilled') {
    logger.warn(`[PositionSync] MSPF failed: ${mspfResult.reason?.message || 'unknown error'}`);
    const old = cache.get('positions:merged');
    if (old && old.length > 0) return;
  }

  const positions = [];
  const now = new Date().toISOString();

  if (traccarResult.status === 'fulfilled' && traccarResult.value) {
    for (const p of traccarResult.value) {
      positions.push(normalizePosition({ ...p, serverTime: p.serverTime || now, source: 'traccar' }));
      actT++;
    }
  }

  if (mspfResult.status === 'fulfilled' && mspfResult.value) {
    let activeIds = getActiveMspfIds();
    if (!activeIds) {
      logger.warn('[PositionSync] device cache expired, rebuilding...');
      const [t, m] = await Promise.allSettled([
        traccar.getDevices({ all: true }),
        mspf.waitForInit().then(() => mspf.getDevices()),
      ]);
      const rebuild = [];
      if (t.status === 'fulfilled' && t.value) {
        for (const d of t.value) rebuild.push({ id: d.id, name: d.name, uniqueId: d.uniqueId, status: d.status || 'offline', source: 'traccar', group: `traccar_${d.groupId}`, voltage: d.attributes?.power ?? undefined, attributes: d.attributes || {} });
      }
      if (m.status === 'fulfilled' && m.value?.data) rebuild.push(...m.value.data);
      rebuild.sort((a, b) => a.id - b.id || (a.source < b.source ? -1 : 1));
      deviceRouter.buildDeviceMap(rebuild);
      cache.set('devices:merged', rebuild, config.cache.ttl || 120);
      logger.info(`Device cache rebuilt: ${rebuild.length} devices`);
      merged = rebuild;
      expT = merged.filter(d => d.source === 'traccar').length;
      expM = merged.filter(d => d.source === 'mspf').length;
      activeIds = new Set(merged.filter(d => d.source === 'mspf').map(d => d.id));
    }
    if (activeIds.size > 0) {
      for (const p of mspfResult.value) {
        if (activeIds.has(p.deviceId)) {
          positions.push(normalizePosition({ ...p, serverTime: p.serverTime || now, source: 'mspf' }));
          actM++;
        }
      }
    }
  }

  positions.sort((a, b) => new Date(b.deviceTime || 0) - new Date(a.deviceTime || 0));
  cache.set('positions:merged', positions, 30);

  logger.info(`[PositionSync] cached: traccar ${actT}/${expT}, mspf ${actM}/${expM}`);

  const mem = process.memoryUsage();
  logger.info(`[Cache] RSS:${Math.round(mem.rss / 1024 / 1024)}MB | Heap:${Math.round(mem.heapUsed / 1024 / 1024)}MB | Keys:${cache.keys().length}`);
}

async function startPositionSync() {
  if (cache.get('positions:merged')) return;
  logger.info('[PositionSync] initial sync...');
  await syncPositions();
  setInterval(syncPositions, 10000);
}

module.exports = { startPositionSync, syncPositions };
