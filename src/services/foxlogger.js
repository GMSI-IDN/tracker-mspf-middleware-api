const { classifyAxiosError } = require('../utils/axiosError');
const { logger } = require('../middleware/logger');
const { toUtcIso } = require('../utils/timestamp');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const config = require('../config');

let foxloggerApi = null;
let refreshToken = null;
let tokenExpiresAt = 0;
let refreshTimer = null;
let cachedUserId = null;
const imeiMap = new Map();

function resolveImei(deviceId) {
  if (imeiMap.has(deviceId)) return imeiMap.get(deviceId);
  const strId = String(deviceId);
  if (strId.length >= 15 && !strId.startsWith('0')) {
    const padded = strId.padStart(16, '0');
    if (imeiMap.has(parseInt(padded, 10))) return imeiMap.get(parseInt(padded, 10));
  }
  return strId;
}

const AUTH_REFRESH_MARGIN = 60;

// ── Auth ─────────────────────────────────────────────

async function getAccessToken() {
  const authHeader = 'Basic ' + Buffer.from(
    `${config.foxlogger.email}:${config.foxlogger.password}`
  ).toString('base64');

  try {
    const res = await axios.get('https://api-auth.foxlogger.app/users/authentication', {
      headers: { Authorization: authHeader },
      timeout: 10000,
    });

    const data = res.data?.data;
    if (!data?.access_token) throw new Error('No access_token in response');

    refreshToken = data.refresh_token;

    // Extract user_id from JWT payload
    const decoded = jwt.decode(data.access_token);
    cachedUserId = decoded?.id || decoded?.user_id || decoded?.sub || null;

    // Estimate expiry (JWT tokens typically 1h)
    const exp = decoded?.exp;
    tokenExpiresAt = exp
      ? (exp - AUTH_REFRESH_MARGIN) * 1000
      : Date.now() + 55 * 60 * 1000;

    logger.info('[FoxLogger] JWT token acquired, user_id:', cachedUserId);
    return data.access_token;
  } catch (err) {
    logger.error('[FoxLogger] Failed to authenticate:', err.response?.data || err.message);
    throw err;
  }
}

async function refreshAccessToken() {
  if (!refreshToken) return getAccessToken();
  try {
    const res = await axios.post(
      'https://api-auth.foxlogger.app/users/refresh-token',
      null,
      { headers: { Authorization: `Bearer ${refreshToken}` }, timeout: 10000 }
    );
    const data = res.data?.data;
    if (!data?.access_token) throw new Error('No access_token in refresh response');
    refreshToken = data.refresh_token;
    const decoded = jwt.decode(data.access_token);
    cachedUserId = decoded?.id || decoded?.user_id || decoded?.sub || null;
    const exp = decoded?.exp;
    tokenExpiresAt = exp
      ? (exp - AUTH_REFRESH_MARGIN) * 1000
      : Date.now() + 55 * 60 * 1000;
    logger.info('[FoxLogger] Token refreshed');
    return data.access_token;
  } catch (err) {
    logger.warn('[FoxLogger] Token refresh failed, re-authenticating...');
    return getAccessToken();
  }
}

function scheduleTokenRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  const delay = Math.max(tokenExpiresAt - Date.now(), 5000);
  refreshTimer = setTimeout(async () => {
    try {
      const token = await refreshAccessToken();
      updateApiClient(token);
    } catch (err) {
      logger.error('[FoxLogger] Token refresh failed, retrying in 30s');
      refreshTimer = setTimeout(() => scheduleTokenRefresh(), 30000).unref();
    }
  }, delay).unref();
}

