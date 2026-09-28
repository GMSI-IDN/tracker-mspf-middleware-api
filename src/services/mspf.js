'use strict';

const { classifyAxiosError } = require('../utils/axiosError');
const { logger } = require('../middleware/logger');
const { calcRunningStatus } = require('../utils/deviceStatus');
const { toUtcIso } = require('../utils/timestamp');

const axios = require('axios');
const config = require('../config');

let mspfApi = null;
let tokenExpiresAt = 0;
let refreshTimer = null;

const AUTH_REFRESH_MARGIN = 60;

async function getAccessToken() {
  const authHeader = 'Basic ' + Buffer.from(`${config.mspf.clientId}:${config.mspf.clientSecret}`).toString('base64');
  const tokenUrl = config.mspf.tokenUrl || `${config.mspf.url.replace(/\/api$/, '')}/v1/oauth2/token`;
  try {
    const res = await axios.post(tokenUrl, 'grant_type=client_credentials', {
      headers: { Authorization: authHeader, 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    });
    const { access_token, expires_in } = res.data;
    tokenExpiresAt = Date.now() + (expires_in - AUTH_REFRESH_MARGIN) * 1000;
    logger.info('[MSPF] OAuth2 token acquired, expires in', expires_in, 's');
    return access_token;
  } catch (err) {
    logger.error('[MSPF] Failed to acquire OAuth2 token:', err.response?.data || err.message);
    throw err;
  }
}

function scheduleTokenRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  const delay = Math.max(tokenExpiresAt - Date.now(), 5000);
  refreshTimer = setTimeout(async () => {
    try { const token = await getAccessToken(); updateApiClient(token); }
    catch (err) {
      logger.error('[MSPF] Token refresh failed, retrying in 30s');
      refreshTimer = setTimeout(() => scheduleTokenRefresh(), 30000).unref();
    }
  }, delay).unref();
}

