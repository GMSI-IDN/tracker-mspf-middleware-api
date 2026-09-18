const request = require('supertest');
const db = require('../db');
const cache = require('../services/cache');

jest.mock('../services/traccar', () => ({
  getDevices: jest.fn(() => Promise.resolve([])),
  getReportEvents: jest.fn(() => Promise.resolve([])),
  getGeofences: jest.fn(() => Promise.resolve([
    { id: 101, name: 'Gudang Utama' },
    { id: 102, name: 'Area Terlarang' },
  ])),
}));

jest.mock('../services/mspf', () => ({
  init: jest.fn(),
  waitForInit: jest.fn(() => Promise.resolve()),
  getDevice: jest.fn(() => Promise.resolve(null)),
  getMspfEvents: jest.fn(() => Promise.resolve([])),
  getMspfClosedEvents: jest.fn(() => Promise.resolve([])),
  getMonitors: jest.fn(() => Promise.resolve([
    { id: 5001, name: 'MSPF Speed Limit 80' },
    { id: 5002, name: 'MSPF Battery Disconnected' },
  ])),
}));

jest.mock('../services/foxlogger', () => ({
  waitForInit: jest.fn(() => Promise.resolve()),
  getDevices: jest.fn(() => Promise.resolve({ data: [] })),
  getUserId: jest.fn(() => 'test_user'),
}));

const app = require('../app');
const traccar = require('../services/traccar');
const mspf = require('../services/mspf');

