'use strict';

const config = require('../config');
const cache = require('./cache');
const traccar = require('./traccar');
const mspf = require('./mspf');
const foxlogger = require('./foxlogger');
const deviceRouter = require('./deviceRouter');
const { runAutoSync } = require('./autoSync');
const { logger } = require('../middleware/logger');

const HARD_TTL_SECONDS = 24 * 60 * 60; // 86400 detik (24 jam)
const HARD_TTL_MS = HARD_TTL_SECONDS * 1000;
const FRESH_TTL_SECONDS = config.cache.ttl || 120;
const FRESH_TTL_MS = FRESH_TTL_SECONDS * 1000;
const RETRY_BACKOFF_MS = 10 * 1000; // 10 detik jeda saat seluruh upstream gagal
const REBUILD_REQUEST_TIMEOUT_MS = 10 * 1000; // 10 detik per request upstream

let inFlightRebuildPromise = null;
let lastGoodDevices = null;
let lastFetchedMonotonic = null; // sentinel null untuk jam monoton
let lastFetchedAt = null;        // Date.now() untuk pencatatan umur data di log
let freshUntil = null;           // sentinel null untuk penanda kesegaran

function isWithinHardTtl() {
  if (lastFetchedMonotonic === null) return false;
  return (performance.now() - lastFetchedMonotonic) <= HARD_TTL_MS;
}

function normalizeTraccarDevice(d) {
  return {
    id: d.id,
    name: d.name,
    uniqueId: d.uniqueId,
    status: d.status || 'offline',
    phone: d.phone || undefined,
    model: d.model || undefined,
    source: 'traccar',
    group: `traccar_${d.groupId}`,
    lastUpdate: d.lastUpdate || (d.attributes?.motionTime ? new Date(d.attributes.motionTime).toISOString() : undefined),
    voltage: d.attributes?.power ?? undefined,
    internalBattery: d.attributes?.addr_IB ?? undefined,
    batteryLevel: d.attributes?.batteryLevel ?? undefined,
    ignition: d.attributes?.ignition ?? undefined,
    attributes: d.attributes || {},
  };
}

function getCachedDevices() {
  const cached = cache.get('devices:merged');
  if (Array.isArray(cached) && cached.length > 0) {
    return cached;
  }
  if (isWithinHardTtl() && Array.isArray(lastGoodDevices) && lastGoodDevices.length > 0) {
    return lastGoodDevices;
  }
  return null;
}

function isFresh() {
  if (freshUntil === null) return false;
  return performance.now() < freshUntil;
}