function updateApiClient(token) {
  mspfApi = axios.create({
    baseURL: config.mspf.url, timeout: config.requestTimeout,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  mspfApi.interceptors.response.use(
    (res) => res,
    async (err) => {
      if (err.response?.status === 401) {
        logger.warn('[MSPF] Token expired, refreshing...');
        try {
          const newToken = await getAccessToken();
          updateApiClient(newToken);
          err.config.headers.Authorization = `Bearer ${newToken}`;
          const retryRes = await axios(err.config);
          return retryRes;
        } catch (refreshErr) { logger.error('[MSPF] Token refresh on 401 failed:', refreshErr.message); }
      }
      const classified = classifyAxiosError(err);
      logger.warn(`[MSPF] ${err.config?.method?.toUpperCase()} ${err.config?.url} (${classified.status} ${classified.code})`);
      return Promise.reject(classified);
    }
  );
}

function getApi() {
  if (module.exports && module.exports.getApi && module.exports.getApi !== getApi) {
    return module.exports.getApi();
  }
  if (!mspfApi) throw Object.assign(new Error('MSPF API not initialized'), { status: 502, code: 'ERR_BAD_GATEWAY' });
  return mspfApi;
}

async function waitForInit(timeout = 15000) {
  const start = Date.now();
  while (!mspfApi) {
    if (Date.now() - start > timeout) throw new Error('MSPF init timeout');
    await new Promise(r => setTimeout(r, 200));
  }
}

// ── Normalizers ───────────────────────────────────────

function normalizeDevice(d) {
  const name = d.name || d.tags?.VIN || d.tags?.mobilityNo || d.tags?.identity || d.tags?.deviceSerialNo || `${d.id}`;
  return {
    id: d.id, name, uniqueId: d.uniqueId || d.imei || `${d.id}`,
    status: d.status === 'WORKING' ? 'online' : 'offline',
    phone: d.mobileNo || undefined, model: d.deviceType || undefined,
    source: 'mspf', group: `mspf_${d.bcId}`,
    lastUpdate: toUtcIso(d.lastCommunicatedAt) || undefined,
    voltage: d.tags?.volt ?? undefined,
    internalBattery: d.tags?.addr_IB ?? mccsStore.get(d.id)?.data?.addr?.IB ?? undefined,
    batteryLevel: undefined,
    ignition: undefined,
    attributes: {
      ...(d.tags || {}),
      bcId: d.bcId,
      deviceTypeId: d.deviceTypeId,
      activationStatus: d.activationStatus || d.activationCurrentStatus || d.tags?.activationStatus || undefined,
      activationReservation: d.activationReservation || undefined,
      firmwareVersion: d.fwVersion || undefined,
    },
  };
}

// MSPF position has { lat, lon, timestamp (unix seconds) } — no speed/course/altitude
function normalizePosition(deviceId, pos) {
  if (!pos) return null;
  return {
    id: pos.id || undefined,
    deviceId: pos.deviceId || deviceId,
    latitude: pos.latitude ?? pos.lat,
    longitude: pos.longitude ?? pos.lon,
    speed: pos.speed ?? 0,
    course: pos.course ?? 0,
    altitude: pos.altitude ?? 0,
    deviceTime: toUtcIso(pos.deviceTime) || (pos.timestamp ? new Date(pos.timestamp * 1000).toISOString() : new Date().toISOString()),
    serverTime: toUtcIso(pos.serverTime) || new Date().toISOString(),
    fixTime: toUtcIso(pos.fixTime) || toUtcIso(pos.deviceTime) || (pos.timestamp ? new Date(pos.timestamp * 1000).toISOString() : new Date().toISOString()),
    valid: pos.valid !== undefined ? pos.valid : true,
    source: 'mspf',
    attributes: { ...(pos.attributes || {}) },
  };
}

function normalizePositionsResponse(data) {
  if (!data || !data.data) return [];
  return data.data.map((item) => normalizePosition(item.deviceId, item.position)).filter(Boolean);
}

// ── MCCS Data History ────────────────────────────────────

const NodeCache = require('node-cache');
const { guardedJob } = require('../utils/guardedJob');

const mccsStore = new Map();
const mccsFetchTimes = new Map();

let mccsSyncOffset = 0;
let mccsCompletedCycles = 0;
const MCCS_STALE_THRESHOLD_MS = 5 * 60 * 1000;

let mccsCycleStats = { totalDevices: 0, fetchedThisCycle: 0, cycleStartedAt: 0, timeToFullMs: 0 };
let mccsFirstFullAt = 0;

const MCCS_CHUNK_SIZE = 50;
const MCCS_CONCURRENCY = 10;
const MCCS_WORKER_INTERVAL_MS = 7000;
const MCCS_PAUSE_MIN_MS = 25 * 60 * 1000;
const MCCS_PAUSE_MAX_MS = 35 * 60 * 1000;

function getRandomPauseDuration() {
  return MCCS_PAUSE_MIN_MS + Math.floor(Math.random() * (MCCS_PAUSE_MAX_MS - MCCS_PAUSE_MIN_MS));
}

const mccsPausedDevices = new Map();
const mccsPriorityQueue = [];
const mccsDeviceLastTimes = new Map();
let mccsCycleDeviceList = [];

function createEmptyFailureStats() {
  return {
    timeout: { count: 0, sampleIds: [] },
    http_404: { count: 0, sampleIds: [] },
    http_429: { count: 0, sampleIds: [] },
    http_5xx: { count: 0, sampleIds: [] },
    other: { count: 0, sampleIds: [] },
  };
}

let mccsFailureStats = createEmptyFailureStats();
let mccsLastCycleFailures = null;

function recordMccsFailure(category, deviceId) {
  const key = mccsFailureStats[category] ? category : 'other';
  mccsFailureStats[key].count++;
  if (mccsFailureStats[key].sampleIds.length < 5) {
    mccsFailureStats[key].sampleIds.push(deviceId);
  }
}

function classifyMccsError(err) {
  if (!err || typeof err !== 'object') return 'other';
  if (
    err.code === 'ECONNABORTED' ||
    err.code === 'ERR_TIMEOUT' ||
    err.status === 504 ||
    (typeof err.message === 'string' && err.message.toLowerCase().includes('timeout'))
  ) {
    return 'timeout';
  }
  const status = err.status || err.response?.status;
  if (status === 404) return 'http_404';
  if (status === 429) return 'http_429';
  if (status >= 500 && status < 600) return 'http_5xx';
  return 'other';
}

function parseDeviceTimeMs(val) {
  if (!val) return 0;
  if (typeof val === 'number') return val < 1e12 ? val * 1000 : val;
  const t = new Date(val).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function getLastKnownDeviceTime(deviceId) {
  if (mccsDeviceLastTimes.has(deviceId)) {
    return mccsDeviceLastTimes.get(deviceId);
  }
  try {
    const cache = require('./cache');
    const positions = cache.get('positions:merged');
    if (Array.isArray(positions)) {
      const pos = positions.find(p => p.deviceId === deviceId);
      if (pos?.deviceTime) {
        const t = parseDeviceTimeMs(pos.deviceTime);
        if (t > 0) {
          mccsDeviceLastTimes.set(deviceId, t);
          return t;
        }
      }
    }
    const devices = cache.get('devices:merged');
    if (Array.isArray(devices)) {
      const dev = devices.find(d => d.id === deviceId);
      if (dev?.lastUpdate) {
        const t = parseDeviceTimeMs(dev.lastUpdate);
        if (t > 0) {
          mccsDeviceLastTimes.set(deviceId, t);
          return t;
        }
      }
    }
  } catch {}
  return 0;
}

function notifyDevicePosition(deviceId, deviceTime) {
  if (!deviceId || !deviceTime) return;
  const t = parseDeviceTimeMs(deviceTime);
  if (!t) return;

  const prevT = mccsDeviceLastTimes.get(deviceId) || 0;
  if (t > prevT) {
    mccsDeviceLastTimes.set(deviceId, t);
  }

  const paused = mccsPausedDevices.get(deviceId);
  if (paused) {
    if (paused.hardJeda) {
      return;
    }
    if (!paused.reactivatedOnce && t > (paused.lastDeviceTime || 0)) {
      paused.reactivatedOnce = true;
      paused.lastDeviceTime = t;
      if (!mccsPriorityQueue.includes(deviceId)) {
        mccsPriorityQueue.push(deviceId);
      }
      logger.info(`[MccsWorker] device ${deviceId} reactivated (deviceTime: ${new Date(t).toISOString()}), prioritized for one retry`);
    }
  }
}

async function fetchLatestMccsRecord(deviceId) {
  try {
    const res = await getApi().get(`/v2/device/${deviceId}/data/history`, {
      params: { to: new Date().toISOString(), limit: 5 },
      timeout: 10000,
    });
    const items = res.data?.data;
    if (items && items.length > 0) {
      return { ok: true, data: items[items.length - 1] };
    }
    return { ok: false, errorType: 'empty_data' };
  } catch (err) {
    return { ok: false, errorType: classifyMccsError(err), error: err };
  }
}

async function getLatestMccsData(deviceId) {
  const result = await fetchLatestMccsRecord(deviceId);
  return result.ok ? result.data : null;
}

function getMccsForDevice(deviceId) {
  return mccsStore.get(deviceId) || null;
}

async function getBatchMccsData(deviceIds, statusMap = {}) {
  const ids = [...new Set(deviceIds.filter(Boolean))];
  const results = {};

  for (const id of ids) {
    if (mccsStore.has(id)) {
      results[id] = mccsStore.get(id);
    } else {
      results[id] = null;
    }
  }

  const toFetch = ids.filter(id => !mccsStore.has(id));
  if (toFetch.length > 0) {
    for (let i = 0; i < toFetch.length; i += MCCS_CONCURRENCY) {
      const batch = toFetch.slice(i, i + MCCS_CONCURRENCY);
      const fetched = await Promise.allSettled(batch.map(id => getLatestMccsData(id)));
      for (let j = 0; j < batch.length; j++) {
        const id = batch[j];
        const data = fetched[j].status === 'fulfilled' ? fetched[j].value : null;
        if (data) {
          mccsStore.set(id, data);
          mccsFetchTimes.set(id, Date.now());
          results[id] = data;
        }
      }
    }
  }

  return results;
}

function normalizeMccsToAttributes(mccsRecord) {
  if (!mccsRecord) return {};
  const d = mccsRecord.data ?? mccsRecord;
  const attrs = {
    tid: d.tid, mid: d.mid, ts: d.ts, code: d.code,
    kph: d.kph, alt: d.alt, dir: d.dir,
    hdop: d.hdop, sats: d.sats,
    odom: d.odom, volt: d.volt,
    gpio: d.gpio, accm: d.accm,
    ver: d.ver, sno: d.sno,
    diff: d.diff, gtm: d.gtm,
    relay: d.relay, mode: d.mode,
    createdAt: mccsRecord.createdAt ? toUtcIso(mccsRecord.createdAt) || undefined : undefined,
    insDtm: mccsRecord.insDtm ? toUtcIso(mccsRecord.insDtm) || undefined : undefined,
    addr_IGN: d.addr?.IGN, addr_FIX: d.addr?.FIX,
    addr_EB: d.addr?.EB, addr_IB: d.addr?.IB,
    addr_AD: d.addr?.AD, addr_AD2: d.addr?.AD2,
    addr_TE: d.addr?.TE, addr_RS: d.addr?.RS,
    addr_NT: d.addr?.NT,
    addr_x: d.addr?.x, addr_y: d.addr?.y, addr_z: d.addr?.z,
  };
  return Object.fromEntries(Object.entries(attrs).filter(([_, v]) => v !== undefined));
}

// ── Enrich positions ─────────────────────────────────────

// ponytail: single-device route directly fetches single status; batch positions use list paging -> upgrade path: streaming position enricher
async function enrichPositions(positions, options = {}) {
  if (!positions || positions.length === 0) return positions;
  const deviceIds = [...new Set(positions.map(p => p.deviceId).filter(Boolean))];

  const statusTimeout = options.timeout || 10000;
  const statusMap = {};
  if (deviceIds.length === 1) {
    try {
      const single = await getDeviceStatus(deviceIds[0], { timeout: statusTimeout });
      if (single) statusMap[deviceIds[0]] = single;
    } catch { }
  } else {
    let statusResult = null;
    if (deviceIds.length <= 200) {
      statusResult = await getDeviceStatusList({ limit: 200 }, { timeout: statusTimeout });
    } else {
      let all = []; let start = undefined;
      do {
        const res = await getApi().get('/v3/devices/status', { params: { limit: 200, start }, timeout: statusTimeout });
        all.push(...(res.data?.data || []));
        start = res.data?.next;
      } while (start);
      statusResult = { data: all };
    }
    if (statusResult?.data) {
      for (const s of statusResult.data) statusMap[s.deviceId] = s;
    }
  }

  let mccsMap = {};
  if (options.fetchMccs) {
    try { mccsMap = await getBatchMccsData(deviceIds, statusMap); } catch { };
  } else {
    for (const id of deviceIds) {
      if (mccsStore.has(id)) mccsMap[id] = mccsStore.get(id);
    }
  }

  const latestTimes = {};
  for (const p of positions) {
    const t = new Date(p.deviceTime || 0).getTime();
    if (!Number.isNaN(t) && t > (latestTimes[p.deviceId] || 0)) latestTimes[p.deviceId] = t;
    if (p.deviceId && p.deviceTime) {
      notifyDevicePosition(p.deviceId, p.deviceTime);
    }
  }

  return positions.map(p => {
    const st = statusMap[p.deviceId];
    const mccs = mccsMap[p.deviceId];
    const mccsData = mccs?.data ?? mccs;
    const mccsAttrs = normalizeMccsToAttributes(mccs);
    const kph = mccsData?.kph;
    const ignition = st?.ignition === 'ON' ? true : (st?.ignition === 'OFF' ? false : undefined);
    const mspfRunning = st?.running?.status;
    const speed = kph || p.speed || st?.speed || 0;
    const lastUpdate = p.deviceTime || st?.lastCommunicatedAt;
    const running = mspfRunning && mspfRunning !== 'UNKNOWN' ? mspfRunning : calcRunningStatus(ignition, speed, lastUpdate);
    const isLatest = new Date(p.deviceTime || 0).getTime() >= (latestTimes[p.deviceId] || 0);
    const serverTime = isLatest && mccs?.insDtm ? toUtcIso(mccs.insDtm) || p.serverTime : p.serverTime;

    return {
      ...p,
      serverTime,
      speed: p.speed || st?.speed || 0,
      course: p.course || mccsData?.dir || 0,
      attributes: {
        ...p.attributes,
        ...(st?.tags || {}),
        ...(ignition !== undefined ? { ignition } : {}),
        ...(st?.voltage ? { voltage: st.voltage } : {}),
        ...(st?.sats ? { sats: st.sats } : {}),
        ...(st?.rssi ? { rssi: st.rssi } : {}),
        ...(st?.signal !== undefined ? { signal: st.signal } : {}),
        ...(running ? { running } : {}),
        ...mccsAttrs,
      },
    };
  });
}

// ── DeviceStatus normalizer ───────────────────────────

function normalizeDeviceStatus(status) {
  if (!status) return null;
  const activationStatus = status.activation?.currentStatus || status.activation || status.activationStatus || undefined;
  return {
    deviceId: status.deviceId,
    speed: status.speed || 0,
    running: status.running?.status || undefined,
    ignition: status.ignition || undefined,
    voltage: status.voltage || undefined,
    firmwareVersion: status.firmVersion || undefined,
    lastCommunicatedAt: toUtcIso(status.lastCommunicatedAt) || undefined,
    sats: status.sats || undefined,
    rssi: status.rssi || undefined,
    signal: status.signal || undefined,
    position: status.position ? {
      latitude: status.position.lat,
      longitude: status.position.lon,
      timestamp: status.position.timestamp ? new Date(status.position.timestamp * 1000).toISOString() : undefined,
    } : undefined,
    tags: status.tags || {},
    activationStatus,
    option1: status.option1 || undefined,
  };
}

// ── MCCS data for device detail (nested format) ─────────

function normalizeMccsForDeviceDetail(mccsRecord) {
  if (!mccsRecord) return {};
  const d = mccsRecord.data ?? mccsRecord;
  return {
    mobilityData: {
      tid: d.tid, mid: d.mid, ts: d.ts, code: d.code,
      kph: d.kph, lat: d.lat, lon: d.lon,
      alt: d.alt, dir: d.dir,
      hdop: d.hdop, sats: d.sats,
      odom: d.odom, volt: d.volt,
      gpio: d.gpio, accm: d.accm,
      ver: d.ver, sno: d.sno,
      diff: d.diff, gtm: d.gtm,
      relay: d.relay, mode: d.mode,
      createdAt: mccsRecord.createdAt ? toUtcIso(mccsRecord.createdAt) || undefined : undefined,
      insDtm: mccsRecord.insDtm ? toUtcIso(mccsRecord.insDtm) || undefined : undefined,
      addr: {
        IGN: d.addr?.IGN, FIX: d.addr?.FIX,
        EB: d.addr?.EB, IB: d.addr?.IB,
        AD: d.addr?.AD, AD2: d.addr?.AD2,
        TE: d.addr?.TE, RS: d.addr?.RS,
        NT: d.addr?.NT,
        x: d.addr?.x, y: d.addr?.y, z: d.addr?.z,
      },
    },
  };
}

// ── Enrichers ──────────────────────────────────────────

async function enrichDevice(device) {
  if (device.source !== 'mspf') return device;

  const [status, mccsData] = await Promise.allSettled([
    getDeviceStatus(device.id).then(normalizeDeviceStatus),
    getLatestMccsData(device.id).then(normalizeMccsForDeviceDetail),
  ]);

  const st = status.status === 'fulfilled' ? status.value : null;
  const mccs = mccsData.status === 'fulfilled' ? mccsData.value : {};
  const deviceRunning = st?.running;
  const deviceIgnition = st?.ignition === 'ON' ? true : (st?.ignition === 'OFF' ? false : undefined);
  const running = deviceRunning && deviceRunning !== 'UNKNOWN' ? deviceRunning : calcRunningStatus(deviceIgnition, st?.speed, st?.lastCommunicatedAt);

  const enrichedAttrs = {
    ...device.attributes,
    ...mccs,
    ...(st?.tags ? { tags: st.tags } : {}),
    ...(st?.activationStatus ? { activationStatus: st.activationStatus } : {}),
  };

  return {
    ...device,
    ...(st ? {
      running,
      ignition: deviceIgnition,
      voltage: st.voltage,
      firmwareVersion: st.firmwareVersion,
      lastCommunicatedAt: st.lastCommunicatedAt,
      speed: st.speed,
      sats: st.sats,
    } : {}),
    internalBattery: enrichedAttrs.mobilityData?.addr?.IB ?? enrichedAttrs.addr_IB ?? undefined,
    batteryLevel: enrichedAttrs.batteryLevel ?? undefined,
    attributes: enrichedAttrs,
  };
}

// ── API functions ──────────────────────────────────────

async function getDevices(params = {}, options = {}) {
  const { timeout, ...queryParams } = params;
  const reqTimeout = options.timeout || timeout;
  let all = [];
  let start = undefined;
  let total = 0;
  let pageCount = 0;
  do {
    const query = { ...queryParams, status: 'WORKING', limit: 200 };
    if (start) query.start = start;
    const reqConfig = { params: query };
    if (reqTimeout) reqConfig.timeout = reqTimeout;
    const res = await getApi().get('/v3/devices', reqConfig);
    const page = (res.data.data || []).map(normalizeDevice);
    all.push(...page);
    total = res.data.total ?? all.length;
    start = res.data.next;
    pageCount++;
  } while (start);

  logger.debug(`MSPF devices fetched: ${all.length} in ${pageCount} pages (total ${total})`);
  return { data: all, total, next: null };
}

async function searchDevices(query, params = {}) {
  try {
    const res = await getApi().get('/v3/devices', { params: { ...params, query } });
    return (res.data?.data || []).map(normalizeDevice);
  } catch {
    return [];
  }
}

async function getDevice(deviceId) {
  const res = await getApi().get(`/v3/devices/${deviceId}`);
  return normalizeDevice(res.data);
}

async function getBcList(params = {}, options = {}) {
  const { timeout, ...queryParams } = params;
  const reqTimeout = options.timeout || timeout;
  const reqConfig = { params: queryParams };
  if (reqTimeout) reqConfig.timeout = reqTimeout;
  const res = await getApi().get('/v2/bc', reqConfig);
  return res.data;
}

async function getBc(bcId) {
  const res = await getApi().get(`/v2/bc/${bcId}`);
  return res.data;
}

async function getPositions(params = {}, options = { fetchMccs: false }) {
  const { timeout, ...queryParams } = params;
  const reqTimeout = options.timeout || timeout || 10000;
  let all = [];
  let start = undefined;
  do {
    const query = { ...queryParams, limit: 1000 };
    if (start) query.start = start;
    const res = await getApi().get('/v3/devices/positions', { params: query, timeout: reqTimeout });
    const page = normalizePositionsResponse(res.data);
    all.push(...page);
    start = res.data.next;
  } while (start);
  return enrichPositions(all, { ...options, timeout: reqTimeout });
}

// ── Historical MCCS & Route Enrichment ─────────────────────

// ponytail: chunk MCCS history by 24h slices due to MSPF constraint -> upgrade path: chunked streaming worker
async function getDeviceMccsHistory(deviceId, params = {}) {
  if (!deviceId) return [];
  const fromMs = params.from ? new Date(params.from).getTime() : 0;
  const toMs = params.to ? new Date(params.to).getTime() : 0;

  if (!fromMs || !toMs || toMs <= fromMs) {
    try {
      const res = await getApi().get(`/v2/device/${deviceId}/data/history`, {
        params: params.from || params.to ? { from: params.from, to: params.to } : {},
        timeout: 10000,
      });
      return res.data?.data || [];
    } catch {
      return [];
    }
  }

  const ONE_DAY_MS = 24 * 3600 * 1000;
  const slices = [];
  let curStart = fromMs;
  while (curStart < toMs) {
    const curEnd = Math.min(curStart + ONE_DAY_MS, toMs);
    slices.push({
      from: new Date(curStart).toISOString(),
      to: new Date(curEnd).toISOString(),
    });
    curStart = curEnd;
  }

  const results = await Promise.allSettled(
    slices.map(slice =>
      getApi().get(`/v2/device/${deviceId}/data/history`, {
        params: { from: slice.from, to: slice.to },
        timeout: 10000,
      }).then(res => res.data?.data || [])
    )
  );

  const all = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      all.push(...r.value);
    }
  }
  return all;
}

function getMccsTimestamp(item) {
  if (!item) return 0;
  if (item.createdAt) {
    const t = new Date(item.createdAt).getTime();
    if (!Number.isNaN(t) && t > 0) return t;
  }
  const d = item.data ?? item;
  if (d?.ts) {
    return d.ts * 1000;
  }
  if (item.insDtm) {
    const t = new Date(item.insDtm).getTime();
    if (!Number.isNaN(t) && t > 0) return t;
  }
  return 0;
}

// ponytail: nearest-neighbor timestamp match (window +-120s) -> upgrade path: spatial-temporal spline interpolation
function findClosestMccsRecord(sortedMccs, targetTime, maxToleranceMs = 120000) {
  if (!sortedMccs || sortedMccs.length === 0) return null;
  let low = 0;
  let high = sortedMccs.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const diff = sortedMccs[mid].time - targetTime;
    if (diff === 0) return sortedMccs[mid].item;
    if (diff < 0) low = mid + 1;
    else high = mid - 1;
  }

  let best = null;
  let bestDiff = Infinity;
  for (let i = Math.max(0, high - 1); i <= Math.min(sortedMccs.length - 1, low + 1); i++) {
    const diff = Math.abs(sortedMccs[i].time - targetTime);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = sortedMccs[i].item;
    }
  }

  return bestDiff <= maxToleranceMs ? best : null;
}

