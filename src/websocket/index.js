const jwt = require('jsonwebtoken');
const WebSocket = require('ws');
const config = require('../config');
const traccar = require('../services/traccar');
const mspf = require('../services/mspf');
const { deriveRunningStatus } = require('../utils/deviceStatus');
const { applyRules, computeFormula, getDeviceRules } = require('../services/customAttributes');
const { logger } = require('../middleware/logger');
const db = require('../db');

let io = null;
let mspfPollTimer = null;
let lastKnownMspfIds = null;

let traccarWs = null;
let traccarWsReconnectTimer = null;
let traccarFallbackTimer = null;
let traccarWsRetries = 0;
const TRACCAR_WS_MAX_RETRIES = 3;

function setupWebSocket(httpServer) {
  const { Server } = require('socket.io');
  io = new Server(httpServer, {
    path: config.websocket.path,
    cors: { origin: config.cors.origin, credentials: true },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      socket.user = jwt.verify(token, config.jwt.secret);
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  setupRedisAdapter(io);

  io.on('connection', async (socket) => {
    const user = socket.user;
    if (user.role !== 'admin') {
      socket.allowedDevices = new Set();
      if (user.groups?.length > 0) {
        try {
          const mappings = await db('device_groups').whereIn('group_id', user.groups).select('device_id', 'source');
          for (const m of mappings) socket.allowedDevices.add(`${m.source}:${m.device_id}`);
          console.log(`[WS] ${user.username} (${user.role}) connect, groups:${JSON.stringify(user.groups)}, allowedDevices:${socket.allowedDevices.size}`);
        } catch (err) {
          logger.warn(`WS: failed to load allowed devices for ${user.username}: ${err.message}`);
        }
      } else {
        console.log(`[WS] ${user.username} (${user.role}) connect, groups:[] → allowedDevices:0`);
      }
    }
  });

  startMspfPolling();
  connectTraccarWs();

  logger.info(`Socket.io ready at path: ${config.websocket.path}`);
  return io;
}

function setupRedisAdapter(io) {
  const redisUrl = config.websocket.redisUrl;
  if (!redisUrl) {
    logger.info('Redis adapter not configured — running in single-instance mode');
    return;
  }
  try {
    const Redis = require('ioredis');
    const { createAdapter } = require('@socket.io/redis-adapter');
    const pub = new Redis(redisUrl);
    const sub = new Redis(redisUrl);
    pub.on('error', (err) => logger.error('Redis pub error:', err.message));
    sub.on('error', (err) => logger.error('Redis sub error:', err.message));
    io.adapter(createAdapter(pub, sub));
    logger.info('Redis adapter attached to Socket.io');
  } catch (err) {
    logger.warn('Failed to attach Redis adapter — falling back to single-instance:', err.message);
  }
}

function getDeviceName(deviceId, source) {
  try {
    const cache = require('../services/cache');
    const merged = cache.get('devices:merged');
    if (merged) {
      const d = merged.find(x => x.id === deviceId && x.source === source);
      if (d) return d.name || '';
    }
  } catch {}
  return '';
}

function getField(obj, path) {
  if (!path) return undefined;
  let val = obj[path];
  if (val === undefined) val = obj.attributes?.[path];
  if (val === undefined && !path.startsWith('attributes.')) {
    val = obj['attributes.' + path];
  }
  return val;
}

async function emitPosition(data) {
  const name = getDeviceName(data.deviceId, data.source);
  const sockets = io ? [...io.sockets.sockets.values()] : [];
  const users = sockets.map(s => s.user?.username || '?').join(',');
  // console.log(`[WS] position → {id:${data.deviceId}, name:"${name}", ...}`);
  const rules = await getDeviceRules(data.deviceId, data.source);
  for (const socket of sockets) {
    const user = socket.user;
    if (!user) continue;
    if (user.role !== 'admin' && !socket.allowedDevices.has(`${data.source}:${data.deviceId}`)) {
      // console.log(`[WS] ${user.username}: ${data.source}:${data.deviceId} BLOCKED (${socket.allowedDevices?.size || 0} allowed)`);
      continue;
    }
    if (user.role !== 'admin') {
      console.log(`[WS] ${user.username}: ${data.source}:${data.deviceId} ALLOWED`);
    }
    let payload = { ...data, attributes: { ...data.attributes } };
    const attr = payload.attributes;
    payload.voltage = attr.voltage ?? attr.power ?? attr.volt ?? undefined;
    payload.internalBattery = attr.addr_IB ?? undefined;
    payload.batteryLevel = attr.batteryLevel ?? undefined;
    payload.ignition = attr.ignition ?? undefined;
    if (user.role !== 'admin') {
      if (rules.length > 0) {
        applyRules(payload, rules);
      } else {
        payload.attributes = {};
      }
    } else if (rules.length > 0) {
      for (const rule of rules) {
        if (rule.mode === 'passthrough' || rule.mode === 'rename') {
          const val = getField(payload, rule.source_field);
          if (val !== undefined) payload.attributes[rule.name] = val;
        } else if (rule.mode === 'compute' && rule.formula) {
          const raw = rule.source_field ? getField(payload, rule.source_field) : undefined;
          const result = computeFormula(rule.formula, raw, payload.attributes);
          if (result !== null) payload.attributes[rule.name] = result;
        }
      }
    }
    socket.emit('position', payload);
    // console.log(`  → ${user.username}: attrs=...`);
  }
}
function emitDeviceStatus(deviceId, source, data) {
  if (!io) return;
  const sockets = [...io.sockets.sockets.values()];
  for (const socket of sockets) {
    const user = socket.user;
    if (!user) continue;
    if (user.role !== 'admin' && !socket.allowedDevices.has(`${source}:${deviceId}`)) continue;
    socket.emit('device-status', data);
  }
}
function emitCommandResult(data) { if (io) io.emit('command-result', data); }
function getIO() { return io; }

function emitDeviceStatusFrom(item) {
  const lastUpdate = item.deviceTime;
  const speed = item.speed || 0;
  const ignition = item.attributes?.ignition;
  const running = deriveRunningStatus(item.attributes, speed, lastUpdate);

  emitDeviceStatus(item.deviceId, item.source, {
    deviceId: item.deviceId,
    source: item.source,
    lastUpdate: lastUpdate || new Date().toISOString(),
    running,
    ignition: ignition !== undefined ? ignition : undefined,
    voltage: item.attributes?.voltage || item.attributes?.power || undefined,
    internalBattery: item.attributes?.addr_IB || undefined,
    batteryLevel: item.attributes?.batteryLevel || undefined,
  });
}

// ── MSPF Polling ─────────────────────────────────────────

function getActiveMspfDeviceIds() {
  try {
    const cache = require('../services/cache');
    const merged = cache.get('devices:merged');
    if (merged) {
      lastKnownMspfIds = new Set(merged.filter(d => d.source === 'mspf').map(d => d.id));
    }
  } catch {}
  return lastKnownMspfIds;
}

function getMspfBcIds() {
  try {
    const cache = require('../services/cache');
    const merged = cache.get('devices:merged');
    if (!merged) return [];
    return [...new Set(merged
      .filter(d => d.source === 'mspf' && d.group)
      .map(d => parseInt(d.group.replace('mspf_', ''), 10))
    )];
  } catch { return []; }
}

function startMspfPolling() {
  if (mspfPollTimer) clearInterval(mspfPollTimer);
  mspfPollTimer = setInterval(async () => {
    try {
      const data = await mspf.getPositions({ limit: 1000, bc: getMspfBcIds() });
      if (data && data.length > 0) {
        const activeIds = getActiveMspfDeviceIds();
        const filtered = activeIds ? data.filter(p => activeIds.has(p.deviceId)) : data;
        if (filtered.length > 0) {
          for (const item of filtered) {
            await emitPosition({
              deviceId: item.deviceId, latitude: item.latitude, longitude: item.longitude,
              speed: item.speed, course: item.course, altitude: item.altitude,
              deviceTime: item.deviceTime || new Date().toISOString(),
              valid: item.valid !== false, source: 'mspf',
              attributes: item.attributes,
            });
            emitDeviceStatusFrom(item);
          }
        }
        // const rawCount = data.length;
        // const allowed = activeIds ? activeIds.size : 0;
        // logger.info(`[WS] MSPF: emit ${filtered.length} device (${rawCount} raw, ${allowed} allowed)`);
      }
    } catch (err) {
      logger.warn(`WS MSPF poll: ${err.message}`);
    }
  }, config.websocket.pollInterval);
}

// ── Traccar WebSocket ─────────────────────────────────────

function connectTraccarWs() {
  if (traccarWs) { traccarWs.close(); traccarWs = null; }
  if (traccarWsRetries >= TRACCAR_WS_MAX_RETRIES) {
    logger.info('Traccar WS max retries reached, staying on REST polling');
    startTraccarFallback();
    return;
  }

  const baseUrl = config.traccar.url.replace(/\/api\/?$/, '').replace(/^http/, 'ws');
  const wsUrl = baseUrl + '/api/socket';
  const auth = Buffer.from(`${config.traccar.username}:${config.traccar.password}`).toString('base64');

  try {
    traccarWs = new WebSocket(wsUrl, { headers: { Authorization: `Basic ${auth}` }, handshakeTimeout: 10000 });

    traccarWs.on('open', () => {
      logger.info('Traccar WebSocket connected');
      traccarWsRetries = 0;
      if (traccarFallbackTimer) { clearInterval(traccarFallbackTimer); traccarFallbackTimer = null; }
      if (traccarWsReconnectTimer) { clearTimeout(traccarWsReconnectTimer); traccarWsReconnectTimer = null; }
    });

    traccarWs.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const positions = msg.positions || (Array.isArray(msg) ? msg : [msg]);
        for (const pos of positions) {
          if (!pos.deviceId) continue;
          const speed = pos.speed ? parseFloat((pos.speed * 1.852).toFixed(2)) : 0;
          await emitPosition({
            deviceId: pos.deviceId, latitude: pos.latitude, longitude: pos.longitude,
            speed, course: pos.course || 0, altitude: pos.altitude || 0,
            deviceTime: pos.deviceTime || pos.fixTime || new Date().toISOString(),
            valid: pos.valid !== false, source: 'traccar',
            attributes: pos.attributes || {},
          });
          emitDeviceStatusFrom({
            deviceId: pos.deviceId,
            deviceTime: pos.deviceTime || pos.fixTime,
            source: 'traccar',
            attributes: pos.attributes || {},
          });
        }
      } catch { /* non-JSON message */ }
    });

    traccarWs.on('close', () => {
      logger.warn('Traccar WebSocket disconnected');
      traccarWs = null;
      traccarWsRetries++;
      startTraccarFallback();
      if (traccarWsRetries < TRACCAR_WS_MAX_RETRIES) {
        traccarWsReconnectTimer = setTimeout(connectTraccarWs, 5000).unref();
      }
    });

    traccarWs.on('error', (err) => {
      logger.warn(`Traccar WebSocket error: ${err.message}`);
      if (traccarWs) { traccarWs.close(); traccarWs = null; }
      traccarWsRetries++;
      startTraccarFallback();
    });
  } catch (err) {
    logger.warn(`Traccar WebSocket connection failed: ${err.message}, falling back to polling`);
    startTraccarFallback();
  }
}

function startTraccarFallback() {
  if (traccarFallbackTimer) return;
  logger.info('Traccar fallback: REST polling every 10s');
  traccarFallbackTimer = setInterval(async () => {
    try {
      const data = await traccar.getPositions({ limit: 1000 });
      if (data && data.length > 0) {
        for (const item of data) {
          await emitPosition({
            deviceId: item.deviceId, latitude: item.latitude, longitude: item.longitude,
            speed: item.speed || 0, course: item.course || 0, altitude: item.altitude || 0,
            deviceTime: item.deviceTime || new Date().toISOString(),
            valid: item.valid !== false, source: 'traccar',
            attributes: item.attributes || {},
          });
          emitDeviceStatusFrom(item);
        }
      }
    } catch (err) {
      logger.warn(`WS Traccar fallback poll: ${err.message}`);
    }
  }, config.websocket.pollInterval);
}

module.exports = { setupWebSocket, emitPosition, emitDeviceStatus, emitCommandResult, getIO };
