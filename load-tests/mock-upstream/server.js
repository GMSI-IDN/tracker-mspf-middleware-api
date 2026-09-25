/**
 * Mock Upstream Server for Middleware Load Testing
 * Simulates Traccar, MSPF, and FoxLogger servers.
 *
 * Configurable via environment variables:
 * - MOCK_PORT: Port to listen on (default: 4000)
 * - MOCK_DELAY_MS: Simulated response delay in ms (default: 0)
 * - MOCK_JITTER_MS: Simulated random jitter in ms (default: 0)
 * - MOCK_ERROR_RATE: Probability of returning HTTP 500 [0.0 - 1.0] (default: 0)
 * - MOCK_MSPF_COUNT: Number of MSPF devices (default: 1109)
 * - MOCK_TRACCAR_COUNT: Number of Traccar devices (default: 90)
 * - MOCK_FOXLOGGER_COUNT: Number of FoxLogger devices (default: 1)
 */

const express = require('express');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = parseInt(process.env.MOCK_PORT, 10) || 4000;
const DELAY_MS = parseInt(process.env.MOCK_DELAY_MS, 10) || 0;
const JITTER_MS = parseInt(process.env.MOCK_JITTER_MS, 10) || 0;
const ERROR_RATE = parseFloat(process.env.MOCK_ERROR_RATE) || 0;

const MSPF_COUNT = parseInt(process.env.MOCK_MSPF_COUNT, 10) || 1109;
const TRACCAR_COUNT = parseInt(process.env.MOCK_TRACCAR_COUNT, 10) || 90;
const FOXLOGGER_COUNT = parseInt(process.env.MOCK_FOXLOGGER_COUNT, 10) || 1;
const MOVING_RATIO = parseFloat(process.env.MOCK_MOVING_RATIO) !== undefined ? parseFloat(process.env.MOCK_MOVING_RATIO) : 0.3;
const MOCK_MCCS_DELAY_MS = parseInt(process.env.MOCK_MCCS_DELAY_MS, 10) || 0;

// ── Synthetic Data Generation ─────────────────────────────────

const mspfDevices = [];
for (let i = 1; i <= MSPF_COUNT; i++) {
  const id = 1000 + i;
  mspfDevices.push({
    id,
    name: `MSPF Unit ${id}`,
    uniqueId: `86000000000${id}`,
    status: 'WORKING',
    mobileNo: `08120000${id}`,
    deviceType: 'MCCS',
    bcId: (i % 5) + 1,
    lastCommunicatedAt: new Date(Date.now() - (i % 600) * 1000).toISOString(),
    tags: {
      VIN: `VINMSPF${id}`,
      volt: 12.4 + (i % 10) * 0.1,
      addr_IB: 3.8,
    },
    deviceTypeId: 1,
    activationStatus: 'ACTIVE',
  });
}

const traccarDevices = [];
for (let i = 1; i <= TRACCAR_COUNT; i++) {
  traccarDevices.push({
    id: i,
    name: `B ${1000 + i} TRC`,
    uniqueId: `TRC00000000${i}`,
    status: 'online',
    groupId: (i % 3) + 1,
    lastUpdate: new Date(Date.now() - (i % 300) * 1000).toISOString(),
    attributes: {
      power: 12.6,
      motionTime: Date.now() - 60000,
    },
  });
}

const foxloggerUid = 17459262531439;
const foxloggerDevices = [];
for (let i = 1; i <= FOXLOGGER_COUNT; i++) {
  foxloggerDevices.push({
    imei: '0780901703170270',
    unit: '780901703170270',
    no: i,
    sim: '780901703170270',
    lo_lat: '-6.319752',
    lo_long: '106.948769',
    last_upd: '2026-08-01 10:00:00',
    status: 'OFF',
    mileage: 259.66,
    drv: '',
    drvphn: '',
    address: 'Jalan Raya Mock Upstream, Jakarta',
    user_id: foxloggerUid,
    reg_date: '2026-07-07',
    vin: '',
    nokir: '',
    machine_number: '',
  });
}

// ── Middleware: Artificial Delay, Jitter & Error Injection ───

app.use((req, res, next) => {
  if (ERROR_RATE > 0 && Math.random() < ERROR_RATE) {
    return res.status(500).json({ error: 'Mock upstream simulated 500 error' });
  }

  const delay = DELAY_MS + (JITTER_MS > 0 ? Math.floor(Math.random() * JITTER_MS) : 0);
  if (delay > 0) {
    setTimeout(next, delay);
  } else {
    next();
  }
});