function enrichRouteWithMccsHistory(positions, mccsHistory = [], status = null) {
  if (!positions || positions.length === 0) return positions;

  const sortedMccs = (mccsHistory || [])
    .map(item => ({ time: getMccsTimestamp(item), item }))
    .filter(x => x.time > 0)
    .sort((a, b) => a.time - b.time);

  const statusTags = status?.tags || {};

  return positions.map(p => {
    const pTime = new Date(p.deviceTime || 0).getTime();
    const matchedMccs = findClosestMccsRecord(sortedMccs, pTime, 120000);

    if (!matchedMccs) {
      return {
        ...p,
        attributes: {
          ...p.attributes,
          ...statusTags,
        },
      };
    }

    const d = matchedMccs.data ?? matchedMccs;
    const mccsAttrs = normalizeMccsToAttributes(matchedMccs);
    const speed = d?.kph !== undefined ? parseFloat(d.kph) : (p.speed || 0);
    const course = d?.dir !== undefined ? parseFloat(d.dir) : (p.course || 0);
    const altitude = d?.alt !== undefined ? parseFloat(d.alt) : (p.altitude || 0);

    let ignition = undefined;
    if (d?.addr?.IGN !== undefined) {
      ignition = d.addr.IGN === 1;
    } else if (d?.gpio !== undefined) {
      ignition = (d.gpio & 1) === 1;
    }

    const voltage = d?.volt !== undefined ? d.volt : (d?.addr?.EB !== undefined ? d.addr.EB : status?.voltage);
    const running = calcRunningStatus(ignition, speed);
    const serverTime = matchedMccs.insDtm ? toUtcIso(matchedMccs.insDtm) || p.serverTime : p.serverTime;

    return {
      ...p,
      serverTime,
      speed,
      course,
      altitude,
      attributes: {
        ...p.attributes,
        ...statusTags,
        ...(ignition !== undefined ? { ignition } : {}),
        ...(voltage !== undefined ? { voltage } : {}),
        ...(d?.sats !== undefined ? { sats: d.sats } : {}),
        ...(running ? { running } : {}),
        ...mccsAttrs,
      },
    };
  });
}

