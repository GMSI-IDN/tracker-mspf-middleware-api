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
    internalBattery: d.tags?.addr_IB ?? mccsCache.get(d.id)?.data?.addr?.IB ?? undefined,
    batteryLevel: undefined,
    ignition: undefined,
    attributes: {
      ...(d.tags || {}),
      bcId: d.bcId,
      deviceTypeId: d.deviceTypeId,
      activationStatus: d.activationCurrentStatus || undefined,
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
let mccsCacheTtl = 10000;
try {
  const cfg = require('../config');
  mccsCacheTtl = cfg.mspf.cacheTtl;
} catch { }
const mccsCache = new NodeCache({
  stdTTL: Math.ceil(mccsCacheTtl / 1000),
  checkperiod: 5,
});

async function getLatestMccsData(deviceId) {
  try {
    const res = await getApi().get(`/v2/device/${deviceId}/data/history`, {
      params: { to: new Date().toISOString(), limit: 5 },
      timeout: 10000,
    });
    const items = res.data?.data;
    if (items && items.length > 0) {
      return items[items.length - 1];
    }
    return null;
  } catch {
    return null;
  }
}

async function getBatchMccsData(deviceIds, statusMap = {}) {
  const now = Date.now();
  const ids = [...new Set(deviceIds.filter(Boolean))];
  const activeIds = ids.filter(id => {
    const s = statusMap[id];
    if (!s?.lastCommunicatedAt) return false;
    return (now - new Date(s.lastCommunicatedAt).getTime()) < 30 * 24 * 3600 * 1000;
  });

  const results = {};
  const fromCacheIds = activeIds.filter(id => mccsCache.has(id));

  for (const id of fromCacheIds) results[id] = mccsCache.get(id);
  for (const id of ids.filter(id => !activeIds.includes(id))) results[id] = null;

  const toFetch = activeIds.filter(id => !mccsCache.has(id));
  if (toFetch.length > 0) {
    const CONCURRENCY = 10;
    for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
      const batch = toFetch.slice(i, i + CONCURRENCY);
      const fetched = await Promise.allSettled(batch.map(id => getLatestMccsData(id)));
      for (let j = 0; j < batch.length; j++) {
        const id = batch[j];
        const data = fetched[j].status === 'fulfilled' ? fetched[j].value : null;
        if (data) { try { mccsCache.set(id, data); } catch { } }
        results[id] = data;
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

async function enrichPositions(positions) {
  if (!positions || positions.length === 0) return positions;
  const deviceIds = [...new Set(positions.map(p => p.deviceId).filter(Boolean))];

  let statusResult = null;
  if (deviceIds.length <= 200) {
    statusResult = await getDeviceStatusList({ limit: 200 });
  } else {
    let all = []; let start = undefined;
    do {
      const res = await getApi().get('/v3/devices/status', { params: { limit: 200, start } });
      all.push(...(res.data?.data || []));
      start = res.data?.next;
    } while (start);
    statusResult = { data: all };
  }
  const statusMap = {};
  if (statusResult?.data) {
    for (const s of statusResult.data) statusMap[s.deviceId] = s;
  }

  let mccsMap = {};
  try { mccsMap = await getBatchMccsData(deviceIds, statusMap); } catch { };

  const latestTimes = {};
  for (const p of positions) {
    const t = new Date(p.deviceTime || 0).getTime();
    if (!Number.isNaN(t) && t > (latestTimes[p.deviceId] || 0)) latestTimes[p.deviceId] = t;
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

  const enrichedAttrs = { ...device.attributes, ...mccs, ...(st?.tags ? { tags: st.tags } : {}) };

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

async function getDevices(params = {}) {
  let all = [];
  let start = undefined;
  let total = 0;
  let pageCount = 0;
  do {
    const query = { ...params, status: 'WORKING', limit: 200 };
    if (start) query.start = start;
    const res = await getApi().get('/v3/devices', { params: query });
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

async function getBcList(params = {}) {
  const res = await getApi().get('/v2/bc', { params });
  return res.data;
}

async function getBc(bcId) {
  const res = await getApi().get(`/v2/bc/${bcId}`);
  return res.data;
}

async function getPositions(params = {}) {
  let all = [];
  let start = undefined;
  do {
    const query = { ...params, limit: 1000 };
    if (start) query.start = start;
    const res = await getApi().get('/v3/devices/positions', { params: query });
    const page = normalizePositionsResponse(res.data);
    all.push(...page);
    start = res.data.next;
  } while (start);
  return enrichPositions(all);
}

async function getDeviceRoute(deviceId, params = {}) {
  const res = await getApi().get(`/v3/devices/${deviceId}/route`, { params });
  const positions = (res.data.data || []).map((p) => normalizePosition(deviceId, p));
  return enrichPositions(positions.reverse());
}

async function getDeviceStatus(deviceId) {
  const res = await getApi().get(`/v3/devices/${deviceId}/status`);
  return res.data;
}

async function getDeviceStatusList(params = {}) {
  const res = await getApi().get('/v3/devices/status', { params });
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

module.exports = {
  init, waitForInit, getApi, normalizeDevice, normalizePosition, enrichDevice,
  getDevices, searchDevices, getDevice, getBcList, getBc,
  getPositions, getDeviceRoute,
  getDeviceStatus, getDeviceStatusList,
  activateDevice, getCommandHistory,
  getDeviceParking, getDeviceParkingAll,
  getDeviceTrip,
  getStatsSummary,
  getDeviceStatsReports,
  getBcStatsReports,
  getMspfEvents,
  getMspfClosedEvents,
};