// ── Health / Info ─────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    mock: true,
    devices: {
      mspf: mspfDevices.length,
      traccar: traccarDevices.length,
      foxlogger: foxloggerDevices.length,
      total: mspfDevices.length + traccarDevices.length + foxloggerDevices.length,
    },
  });
});

// ── 1. MSPF Mock Endpoints ────────────────────────────────────

// OAuth2 Token
app.post(['/v1/oauth2/token', '/mspf/v1/oauth2/token'], (req, res) => {
  res.json({
    access_token: 'mock-mspf-token-secret-12345',
    token_type: 'Bearer',
    expires_in: 3600,
  });
});

// Business Centers
app.get(['/v2/bc', '/mspf/api/v2/bc'], (req, res) => {
  res.json({
    data: [
      { id: 1, name: 'BC Jakarta' },
      { id: 2, name: 'BC Surabaya' },
      { id: 3, name: 'BC Bandung' },
      { id: 4, name: 'BC Medan' },
      { id: 5, name: 'BC Bali' },
    ],
  });
});

// Devices List with Pagination (Looping MSPF v3)
app.get(['/v3/devices', '/mspf/api/v3/devices'], (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 200;
  const startIndex = req.query.start ? parseInt(req.query.start, 10) : 0;
  const endIndex = Math.min(startIndex + limit, mspfDevices.length);
  const data = mspfDevices.slice(startIndex, endIndex);
  const next = endIndex < mspfDevices.length ? String(endIndex) : null;

  res.json({
    data,
    total: mspfDevices.length,
    next,
  });
});

// Device Positions (must be before /:id)
app.get(['/v3/devices/positions', '/mspf/api/v3/devices/positions'], (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 1000;
  const startIndex = req.query.start ? parseInt(req.query.start, 10) : 0;
  const slice = mspfDevices.slice(startIndex, startIndex + limit);

  const nowSec = Math.floor(Date.now() / 1000);
  const data = slice.map((d, idx) => {
    const globalIdx = startIndex + idx;
    const isMoving = ((globalIdx * 7 + 3) % 100) < (MOVING_RATIO * 100);
    const ts = isMoving ? nowSec - (idx % 10) : 1790000000;
    const lat = isMoving ? -6.2 + (idx % 100) * 0.001 + (nowSec % 10) * 0.0001 : -6.2 + (idx % 100) * 0.001;
    const speed = isMoving ? 20 + (idx % 40) : 0;

    return {
      deviceId: d.id,
      position: {
        id: 20000 + d.id,
        deviceId: d.id,
        lat,
        lon: 106.8 + (idx % 100) * 0.001,
        speed,
        timestamp: ts,
      },
    };
  });

  const next = startIndex + limit < mspfDevices.length ? String(startIndex + limit) : null;
  res.json({ data, next });
});

// Device Status List (must be before /:id)
app.get(['/v3/devices/status', '/mspf/api/v3/devices/status'], (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 200;
  const startIndex = req.query.start ? parseInt(req.query.start, 10) : 0;
  const slice = mspfDevices.slice(startIndex, startIndex + limit);

  const data = slice.map((d, idx) => ({
    deviceId: d.id,
    speed: 25,
    ignition: idx % 2 === 0 ? 'ON' : 'OFF',
    running: { status: idx % 2 === 0 ? 'RUN' : 'STOP' },
    voltage: 12.5,
    firmVersion: 'v2.1.0',
    lastCommunicatedAt: d.lastCommunicatedAt,
    sats: 12,
    rssi: 28,
  }));

  const next = startIndex + limit < mspfDevices.length ? String(startIndex + limit) : null;
  res.json({ data, next });
});

// Single Device
app.get(['/v3/devices/:id', '/mspf/api/v3/devices/:id'], (req, res) => {
  const id = parseInt(req.params.id, 10);
  const dev = mspfDevices.find((d) => d.id === id);
  if (!dev) return res.status(404).json({ error: 'Device not found' });
  res.json(dev);
});

// Single Device Status
app.get(['/v3/devices/:id/status', '/mspf/api/v3/devices/:id/status'], (req, res) => {
  const id = parseInt(req.params.id, 10);
  res.json({
    deviceId: id,
    speed: 30,
    ignition: 'ON',
    running: { status: 'RUN' },
    voltage: 12.6,
    lastCommunicatedAt: new Date().toISOString(),
  });
});