function updateApiClient(token) {
  foxloggerApi = axios.create({
    baseURL: 'https://api-v2.foxlogger.app',
    timeout: config.requestTimeout,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  foxloggerApi.interceptors.response.use(
    (res) => res,
    async (err) => {
      if (err.response?.status === 401) {
        logger.warn('[FoxLogger] Token expired, refreshing...');
        try {
          const newToken = await refreshAccessToken();
          updateApiClient(newToken);
          err.config.headers.Authorization = `Bearer ${newToken}`;
          const retryRes = await axios(err.config);
          return retryRes;
        } catch (refreshErr) {
          logger.error('[FoxLogger] Token refresh on 401 failed:', refreshErr.message);
        }
      }
      const classified = classifyAxiosError(err);
      logger.warn(`[FoxLogger] ${err.config?.method?.toUpperCase()} ${err.config?.url} (${classified.status} ${classified.code})`);
      return Promise.reject(classified);
    }
  );
}

function getApi() {
  if (!foxloggerApi) {
    throw Object.assign(new Error('FoxLogger API not initialized'), {
      status: 502,
      code: 'ERR_BAD_GATEWAY',
    });
  }
  return foxloggerApi;
}

async function waitForInit(timeout = 15000) {
  if (!config.foxlogger.email || !config.foxlogger.password) return;
  const start = Date.now();
  while (!foxloggerApi) {
    if (Date.now() - start > timeout) throw new Error('FoxLogger init timeout');
    await new Promise((r) => setTimeout(r, 200));
  }
}

function getUserId() {
  return cachedUserId;
}

// ── Normalizers ───────────────────────────────────────

function normalizeDevice(d) {
    const name = d.vehicle_frame_number || d.unit || d.note || `FoxLogger_${d.imei}`;
    const rawLast = d.last_update && d.last_update !== '0000-00-00 00:00:00' ? d.last_update : null;
    const id = parseInt(d.imei, 10);
    imeiMap.set(id, d.imei);
    return {
      id,
      name, uniqueId: d.imei,
      status: d.movement_status === 'MISS' ? 'offline' : 'online',
      phone: d.simcard_number || undefined,
      model: d.tracker_type || undefined,
      source: 'foxlogger',
      group: d.group_id ? `foxlogger_${d.group_id}` : undefined,
      lastUpdate: toUtcIso(rawLast) || undefined,
    voltage: undefined,
    internalBattery: undefined,
    batteryLevel: undefined,
    ignition: undefined,
    attributes: {
      deviceId: d.device_id,
      imei: d.imei,
      trackerType: d.tracker_type,
      packageName: d.package_name || undefined,
      packageCode: d.package_code || undefined,
      activationDate: d.activation_date !== '0000-00-00' ? d.activation_date : undefined,
      expiredDate: d.expired_date !== '0000-00-00' ? d.expired_date : undefined,
      simcardNumber: d.simcard_number || undefined,
      simcardExpired: d.simcard_expired !== '0000-00-00' ? d.simcard_expired : undefined,
      vehicleType: d.vehicle_type || undefined,
      vehicleFrameNumber: d.vehicle_frame_number || undefined,
      vehicleMachineNumber: d.vehicle_machine_number || undefined,
      vehicleFuelConsumption: d.vehicle_fuel_consumption || undefined,
      vehicleStnkNumber: d.vehicle_stnk_number || undefined,
      vehicleStnkExpired: d.vehicle_stnk_expired || undefined,
      vehicleKirNumber: d.vehicle_kir_number || undefined,
      vehicleKirExpired: d.vehicle_kir_expired || undefined,
      mileage: d.mileage || undefined,
      groupName: d.group_name || undefined,
      movementStatus: d.movement_status,
      user_id: d.user_id,
      vendor: d.vendor || undefined,
    },
  };
}

function normalizeReportPosition(imei, pos) {
  if (!pos) return null;
  const simId = parseInt(imei, 10);
  imeiMap.set(simId, imei);
  return {
    deviceId: simId,
    latitude: parseFloat(pos.lo_lat) || 0,
    longitude: parseFloat(pos.lo_long) || 0,
    speed: 0,
    course: 0,
    altitude: 0,
    deviceTime: toUtcIso(pos.last_upd) || new Date().toISOString(),
    serverTime: new Date().toISOString(),
    fixTime: toUtcIso(pos.last_upd) || new Date().toISOString(),
    valid: true,
    source: 'foxlogger',
    attributes: {
      address: pos.address || undefined,
      movementStatus: pos.status,
      driverName: pos.drv || undefined,
      driverPhone: pos.drvphn || undefined,
      simcard: pos.sim || undefined,
      registrationDate: pos.reg_date || undefined,
      vehicleUnit: pos.unit || undefined,
      vin: pos.vin || undefined,
      nokir: pos.nokir || undefined,
    },
  };
}

function normalizeHistoryPosition(imei, pos) {
  if (!pos) return null;
  return {
    deviceId: parseInt(imei, 10),
    latitude: parseFloat(pos.lat) || 0,
    longitude: parseFloat(pos.long) || 0,
    speed: parseFloat(pos.Speed) || 0,
    course: 0,
    altitude: 0,
    deviceTime: toUtcIso(pos.time) || new Date().toISOString(),
    serverTime: new Date().toISOString(),
    fixTime: toUtcIso(pos.time) || new Date().toISOString(),
    valid: true,
    source: 'foxlogger',
    attributes: {
      distance: pos.Dist || undefined,
      mileage: pos.Mill || undefined,
      power: pos.Power || undefined,
      temperature: pos.Temp || undefined,
      address: pos.addr || undefined,
      ignition: pos.engi === 'ON',
    },
  };
}

// ── API Functions ──────────────────────────────────────

function fmtFoxTime(t) {
  if (!t) return undefined;
  return String(t).replace('T', ' ').replace(/\.[0-9]+Z?$/, '').slice(0, 19);
}

async function getDevices(params = {}) {
  const uid = cachedUserId || params.user_id;
  if (!uid) throw new Error('FoxLogger user_id not available');

  let devices = [];

  // Try device-lists first
  try {
    const res = await getApi().get(`/device-lists/${uid}`);
    devices = (res.data?.data || []).map(normalizeDevice);
    logger.debug(`FoxLogger devices (device-lists): ${devices.length}`);
  } catch (err) {
    // Fallback: build device list from report-position
    logger.warn(`[FoxLogger] device-lists failed (${err.status || err.code}), falling back to report-position`);
    try {
      const posRes = await getApi().get(`/web-tracker-staging/report-position/${uid}?status=MOVE,PARK,OFF,MISS`);
      const rawPositions = posRes.data?.data || [];
      devices = rawPositions.map((p) => {
        const id = parseInt(p.imei, 10);
        imeiMap.set(id, p.imei);
        return {
        id,
        name: p.unit || `FoxLogger_${p.imei}`,
        uniqueId: p.imei,
        status: p.status === 'MISS' ? 'offline' : 'online',
        phone: p.sim || undefined,
        model: undefined,
        source: 'foxlogger',
        group: undefined,
        lastUpdate: toUtcIso(p.last_upd) || undefined,
        voltage: undefined,
        internalBattery: undefined,
        batteryLevel: undefined,
        ignition: undefined,
        attributes: {
          imei: p.imei,
          vehicleUnit: p.unit || undefined,
          simcard: p.sim || undefined,
          movementStatus: p.status,
          registrationDate: p.reg_date || undefined,
          driverName: p.drv || undefined,
          driverPhone: p.drvphn || undefined,
          address: p.address || undefined,
          nokir: p.nokir || undefined,
          vin: p.vin || undefined,
          user_id: uid,
        },
      };
      });
      logger.debug(`FoxLogger devices (report-position fallback): ${devices.length}`);
    } catch (fallbackErr) {
      logger.error(`[FoxLogger] report-position fallback also failed: ${fallbackErr.status || fallbackErr.message}`);
      throw err; // Throw original error
    }
  }

  return { data: devices, total: devices.length, next: null };
}

async function searchDevices(query, params = {}) {
  const all = await getDevices(params);
  if (!query) return all.data;
  const q = query.toLowerCase();
  return all.data.filter(
    (d) =>
      d.name.toLowerCase().includes(q) ||
      d.uniqueId?.toLowerCase().includes(q) ||
      d.attributes?.vehicleFrameNumber?.toLowerCase().includes(q)
  );
}

function normalizeFoxLoggerPositionForDevice(device, posMap) {
  const pos = posMap[device.id];
  if (!pos) return device;

  return {
    ...device,
    lastUpdate: toUtcIso(pos.last_upd) || device.lastUpdate,
    attributes: {
      ...device.attributes,
      address: pos.address || undefined,
      movementStatus: pos.status || device.attributes?.movementStatus,
      driverName: pos.drv || undefined,
      driverPhone: pos.drvphn || undefined,
    },
  };
}

async function getPositions(params = {}) {
  const uid = cachedUserId || params.user_id;
  if (!uid) return [];

  // Get current positions from report-position endpoint
  const statusFilter = params.status || 'MOVE,PARK,OFF,MISS';
  const res = await getApi().get(`/web-tracker-staging/report-position/${uid}`, {
    params: { status: statusFilter },
  });

  const rawPositions = res.data?.data || [];
  const positions = [];

  for (const pos of rawPositions) {
    if (pos.imei) {
      const normalized = normalizeReportPosition(pos.imei, pos);
      if (normalized) positions.push(normalized);
    }
  }

  logger.debug(`FoxLogger positions fetched: ${positions.length}`);
  return positions;
}

async function getDeviceRoute(deviceId, params = {}) {
  const uid = cachedUserId || params.user_id;
  if (!uid || !deviceId) return [];

  const imei = resolveImei(deviceId);
  const time1 = fmtFoxTime(params.from) || fmtFoxTime(params.time1) || new Date(Date.now() - 86400000).toISOString().replace('T', ' ').slice(0, 19);
  const time2 = fmtFoxTime(params.to) || fmtFoxTime(params.time2) || new Date().toISOString().replace('T', ' ').slice(0, 19);

  const res = await getApi().get('/web-tracker-staging/report-history', {
    params: { imei, user_id: uid, time1, time2 },
  });

  const raw = res.data?.data || [];
  return raw.map((p) => normalizeHistoryPosition(imei, p)).filter(Boolean);
}

async function getDeviceParking(deviceId, params = {}) {
  const uid = cachedUserId || params.user_id;
  if (!uid || !deviceId) return [];

  const imei = resolveImei(deviceId);
  const time1 = fmtFoxTime(params.from) || fmtFoxTime(params.time1) || new Date(Date.now() - 86400000).toISOString().replace('T', ' ').slice(0, 19);
  const time2 = fmtFoxTime(params.to) || fmtFoxTime(params.time2) || new Date().toISOString().replace('T', ' ').slice(0, 19);

  const res = await getApi().get('/web-tracker-staging/report-park', {
    params: { imei, user_id: uid, time1, time2 },
  });

  return res.data?.data || [];
}

async function getDeviceSummary(deviceId, params = {}) {
  const uid = cachedUserId || params.user_id;
  if (!uid || !deviceId) return {};

  const imei = resolveImei(deviceId);
  const time1 = fmtFoxTime(params.from) || fmtFoxTime(params.time1) || new Date(Date.now() - 86400000).toISOString().replace('T', ' ').slice(0, 19);
  const time2 = fmtFoxTime(params.to) || fmtFoxTime(params.time2) || new Date().toISOString().replace('T', ' ').slice(0, 19);

  const res = await getApi().get('/web-tracker/report-summary', {
    params: { imei, user_id: uid, time1, time2 },
  });

  return res.data;
}

async function getGeoFences() {
  const uid = cachedUserId;
  if (!uid) return [];
  const res = await getApi().get(`/geo-fences/${uid}`);
  return res.data?.data || [];
}

async function getAlarmReports(params = {}) {
  const uid = cachedUserId || params.user_id;
  if (!uid) return [];
  const res = await getApi().get(`/web-tracker-staging/report-cut-power/${uid}`);
  return res.data?.data || [];
}

async function init() {
  if (!config.foxlogger.email || !config.foxlogger.password) {
    logger.warn('[FoxLogger] Credentials not configured, skipping init');
    return;
  }
  try {
    const token = await getAccessToken();
    updateApiClient(token);
    scheduleTokenRefresh();
    logger.info(`[FoxLogger] Initialized, user_id: ${cachedUserId}`);
  } catch (err) {
    logger.warn('[FoxLogger] Initial auth failed, retrying in 5s...');
    setTimeout(init, 5000).unref();
  }
}

// Auto-init on module load (only if credentials are configured)
if (config.foxlogger.email && config.foxlogger.password) {
  init().catch(() => {});
}

module.exports = {
  init,
  waitForInit,
  getApi,
  getUserId,
  resolveImei,
  normalizeDevice,
  normalizeReportPosition,
  normalizeHistoryPosition,
  getDevices,
  searchDevices,
  getPositions,
  getDeviceRoute,
  getDeviceParking,
  getDeviceSummary,
  getGeoFences,
  getAlarmReports,
};