async function getDeviceRoute(deviceId, params = {}) {
  const [routeRes, mccsHistory, statusRes] = await Promise.allSettled([
    getApi().get(`/v3/devices/${deviceId}/route`, { params }),
    getDeviceMccsHistory(deviceId, { from: params.from, to: params.to }),
    getDeviceStatus(deviceId),
  ]);

  const rawPositions = routeRes.status === 'fulfilled' ? (routeRes.value.data?.data || []) : [];
  const positions = rawPositions.map((p) => normalizePosition(deviceId, p)).reverse();
  const mccsData = mccsHistory.status === 'fulfilled' ? (mccsHistory.value || []) : [];
  const status = statusRes.status === 'fulfilled' ? statusRes.value : null;

  return enrichRouteWithMccsHistory(positions, mccsData, status);
}

async function getDeviceStatus(deviceId, options = {}) {
  const reqConfig = {};
  if (options.timeout) reqConfig.timeout = options.timeout;
  const res = await getApi().get(`/v3/devices/${deviceId}/status`, reqConfig);
  return res.data;
}

async function getDeviceStatusList(params = {}, options = {}) {
  const { timeout, ...queryParams } = params;
  const reqTimeout = options.timeout || timeout;
  const reqConfig = { params: queryParams };
  if (reqTimeout) reqConfig.timeout = reqTimeout;
  const res = await getApi().get('/v3/devices/status', reqConfig);
  return res.data;
}

