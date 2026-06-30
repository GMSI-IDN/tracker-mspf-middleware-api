const { classifyAxiosError } = require('../utils/axiosError');
const { logger } = require('../middleware/logger');
const { calcRunningStatus } = require('../utils/deviceStatus');

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

// ── Normalizers ───────────────────────────────────────

function normalizeDevice(d) {
  const name = d.name || d.tags?.VIN || d.tags?.mobilityNo || d.tags?.identity || d.tags?.deviceSerialNo || `${d.id}`;
  return {
    id: d.id, name, uniqueId: d.uniqueId || d.imei || `${d.id}`,
    status: d.status === 'WORKING' ? 'online' : 'offline',
    phone: d.mobileNo || undefined, model: d.deviceType || undefined,
    source: 'mspf', group: `mspf_${d.bcId}`,
    lastUpdate: d.lastCommunicatedAt || undefined,
    voltage: d.tags?.volt ?? undefined,
    internalBattery: d.tags?.addr_IB ?? undefined,
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
    deviceTime: pos.deviceTime || (pos.timestamp ? new Date(pos.timestamp * 1000).toISOString() : new Date().toISOString()),
    serverTime: pos.serverTime || new Date().toISOString(),
    fixTime: pos.fixTime || pos.deviceTime || (pos.timestamp ? new Date(pos.timestamp * 1000).toISOString() : new Date().toISOString()),
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

const mccsDataCache = {};
const mccsCacheOrder = [];
let MCCS_CACHE_TTL = 10000;
let MCCS_CACHE_MAX = 200;
try {
  const cfg = require('../config');
  MCCS_CACHE_TTL = cfg.mspf.cacheTtl;
} catch {}

function setMccsCache(id, data) {
  mccsDataCache[id] = { data, ts: Date.now() };
  const pos = mccsCacheOrder.indexOf(id);
  if (pos >= 0) mccsCacheOrder.splice(pos, 1);
  mccsCacheOrder.push(id);
  while (mccsCacheOrder.length > MCCS_CACHE_MAX) {
    const oldest = mccsCacheOrder.shift();
    delete mccsDataCache[oldest];
  }
}

function getMccsCache(id) {
  const entry = mccsDataCache[id];
  if (!entry || (Date.now() - entry.ts) > MCCS_CACHE_TTL) return undefined;
  return entry.data;
}

async function getLatestMccsData(deviceId) {
  try {
    const res = await getApi().get(`/v2/device/${deviceId}/data/history`, {
      params: { to: new Date().toISOString(), limit: 5 },
      timeout: 10000,
    });
    const items = res.data?.data;
    if (items && items.length > 0) {
      return items[items.length - 1].data;
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
  const toFetch = activeIds.filter(id => getMccsCache(id) === undefined);
  const fromCache = activeIds.filter(id => getMccsCache(id) !== undefined);

  for (const id of fromCache) results[id] = getMccsCache(id);
  for (const id of ids.filter(id => !activeIds.includes(id))) results[id] = null;

  if (toFetch.length > 0) {
    const fetched = await Promise.allSettled(toFetch.map(id => getLatestMccsData(id)));
    for (let i = 0; i < toFetch.length; i++) {
      const id = toFetch[i];
      const data = fetched[i].status === 'fulfilled' ? fetched[i].value : null;
      if (data) setMccsCache(id, data);
      results[id] = data;
    }
  }

  return results;
}

function normalizeMccsToAttributes(mccsData) {
  if (!mccsData) return {};
  return {
    tid: mccsData.tid, mid: mccsData.mid, ts: mccsData.ts, code: mccsData.code,
    kph: mccsData.kph, alt: mccsData.alt, dir: mccsData.dir,
    hdop: mccsData.hdop, sats: mccsData.sats,
    odom: mccsData.odom, volt: mccsData.volt,
    gpio: mccsData.gpio, accm: mccsData.accm,
    ver: mccsData.ver, sno: mccsData.sno,
    diff: mccsData.diff, gtm: mccsData.gtm,
    relay: mccsData.relay, mode: mccsData.mode,
    addr_IGN: mccsData.addr?.IGN, addr_FIX: mccsData.addr?.FIX,
    addr_EB: mccsData.addr?.EB, addr_IB: mccsData.addr?.IB,
    addr_AD: mccsData.addr?.AD, addr_AD2: mccsData.addr?.AD2,
    addr_TE: mccsData.addr?.TE, addr_RS: mccsData.addr?.RS,
    addr_NT: mccsData.addr?.NT,
    addr_x: mccsData.addr?.x, addr_y: mccsData.addr?.y, addr_z: mccsData.addr?.z,
  };
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

  const mccsMap = await getBatchMccsData(deviceIds, statusMap);

  return positions.map(p => {
    const st = statusMap[p.deviceId];
    const mccs = mccsMap[p.deviceId];
    const mccsAttrs = normalizeMccsToAttributes(mccs);
    const kph = mccs?.kph;
    const ignition = st?.ignition === 'ON' ? true : (st?.ignition === 'OFF' ? false : undefined);
    const mspfRunning = st?.running?.status;
    const speed = kph || p.speed || st?.speed || 0;
    const lastUpdate = p.deviceTime || st?.lastCommunicatedAt;
    const running = mspfRunning && mspfRunning !== 'UNKNOWN' ? mspfRunning : calcRunningStatus(ignition, speed, lastUpdate);

    return {
      ...p,
      speed: p.speed || st?.speed || 0,
      course: p.course || mccs?.dir || 0,
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
    lastCommunicatedAt: status.lastCommunicatedAt || undefined,
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

function normalizeMccsForDeviceDetail(mccsData) {
  if (!mccsData) return {};
  return {
    mobilityData: {
      tid: mccsData.tid, mid: mccsData.mid, ts: mccsData.ts, code: mccsData.code,
      kph: mccsData.kph, lat: mccsData.lat, lon: mccsData.lon,
      alt: mccsData.alt, dir: mccsData.dir,
      hdop: mccsData.hdop, sats: mccsData.sats,
      odom: mccsData.odom, volt: mccsData.volt,
      gpio: mccsData.gpio, accm: mccsData.accm,
      ver: mccsData.ver, sno: mccsData.sno,
      diff: mccsData.diff, gtm: mccsData.gtm,
      relay: mccsData.relay, mode: mccsData.mode,
      addr: {
        IGN: mccsData.addr?.IGN, FIX: mccsData.addr?.FIX,
        EB: mccsData.addr?.EB, IB: mccsData.addr?.IB,
        AD: mccsData.addr?.AD, AD2: mccsData.addr?.AD2,
        TE: mccsData.addr?.TE, RS: mccsData.addr?.RS,
        NT: mccsData.addr?.NT,
        x: mccsData.addr?.x, y: mccsData.addr?.y, z: mccsData.addr?.z,
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
    internalBattery: enrichedAttrs.addr_IB ?? undefined,
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
  const res = await getApi().get('/v3/devices/positions', { params });
  const positions = normalizePositionsResponse(res.data);
  return enrichPositions(positions);
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

init().catch(() => {});

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

async function getMspfEvents(params = {}) {
  const res = await getApi().get('/v4/events', { params });
  return res.data?.data || res.data || [];
}

async function getMspfClosedEvents(params = {}) {
  const res = await getApi().get('/v4/closed-events', { params });
  return res.data?.data || res.data || [];
}

module.exports = {
  init, getApi, normalizeDevice, normalizePosition, enrichDevice,
  getDevices, searchDevices, getDevice, getBcList, getBc,
  getPositions, getDeviceRoute,
  getDeviceStatus, getDeviceStatusList,
  activateDevice, getCommandHistory,
  getDeviceParking, getDeviceParkingAll,
  getDeviceTrip,
  getStatsSummary,
  getMspfEvents,
  getMspfClosedEvents,
};