// MCCS Data History
app.get(['/v2/device/:id/data/history', '/mspf/api/v2/device/:id/data/history'], (req, res) => {
  const id = parseInt(req.params.id, 10);
  const data = [
    {
      tid: 1,
      mid: id,
      ts: Date.now(),
      kph: 25,
      dir: 90,
      odom: 15420,
      volt: 12.5,
      insDtm: new Date().toISOString(),
      addr: { IGN: 1, IB: 3.8, AD: 10, AD2: 20 },
    },
  ];
  if (MOCK_MCCS_DELAY_MS > 0) {
    setTimeout(() => res.json({ data }), MOCK_MCCS_DELAY_MS);
  } else {
    res.json({ data });
  }
});

// ── 2. Traccar Mock Endpoints ─────────────────────────────────

// Traccar Devices
app.get(['/devices', '/traccar/api/devices'], (req, res) => {
  res.json(traccarDevices);
});

// Traccar Positions
app.get(['/positions', '/traccar/api/positions'], (req, res) => {
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const positions = traccarDevices.map((d, idx) => {
    const isMoving = ((idx * 7 + 3) % 100) < (MOVING_RATIO * 100);
    const devTime = isMoving ? new Date(nowMs - (idx % 10) * 1000).toISOString() : '2026-08-01T10:00:00.000Z';
    const speed = isMoving ? 13.5 : 0;
    const lat = isMoving ? -6.175 + idx * 0.001 + (Math.floor(nowMs / 1000) % 10) * 0.0001 : -6.175 + idx * 0.001;

    return {
      id: 1000 + d.id,
      deviceId: d.id,
      protocol: 'osmand',
      deviceTime: devTime,
      fixTime: devTime,
      serverTime: now,
      outdated: false,
      valid: true,
      latitude: lat,
      longitude: 106.827 + idx * 0.001,
      altitude: 15,
      speed,
      course: 180,
      address: 'Jakarta, Indonesia',
      accuracy: 5,
      network: null,
      geofenceIds: [],
      attributes: {
        power: 12.6,
        batteryLevel: 95,
        ignition: isMoving,
        motionTime: isMoving ? nowMs - 5000 : 1790000000000,
      },
    };
  });
  res.json(positions);
});

// Traccar Groups
app.get(['/groups', '/traccar/api/groups'], (req, res) => {
  res.json([
    { id: 1, name: 'Traccar Fleet Alpha' },
    { id: 2, name: 'Traccar Fleet Beta' },
    { id: 3, name: 'Traccar Fleet Gamma' },
  ]);
});

// Traccar Route Report
app.get(['/reports/route', '/traccar/api/reports/route'], (req, res) => {
  res.json([]);
});

// ── 3. FoxLogger Mock Endpoints ───────────────────────────────

// FoxLogger Auth
app.get(['/users/authentication', '/foxlogger/users/authentication'], (req, res) => {
  // Generate dummy JWT with id payload for FoxLogger
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ id: foxloggerUid, user_id: foxloggerUid, exp: Math.floor(Date.now() / 1000) + 7200 })
  ).toString('base64url');
  const token = `${header}.${payload}.mocksignature`;

  res.json({
    data: {
      access_token: token,
      refresh_token: 'mock-foxlogger-refresh-token',
    },
  });
});

app.post(['/users/refresh-token', '/foxlogger/users/refresh-token'], (req, res) => {
  res.json({
    data: {
      access_token: 'mock-refreshed-token',
      refresh_token: 'mock-foxlogger-refresh-token',
    },
  });
});

// FoxLogger Report Position (Devices / Current Positions)
app.get(
  [
    '/web-tracker-staging/report-position/:uid',
    '/foxlogger/web-tracker-staging/report-position/:uid',
  ],
  (req, res) => {
    res.json(foxloggerDevices);
  }
);

// ── 4. Fallback Catch-All ─────────────────────────────────────

app.use((req, res) => {
  res.status(200).json({ ok: true, note: 'Mock upstream catch-all handler', path: req.path });
});

// ── Server Listen ─────────────────────────────────────────────

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Mock Upstream] Server running on http://0.0.0.0:${PORT}`);
    console.log(`[Mock Upstream] MSPF Devices: ${MSPF_COUNT} units`);
    console.log(`[Mock Upstream] Traccar Devices: ${TRACCAR_COUNT} units`);
    console.log(`[Mock Upstream] FoxLogger Devices: ${FOXLOGGER_COUNT} units`);
    console.log(`[Mock Upstream] Total Synthetic Fleet: ${MSPF_COUNT + TRACCAR_COUNT + FOXLOGGER_COUNT} units`);
    console.log(`[Mock Upstream] Simulated Delay: ${DELAY_MS}ms ± ${JITTER_MS}ms, Error Rate: ${ERROR_RATE * 100}%`);
  });
}

module.exports = app;