async function activateDevice(deviceId, desiredStatus) {
  const res = await getApi().put(`/v3/devices/${deviceId}/activation`, { desiredStatus });
  return res.data;
}

async function getCommandHistory(deviceId, params = {}) {
  const res = await getApi().get(`/v2/device/${deviceId}/command`, { params });
  return res.data;
}

async function init() {
  try {
    const token = await getAccessToken();
    updateApiClient(token);
    scheduleTokenRefresh();
  } catch (err) {
    logger.warn('[MSPF] Initial auth failed, retrying in 5s...');
    setTimeout(init, 5000).unref();
  }
}

init().catch(() => { });

async function getDeviceParking(deviceId, params = {}) {
  const res = await getApi().get(`/v3/stats/devices/${deviceId}/parking`, { params });
  return res.data;
}

async function getDeviceParkingAll(deviceId, params = {}) {
  const results = [];
  let next = null;
  do {
    const page = await getDeviceParking(deviceId, { ...params, start: next });
    results.push(...(page.data || []));
    next = page.next;
  } while (next && results.length < 1000);
  return results;
}

async function getDeviceTrip(deviceId, params = {}) {
  const res = await getApi().get(`/v4/stats/devices/${deviceId}/trip`, { params });
  return res.data;
}

async function getStatsSummary(params = {}) {
  const res = await getApi().get('/v3/stats/devices/summary', { params });
  return res.data;
}