async function doRebuild() {
  const reqOpts = { timeout: REBUILD_REQUEST_TIMEOUT_MS };
  const mspfPromise = mspf.waitForInit
    ? mspf.waitForInit().then(() => mspf.getDevices({}, reqOpts))
    : mspf.getDevices({}, reqOpts);
  const foxloggerPromise = foxlogger.waitForInit
    ? foxlogger.waitForInit().then(() => foxlogger.getDevices({}, reqOpts))
    : foxlogger.getDevices({}, reqOpts);

  const [traccarResult, mspfResult, foxloggerResult] = await Promise.allSettled([
    traccar.getDevices({ all: true }, reqOpts),
    mspfPromise,
    foxloggerPromise,
  ]);

  const traccarOk = traccarResult.status === 'fulfilled' && Array.isArray(traccarResult.value);
  const mspfOk = mspfResult.status === 'fulfilled' && Array.isArray(mspfResult.value?.data);
  const foxloggerOk = foxloggerResult.status === 'fulfilled' && Array.isArray(foxloggerResult.value?.data);

  const existing = getCachedDevices();
  const nowMs = Date.now();
  const dataAgeSec = lastFetchedAt !== null ? Math.round((nowMs - lastFetchedAt) / 1000) : 'unknown';

  // 1. Kasus kegagalan total: semua upstream gagal
  if (!traccarOk && !mspfOk && !foxloggerOk) {
    logger.warn(
      `[DeviceCache] All upstreams failed (Traccar: ${traccarResult.reason?.message || 'error'}, MSPF: ${mspfResult.reason?.message || 'error'}, FoxLogger: ${foxloggerResult.reason?.message || 'error'}). Cached data age: ${dataAgeSec}s`
    );

    if (existing && existing.length > 0) {
      freshUntil = performance.now() + RETRY_BACKOFF_MS;
      cache.set('devices:merged', existing, HARD_TTL_SECONDS);
      return existing;
    }

    return [];
  }

  // 2. Kasus parsial atau sukses penuh
  const merged = [];
  let traccarCount = 0;
  let mspfCount = 0;
  let foxCount = 0;

  if (traccarOk) {
    const mapped = traccarResult.value.map(normalizeTraccarDevice);
    merged.push(...mapped);
    traccarCount = mapped.length;
  } else {
    const staleTraccar = existing ? existing.filter((d) => d.source === 'traccar') : [];
    if (staleTraccar.length > 0) {
      merged.push(...staleTraccar);
      traccarCount = staleTraccar.length;
      logger.warn(`[DeviceCache] Traccar failed (${traccarResult.reason?.message || 'error'}), retaining ${staleTraccar.length} stale devices. Data age: ${dataAgeSec}s`);
    } else {
      logger.warn(`[DeviceCache] Traccar failed (${traccarResult.reason?.message || 'error'}), no stale data available`);
    }
  }

  if (mspfOk) {
    merged.push(...mspfResult.value.data);
    mspfCount = mspfResult.value.data.length;
  } else {
    const staleMspf = existing ? existing.filter((d) => d.source === 'mspf') : [];
    if (staleMspf.length > 0) {
      merged.push(...staleMspf);
      mspfCount = staleMspf.length;
      logger.warn(`[DeviceCache] MSPF failed (${mspfResult.reason?.message || 'error'}), retaining ${staleMspf.length} stale devices. Data age: ${dataAgeSec}s`);
    } else {
      logger.warn(`[DeviceCache] MSPF failed (${mspfResult.reason?.message || 'error'}), no stale data available`);
    }
  }

  if (foxloggerOk) {
    merged.push(...foxloggerResult.value.data);
    foxCount = foxloggerResult.value.data.length;
  } else {
    const staleFox = existing ? existing.filter((d) => d.source === 'foxlogger') : [];
    if (staleFox.length > 0) {
      merged.push(...staleFox);
      foxCount = staleFox.length;
      logger.warn(`[DeviceCache] FoxLogger failed (${foxloggerResult.reason?.message || 'error'}), retaining ${staleFox.length} stale devices. Data age: ${dataAgeSec}s`);
    } else {
      logger.warn(`[DeviceCache] FoxLogger failed (${foxloggerResult.reason?.message || 'error'}), no stale data available`);
    }
  }

  logger.info(`Device cache built: ${traccarCount} Traccar + ${mspfCount} MSPF + ${foxCount} FoxLogger = ${merged.length} total`);

  merged.sort((a, b) => {
    const aId = String(a.id).padStart(20, '0');
    const bId = String(b.id).padStart(20, '0');
    if (aId !== bId) return aId < bId ? -1 : 1;
    if (a.source < b.source) return -1;
    if (a.source > b.source) return 1;
    return 0;
  });

  deviceRouter.buildDeviceMap(merged);
  cache.set('devices:merged', merged, HARD_TTL_SECONDS);
  lastGoodDevices = merged;
  lastFetchedMonotonic = performance.now();
  lastFetchedAt = Date.now();
  freshUntil = performance.now() + FRESH_TTL_MS;

  Promise.resolve(runAutoSync?.()).catch(() => {});

  return merged;
}

function triggerRebuild() {
  if (inFlightRebuildPromise) {
    return inFlightRebuildPromise;
  }

  inFlightRebuildPromise = doRebuild().finally(() => {
    inFlightRebuildPromise = null;
  });

  return inFlightRebuildPromise;
}

async function getOrBuildDeviceCache() {
  const cached = cache.get('devices:merged');

  // 1. Data ada dan masih segar (fresh hit)
  if (cached && isFresh()) {
    return cached;
  }

  // 2. Data ada tapi sudah kedaluwarsa kesegarannya (stale hit -> stale-while-revalidate)
  if (cached) {
    triggerRebuild().catch((err) => {
      logger.warn(`[DeviceCache] Background revalidation failed: ${err.message}`);
    });
    return cached;
  }

  // 3. Cache kosong sama sekali (cold start / hard TTL habis) -> tunggu rebuild
  return triggerRebuild();
}

function stop() {
  inFlightRebuildPromise = null;
}

function _resetForTests() {
  inFlightRebuildPromise = null;
  lastGoodDevices = null;
  lastFetchedMonotonic = null;
  lastFetchedAt = null;
  freshUntil = null;
}

function setDevices(devices) {
  if (!Array.isArray(devices) || devices.length === 0) {
    logger.warn('[DeviceCache] setDevices rejected empty or non-array argument; preserving existing data');
    return getCachedDevices() || [];
  }

  const safeList = devices.map((d) => ({ ...d }));

  deviceRouter.buildDeviceMap(safeList);
  cache.set('devices:merged', safeList, HARD_TTL_SECONDS);
  lastGoodDevices = safeList;
  lastFetchedMonotonic = performance.now();
  lastFetchedAt = Date.now();
  freshUntil = performance.now() + FRESH_TTL_MS;

  return safeList;
}

function getDevices() {
  return cache.get('devices:merged');
}

function invalidate() {
  cache.del('devices:merged');
  freshUntil = null;
  lastGoodDevices = null;
  lastFetchedMonotonic = null;
  lastFetchedAt = null;
}

module.exports = {
  getOrBuildDeviceCache,
  getDevices,
  setDevices,
  invalidate,
  normalizeTraccarDevice,
  triggerRebuild,
  stop,
  _resetForTests,
};
