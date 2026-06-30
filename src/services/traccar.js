const { classifyAxiosError } = require('../utils/axiosError');
const { logger } = require('../middleware/logger');

const axios = require('axios');
const config = require('../config');

const authHeader = 'Basic ' + Buffer.from(`${config.traccar.username}:${config.traccar.password}`).toString('base64');

const traccarApi = axios.create({
  baseURL: config.traccar.url,
  timeout: config.requestTimeout,
  headers: {
    Authorization: authHeader,
    Accept: 'application/json',
  },
});

traccarApi.interceptors.response.use(
  (res) => res,
  (err) => {
    const classified = classifyAxiosError(err);
    logger.warn(`[Traccar] ${err.config?.method?.toUpperCase()} ${err.config?.url} (${classified.status} ${classified.code})`);
    return Promise.reject(classified);
  }
);

async function getDevices(params = {}) {
  const res = await traccarApi.get('/devices', { params });
  return res.data;
}

async function getGroups(params = {}) {
  const res = await traccarApi.get('/groups', { params });
  return res.data;
}

async function getPositions(params = {}) {
  const res = await traccarApi.get('/positions', { params });
  return (res.data || []).map(p => ({
    ...p,
    speed: p.speed ? parseFloat((p.speed * 1.852).toFixed(2)) : 0,
  }));
}

async function getCommands(params = {}) {
  const res = await traccarApi.get('/commands', { params });
  return res.data;
}

async function getCommandTypes(params = {}) {
  const res = await traccarApi.get('/commands/types', { params });
  return res.data;
}

async function sendCommand(data) {
  const res = await traccarApi.post('/commands/send', data);
  return res.data;
}

async function getHealth() {
  const res = await traccarApi.get('/health');
  return res.data;
}

async function getReportStops(params = {}) {
  const res = await traccarApi.get('/reports/stops', { params });
  return res.data;
}

async function getReportTrips(params = {}) {
  const res = await traccarApi.get('/reports/trips', { params });
  return (res.data || []).map(t => ({
    ...t,
    maxSpeed: t.maxSpeed ? parseFloat((t.maxSpeed * 1.852).toFixed(2)) : undefined,
    averageSpeed: t.averageSpeed ? parseFloat((t.averageSpeed * 1.852).toFixed(2)) : undefined,
    distance: t.distance ? parseFloat((t.distance / 1000).toFixed(2)) : undefined,
  }));
}

async function getReportSummary(params = {}) {
  const res = await traccarApi.get('/reports/summary', { params });
  return (res.data || []).map(s => ({
    deviceId: s.deviceId,
    deviceName: s.deviceName || '',
    maxSpeed: s.maxSpeed ? parseFloat((s.maxSpeed * 1.852).toFixed(2)) : undefined,
    averageSpeed: s.averageSpeed ? parseFloat((s.averageSpeed * 1.852).toFixed(2)) : undefined,
    distance: s.distance ? parseFloat((s.distance / 1000).toFixed(2)) : 0,
    spentFuel: s.spentFuel || undefined,
    engineHours: s.engineHours || undefined,
  }));
}

async function getReportEvents(params = {}) {
  const res = await traccarApi.get('/reports/events', { params });
  return res.data || [];
}

async function getGeofences(params = {}) {
  const res = await traccarApi.get('/geofences', { params });
  return res.data || [];
}

module.exports = {
  getDevices,
  getGroups,
  getPositions,
  getCommands,
  getCommandTypes,
  sendCommand,
  getHealth,
  getReportStops,
  getReportTrips,
  getReportSummary,
  getReportEvents,
  getGeofences,
};