const statsReportsCache = new NodeCache({ stdTTL: 3600, checkperiod: 300 });

async function getDeviceStatsReports(deviceId, params = {}) {
  const cacheKey = `stats:device:${deviceId}:${params.startDate || ''}:${params.endDate || ''}`;
  const cached = statsReportsCache.get(cacheKey);
  if (cached) return cached;
  const results = [];
  let start;
  let pages = 0;
  do {
    const query = { ...params, dimensions: 'DAILY', timezone: 'UTC', limit: 100 };
    if (start) query.start = start;
    const res = await getApi().get(`/v3/stats/devices/${deviceId}/reports`, { params: query });
    results.push(...(res.data?.data || []));
    start = res.data?.next;
    pages++;
    if (pages > 50) break;
  } while (start);
  try { statsReportsCache.set(cacheKey, results); } catch { }
  return results;
}

async function getBcStatsReports(bcId, params = {}) {
  const cacheKey = `stats:bc:${bcId}:${params.startDate || ''}:${params.endDate || ''}`;
  const cached = statsReportsCache.get(cacheKey);
  if (cached) return cached;
  const results = [];
  let start;
  let pages = 0;
  do {
    const query = { ...params, bcId, dimensions: 'DAILY', timezone: 'UTC', limit: 1000 };
    if (start) query.start = start;
    const res = await getApi().get('/v3/stats/devices/reports', { params: query });
    results.push(...(res.data?.data || []));
    start = res.data?.next;
    pages++;
    if (pages > 50) break;
  } while (start);
  try { statsReportsCache.set(cacheKey, results); } catch { }
  return results;
}

async function getMspfEvents(params = {}) {
  const res = await getApi().get('/v4/events', { params });
  return res.data?.data || res.data || [];
}

async function getMspfClosedEvents(params = {}) {
  const res = await getApi().get('/v4/closed-events', { params });
  return res.data?.data || res.data || [];
}

async function getMonitors(params = {}) {
  const res = await getApi().get('/v4/monitors', { params });
  return res.data?.data || res.data || [];
}

let mccsWorkerTimer = null;