describe('Event Configs & Level Classification', () => {
  let adminToken;
  let customerToken;
  let customerUserId;

  beforeAll(async () => {
    // Admin login
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    adminToken = adminLogin.body.token;

    // Create a customer user
    await db('users').where({ username: 'cust_event_test' }).del();
    const custRes = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username: 'cust_event_test',
        email: 'cust_event_test@example.com',
        firstName: 'Cust',
        lastName: 'Tester',
        password: 'Password123!',
        confirmPassword: 'Password123!',
        role: 'customer',
        timezone: 'Asia/Jakarta',
      });
    customerUserId = custRes.body.id;

    const custLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'cust_event_test', password: 'Password123!' });
    customerToken = custLogin.body.token;
  });

  afterAll(async () => {
    await db('event_configs').whereIn('source', ['traccar', 'mspf', 'foxlogger']).del();
    if (customerUserId) await db('users').where({ id: customerUserId }).del();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
  });

  test('GET /api/admin/events/catalog without auth returns 401', async () => {
    const res = await request(app).get('/api/admin/events/catalog');
    expect(res.status).toBe(401);
  });

  test('GET /api/admin/events/catalog as non-admin returns 403', async () => {
    const res = await request(app)
      .get('/api/admin/events/catalog')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(403);
  });

  test('GET /api/admin/events/catalog discovers Traccar, Geofences, MSPF monitors, and FoxLogger alarms', async () => {
    const res = await request(app)
      .get('/api/admin/events/catalog')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.catalog)).toBe(true);

    const catalog = res.body.catalog;
    // Check Traccar ignitionOn
    const ignition = catalog.find(c => c.source === 'traccar' && c.eventKey === 'ignitionOn');
    expect(ignition).toBeDefined();
    expect(ignition.level).toBe('success');

    // Check Traccar Geofence
    const geo = catalog.find(c => c.source === 'traccar' && c.eventKey === 'geofence:101');
    expect(geo).toBeDefined();
    expect(geo.originalName).toBe('Gudang Utama');
    expect(geo.externalId).toBe(101);

    // Check MSPF Monitor
    const monitor = catalog.find(c => c.source === 'mspf' && c.eventKey === 'monitor:5001');
    expect(monitor).toBeDefined();
    expect(monitor.originalName).toBe('MSPF Speed Limit 80');
    expect(monitor.externalId).toBe(5001);

    // Check FoxLogger Alarm
    const foxAlarm = catalog.find(c => c.source === 'foxlogger' && c.eventKey === 'alarm:Power Cut Alarm');
    expect(foxAlarm).toBeDefined();
    expect(foxAlarm.level).toBe('danger');
  });

  test('PUT /api/admin/events/configs updates event level, color, and customLabel', async () => {
    const res = await request(app)
      .put('/api/admin/events/configs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        configs: [
          {
            source: 'traccar',
            eventKey: 'overspeed',
            eventType: 'overspeed',
            originalName: 'Overspeed',
            customLabel: 'Kecepatan Melebihi Batas',
            level: 'danger',
            color: '#DC2626',
          },
          {
            source: 'mspf',
            eventKey: 'monitor:5001',
            externalId: 5001,
            eventType: 'monitor',
            originalName: 'MSPF Speed Limit 80',
            customLabel: 'Radar Tol 80 KMH',
            level: 'warning',
            color: '#F59E0B',
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.updatedCount).toBe(2);

    // Verify GET /api/admin/events/configs returns saved configs
    const getRes = await request(app)
      .get('/api/admin/events/configs')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getRes.status).toBe(200);
    const savedOverspeed = getRes.body.configs.find(c => c.event_key === 'overspeed');
    expect(savedOverspeed).toBeDefined();
    expect(savedOverspeed.custom_label).toBe('Kecepatan Melebihi Batas');
    expect(savedOverspeed.level).toBe('danger');
    expect(savedOverspeed.color).toBe('#DC2626');
  });

  test('PUT /api/admin/events/configs validates invalid level', async () => {
    const res = await request(app)
      .put('/api/admin/events/configs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        configs: [
          {
            source: 'traccar',
            eventKey: 'overspeed',
            eventType: 'overspeed',
            level: 'invalid_level',
          },
        ],
      });

    expect(res.status).toBe(400);
  });

  test('GET /api/reports/events enriches events with configured level, color, and customLabel', async () => {
    traccar.getReportEvents.mockResolvedValue([
      { id: 1, type: 'overspeed', eventTime: '2026-06-15T10:00:00Z', deviceId: 10 },
      { id: 2, type: 'ignitionOn', eventTime: '2026-06-15T09:00:00Z', deviceId: 10 },
    ]);
    mspf.getMspfEvents.mockResolvedValue([
      { id: 99, monitorId: 5001, monitorName: 'MSPF Speed Limit 80', openedAt: '2026-06-15T08:00:00Z', status: 'OPEN', deviceId: 20 },
    ]);

    cache.set('devices:merged', [
      { id: 10, name: 'Truck Alpha', source: 'traccar' },
      { id: 20, name: 'Pickup Bravo', source: 'mspf' },
    ], 120);

    const res = await request(app)
      .get('/api/reports/events?from=2026-06-01T00:00:00Z')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.events.length).toBe(3);

    // Overspeed event (configured)
    const overspeedEv = res.body.events.find(e => e.type === 'overspeed');
    expect(overspeedEv).toBeDefined();
    expect(overspeedEv.name).toBe('Kecepatan Melebihi Batas');
    expect(overspeedEv.level).toBe('danger');
    expect(overspeedEv.color).toBe('#DC2626');

    // IgnitionOn event (default unconfigured)
    const ignitionEv = res.body.events.find(e => e.type === 'ignitionOn');
    expect(ignitionEv).toBeDefined();
    expect(ignitionEv.name).toBe('Ignition ON');
    expect(ignitionEv.level).toBe('success');
    expect(ignitionEv.color).toBe('#10B981');

    // MSPF monitor event (configured by monitorId)
    const mspfEv = res.body.events.find(e => e.deviceId === 20);
    expect(mspfEv).toBeDefined();
    expect(mspfEv.name).toBe('Radar Tol 80 KMH');
    expect(mspfEv.level).toBe('warning');
    expect(mspfEv.color).toBe('#F59E0B');
  });

  test('GET /api/reports/events filters by ?level=', async () => {
    traccar.getReportEvents.mockResolvedValue([
      { id: 1, type: 'overspeed', eventTime: '2026-06-15T10:00:00Z', deviceId: 10 },
      { id: 2, type: 'ignitionOn', eventTime: '2026-06-15T09:00:00Z', deviceId: 10 },
    ]);
    mspf.getMspfEvents.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/reports/events?from=2026-06-01T00:00:00Z&level=danger')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.events.length).toBe(1);
    expect(res.body.events[0].type).toBe('overspeed');
    expect(res.body.events[0].level).toBe('danger');
  });

  test('Muted event (is_enabled: false) is suppressed from event reports', async () => {
    // Mute ignitionOff
    await request(app)
      .put('/api/admin/events/configs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        configs: [
          {
            source: 'traccar',
            eventKey: 'ignitionOff',
            eventType: 'ignitionOff',
            originalName: 'Ignition OFF',
            isEnabled: false,
          },
        ],
      });

    traccar.getReportEvents.mockResolvedValue([
      { id: 1, type: 'ignitionOn', eventTime: '2026-06-15T10:00:00Z', deviceId: 10 },
      { id: 2, type: 'ignitionOff', eventTime: '2026-06-15T09:30:00Z', deviceId: 10 },
    ]);
    mspf.getMspfEvents.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/reports/events?from=2026-06-01T00:00:00Z')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.events.some(e => e.type === 'ignitionOff')).toBe(false);
    expect(res.body.events.some(e => e.type === 'ignitionOn')).toBe(true);
  });

  test('DELETE /api/admin/events/configs/:id resets config back to default', async () => {
    const listRes = await request(app)
      .get('/api/admin/events/configs')
      .set('Authorization', `Bearer ${adminToken}`);

    const item = listRes.body.configs[0];
    expect(item).toBeDefined();

    const delRes = await request(app)
      .delete(`/api/admin/events/configs/${item.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);
  });
});