const guardedMccsSync = guardedJob({
  name: 'MccsWorker',
  timeoutMs: 60000,
  jobFn: runMccsSyncImpl,
});

async function runMccsSyncOnce() {
  const res = await guardedMccsSync();
  if (res.status === 'skipped') return;
  if (res.status === 'error') throw res.error;
  return res.result;
}

async function runMccsSyncImpl(isActive) {
  const cache = require('./cache');
  const merged = cache.get('devices:merged') || [];
  const mspfIds = merged.filter(d => d.source === 'mspf').map(d => d.id);
  if (mspfIds.length === 0) return;

  const now = Date.now();
  for (const [pId, pInfo] of mccsPausedDevices.entries()) {
    if (now - pInfo.pausedAt >= pInfo.pauseDurationMs) {
      mccsPausedDevices.delete(pId);
    }
  }

  const activeSet = new Set(mspfIds);
  for (const id of mccsStore.keys()) {
    if (!activeSet.has(id)) {
      mccsStore.delete(id);
      mccsFetchTimes.delete(id);
    }
  }
  for (const id of mccsPausedDevices.keys()) {
    if (!activeSet.has(id)) {
      mccsPausedDevices.delete(id);
    }
  }

  if (mccsCycleDeviceList.length === 0 || mccsSyncOffset >= mccsCycleDeviceList.length) {
    if (mccsCycleStats.cycleStartedAt > 0) {
      mccsCompletedCycles++;
      const cycleDuration = Date.now() - mccsCycleStats.cycleStartedAt;
      logger.info(`[MccsWorker] cycle completed: ${mccsCycleStats.fetchedThisCycle}/${mccsCycleStats.totalDevices} in ${cycleDuration}ms`);

      const covered = mspfIds.filter(id => mccsStore.has(id)).length;
      logger.info(`[MccsWorker] cycle devices: ${covered} with data, ${mccsPausedDevices.size} paused`);

      const failureParts = [];
      for (const [category, data] of Object.entries(mccsFailureStats)) {
        if (data.count > 0) {
          const samples = data.sampleIds.length > 0 ? ` (samples: ${data.sampleIds.join(', ')})` : '';
          failureParts.push(`${category}=${data.count}${samples}`);
        }
      }
      if (failureParts.length > 0) {
        logger.warn(`[MccsWorker] cycle failures: ${failureParts.join('; ')}`);
      }

      const unpausedIds = mspfIds.filter(id => !mccsPausedDevices.has(id));
      const staleCount = unpausedIds.filter(id => {
        const t = mccsFetchTimes.get(id);
        return t && (Date.now() - t) > MCCS_STALE_THRESHOLD_MS;
      }).length;
      const missingCount = unpausedIds.filter(id => !mccsFetchTimes.has(id)).length;

      if (staleCount > 0) {
        logger.warn(`[MccsWorker] ${staleCount} device(s) with stale MCCS data (>5min)`);
      }
      if (missingCount > 0) {
        logger.warn(`[MccsWorker] ${missingCount} device(s) missing MCCS data after full cycle`);
      }

      mccsLastCycleFailures = JSON.parse(JSON.stringify(mccsFailureStats));
      mccsFailureStats = createEmptyFailureStats();
    }

    mccsCycleDeviceList = mspfIds.filter(id => !mccsPausedDevices.has(id));
    mccsSyncOffset = 0;
    mccsFirstFullAt = 0;
    mccsCycleStats = {
      totalDevices: mccsCycleDeviceList.length,
      fetchedThisCycle: 0,
      cycleStartedAt: Date.now(),
      timeToFullMs: 0,
    };
  }

  const batchSet = new Set();
  const slice = [];

  while (mccsPriorityQueue.length > 0 && slice.length < MCCS_CHUNK_SIZE) {
    const pId = mccsPriorityQueue.shift();
    if (activeSet.has(pId) && !batchSet.has(pId)) {
      batchSet.add(pId);
      slice.push(pId);
    }
  }

  while (slice.length < MCCS_CHUNK_SIZE && mccsSyncOffset < mccsCycleDeviceList.length) {
    const id = mccsCycleDeviceList[mccsSyncOffset++];
    if (!batchSet.has(id) && !mccsPausedDevices.has(id)) {
      batchSet.add(id);
      slice.push(id);
    }
  }

  if (slice.length === 0) {
    return;
  }

  let successCount = 0;
  for (let i = 0; i < slice.length; i += MCCS_CONCURRENCY) {
    const batch = slice.slice(i, i + MCCS_CONCURRENCY);
    const fetched = await Promise.allSettled(batch.map(id => fetchLatestMccsRecord(id)));
    for (let j = 0; j < batch.length; j++) {
      const id = batch[j];
      const outcome = fetched[j].status === 'fulfilled'
        ? fetched[j].value
        : { ok: false, errorType: classifyMccsError(fetched[j].reason) };
      if (outcome.ok && outcome.data && isActive()) {
        mccsStore.set(id, outcome.data);
        mccsFetchTimes.set(id, Date.now());
        mccsPausedDevices.delete(id);
        successCount++;
      } else if (outcome.errorType === 'empty_data') {
        const lastT = getLastKnownDeviceTime(id);
        const existing = mccsPausedDevices.get(id);
        if (existing && existing.reactivatedOnce) {
          const pauseDurationMs = getRandomPauseDuration();
          mccsPausedDevices.set(id, {
            pausedAt: Date.now(),
            pauseDurationMs,
            lastDeviceTime: lastT,
            reactivatedOnce: true,
            hardJeda: true,
          });
          logger.info(`[MccsWorker] device ${id} still empty_data after reactivation, entering full pause (${Math.round(pauseDurationMs / 60000)}m)`);
        } else {
          mccsPausedDevices.set(id, {
            pausedAt: Date.now(),
            pauseDurationMs: getRandomPauseDuration(),
            lastDeviceTime: lastT,
            reactivatedOnce: false,
            hardJeda: false,
          });
        }
      } else {
        recordMccsFailure(outcome.errorType || 'other', id);
      }
    }
  }

  mccsCycleStats.fetchedThisCycle += successCount;

  const covered = mspfIds.filter(id => mccsStore.has(id)).length;
  const targetCoverage = mspfIds.filter(id => !mccsPausedDevices.has(id)).length;
  if (mccsFirstFullAt === 0 && covered >= targetCoverage && targetCoverage > 0) {
    mccsFirstFullAt = Date.now();
    mccsCycleStats.timeToFullMs = mccsFirstFullAt - mccsCycleStats.cycleStartedAt;
    logger.info(`[MccsWorker] 100% coverage reached in ${mccsCycleStats.timeToFullMs}ms`);
  }

  logger.info(`[MccsWorker] batch ${slice.length} devs, ${successCount} ok, coverage ${covered}/${mspfIds.length}`);
}

function startMccsWorker(intervalMs) {
  if (mccsWorkerTimer) return;
  const interval = intervalMs || MCCS_WORKER_INTERVAL_MS;
  mccsWorkerTimer = setInterval(runMccsSyncOnce, interval);
  if (mccsWorkerTimer.unref) mccsWorkerTimer.unref();
}

function stopMccsWorker() {
  if (mccsWorkerTimer) {
    clearInterval(mccsWorkerTimer);
    mccsWorkerTimer = null;
  }
}

function getMccsStats() {
  const allFetchTimes = [...mccsFetchTimes.values()];
  const now = Date.now();
  const maxAge = allFetchTimes.length > 0
    ? now - Math.min(...allFetchTimes)
    : 0;
  const minAge = allFetchTimes.length > 0
    ? now - Math.max(...allFetchTimes)
    : 0;

  const cache = require('./cache');
  const merged = cache.get('devices:merged') || [];
  const mspfIds = merged.filter(d => d.source === 'mspf').map(d => d.id);
  const unpausedIds = mspfIds.filter(id => !mccsPausedDevices.has(id));

  const staleCount = unpausedIds.filter(id => {
    const t = mccsFetchTimes.get(id);
    return t && (now - t) > MCCS_STALE_THRESHOLD_MS;
  }).length;

  const isFirstCycleDone = mccsCompletedCycles >= 1 || (mccsCycleDeviceList.length > 0 && mccsSyncOffset >= mccsCycleDeviceList.length);
  const missingCount = isFirstCycleDone
    ? unpausedIds.filter(id => !mccsFetchTimes.has(id)).length
    : 0;

  const currentFailuresTotal = Object.values(mccsFailureStats).reduce((sum, f) => sum + f.count, 0);
  const activeFailures = (currentFailuresTotal === 0 && mccsLastCycleFailures)
    ? mccsLastCycleFailures
    : mccsFailureStats;

  const failures = {};
  const failureSamples = {};
  for (const [k, v] of Object.entries(activeFailures)) {
    failures[k] = v.count;
    failureSamples[k] = [...v.sampleIds];
  }

  return {
    storeSize: mccsStore.size,
    isSyncing: guardedMccsSync.isRunning(),
    offset: mccsSyncOffset,
    coverage: mccsCycleStats.fetchedThisCycle,
    totalDevices: mccsCycleStats.totalDevices,
    cycleStartedAt: mccsCycleStats.cycleStartedAt,
    maxAgeMs: maxAge,
    minAgeMs: minAge,
    staleCount,
    missingCount,
    pausedCount: mccsPausedDevices.size,
    priorityQueueLength: mccsPriorityQueue.length,
    timeToFullMs: mccsCycleStats.timeToFullMs,
    completedCycles: mccsCompletedCycles,
    failures,
    failureSamples,
  };
}

function resetMccsWorkerState() {
  guardedMccsSync._resetForTests?.();
  mccsSyncOffset = 0;
  mccsCompletedCycles = 0;
  mccsCycleStats = { totalDevices: 0, fetchedThisCycle: 0, cycleStartedAt: 0, timeToFullMs: 0 };
  mccsFirstFullAt = 0;
  mccsStore.clear();
  mccsFetchTimes.clear();
  mccsFailureStats = createEmptyFailureStats();
  mccsLastCycleFailures = null;
  mccsPausedDevices.clear();
  mccsPriorityQueue.length = 0;
  mccsDeviceLastTimes.clear();
  mccsCycleDeviceList = [];
}

module.exports = {
  init, waitForInit, getApi, updateApiClient, normalizeDevice, normalizePosition, enrichDevice,
  getDevices, searchDevices, getDevice, getBcList, getBc,
  getPositions, getDeviceRoute,
  getDeviceMccsHistory, enrichRouteWithMccsHistory,
  getDeviceStatus, getDeviceStatusList,
  activateDevice, getCommandHistory,
  getDeviceParking, getDeviceParkingAll,
  getDeviceTrip,
  getStatsSummary,
  getDeviceStatsReports,
  getBcStatsReports,
  getMspfEvents,
  getMspfClosedEvents,
  getMonitors,
  startMccsWorker,
  stopMccsWorker,
  runMccsSyncOnce,
  getMccsStats,
  resetMccsWorkerState,
  notifyDevicePosition,
  getBatchMccsData,
  getMccsForDevice,
};
