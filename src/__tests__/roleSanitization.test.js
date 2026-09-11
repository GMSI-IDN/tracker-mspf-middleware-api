const request = require('supertest');

jest.mock('../services/traccar', () => ({
  getDevices: jest.fn(() => Promise.resolve([{
    id: 8881,
    name: 'Sanitize Vehicle 1',
    uniqueId: 'trac_8881',
    status: 'online',
    groupId: 10,
    attributes: {},
  }])),
  getPositions: jest.fn(() => Promise.resolve([{
    deviceId: 8881,
    latitude: -6.2,
    longitude: 106.8,
    speed: 25,
    deviceTime: '2026-09-10T10:00:00Z',
    attributes: {},
  }])),
  getCommandTypes: jest.fn(() => Promise.resolve(['engineStop', 'engineResume'])),
  sendCommand: jest.fn(() => Promise.resolve({ id: 991 })),
  getReportStops: jest.fn(() => Promise.resolve([
    { deviceId: 8881, startTime: '2026-09-10T08:00:00Z', endTime: '2026-09-10T08:30:00Z', duration: 1800, lat: -6.2, lon: 106.8, address: 'Test St', engineHours: 0 },
  ])),
  getReportSummary: jest.fn(() => Promise.resolve([
    { deviceId: 8881, deviceName: 'Sanitize Vehicle 1', distance: 15.5, duration: 3600 },
  ])),
  toKmh: jest.fn(s => s || 0),
  getHealth: jest.fn(),
}));

jest.mock('../services/mspf', () => ({
  init: jest.fn(),
  waitForInit: jest.fn(() => Promise.resolve()),
  getApi: jest.fn(() => ({ get: jest.fn(), put: jest.fn() })),
  getDevices: jest.fn(() => Promise.resolve({ data: [], total: 0 })),
}));

jest.mock('../services/foxlogger', () => ({
  init: jest.fn(),
  waitForInit: jest.fn(() => Promise.resolve()),
  getApi: jest.fn(),
  getDevices: jest.fn(() => Promise.resolve({ data: [] })),
}));

jest.mock('../services/autoSync', () => ({
  runAutoSync: jest.fn(),
}));

jest.mock('../services/customAttributes', () => ({
  applyRules: jest.fn(d => d),
  computeFormula: jest.fn(),
  getDeviceRules: jest.fn(() => Promise.resolve([])),
  buildDeviceRulesCache: jest.fn(() => Promise.resolve()),
}));

const db = require('../db');
const deviceRouter = require('../services/deviceRouter');
const cache = require('../services/cache');
const app = require('../app');

describe('Role-Based Upstream Vendor Sanitization (Admin vs Customer)', () => {
  let adminToken;
  let customerToken;
  const testGroupId = 8880;

  beforeAll(async () => {
    await db.waitForMigration();

    // 1. Admin login
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    adminToken = adminLogin.body.token;

    // Clean up
    await db('command_logs').where({ device_id: 8881 }).delete();
    await db('device_groups').where({ group_id: testGroupId }).delete();
    await db('groups').where({ id: testGroupId }).delete();
    await db('users').where({ username: 'cust_sanitizer' }).delete();

    // Create custom group
    await db('groups').insert({
      id: testGroupId,
      name: 'Sanitization Test Fleet',
      description: 'Fleet for verifying vendor tag stripping',
    });

    // Assign device 8881 (traccar) to custom group
    await db('device_groups').insert({
      device_id: 8881,
      source: 'traccar',
      group_id: testGroupId,
    });

    deviceRouter.setSourceByDeviceId(8881, 'traccar');

    // Create customer user
    await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username: 'cust_sanitizer',
        email: 'cust_sanitizer@test.local',
        firstName: 'Cust',
        lastName: 'Sanitizer',
        password: 'password123',
        confirmPassword: 'password123',
        role: 'customer',
        groups: [testGroupId],
        timezone: 'Asia/Jakarta',
        permissions: { canCutEngine: true },
      });

    const custLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'cust_sanitizer', password: 'password123' });
    customerToken = custLogin.body.token;

    // Add a command log to verify logs endpoint
    await db('command_logs').insert({
      user_id: 1,
      username: 'admin',
      role: 'admin',
      device_id: 8881,
      source: 'traccar',
      command_type: 'engineResume',
      status: 'SUCCESS',
      created_at: new Date().toISOString(),
    });
  });

  beforeEach(() => {
    cache.del('debounce:cmd:traccar:8881');
    cache.set('devices:merged', [{
      id: 8881,
      name: 'Sanitize Vehicle 1',
      uniqueId: 'trac_8881',
      status: 'online',
      source: 'traccar',
      group: 'traccar_10',
      attributes: {},
    }], 300);
    cache.set('positions:merged', [{
      deviceId: 8881,
      source: 'traccar',
      latitude: -6.2,
      longitude: 106.8,
      speed: 25,
      deviceTime: '2026-09-10T10:00:00Z',
      attributes: {},
    }], 300);
  });

  afterAll(async () => {
    await db('command_logs').where({ device_id: 8881 }).delete();
    await db('device_groups').where({ group_id: testGroupId }).delete();
    await db('groups').where({ id: testGroupId }).delete();
    await db('users').where({ username: 'cust_sanitizer' }).delete();
  });

  describe('GET /api/devices & GET /api/devices/:id', () => {
    test('Admin receives source and vendor group', async () => {
      const listRes = await request(app)
        .get('/api/devices')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(listRes.status).toBe(200);
      const dev = listRes.body.devices.find(d => d.id === 8881);
      expect(dev).toBeDefined();
      expect(dev.source).toBe('traccar');
      expect(dev.group).toBe('traccar_10');

      const singleRes = await request(app)
        .get('/api/devices/8881')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(singleRes.status).toBe(200);
      expect(singleRes.body.source).toBe('traccar');
      expect(singleRes.body.group).toBe('traccar_10');
    });

    test('Customer has source and vendor group stripped', async () => {
      const listRes = await request(app)
        .get('/api/devices')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(listRes.status).toBe(200);
      const dev = listRes.body.devices.find(d => d.id === 8881);
      expect(dev).toBeDefined();
      expect(dev.source).toBeUndefined();
      expect(dev.group).toBeUndefined();
      expect(dev.customGroups).toBeDefined();

      const singleRes = await request(app)
        .get('/api/devices/8881')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(singleRes.status).toBe(200);
      expect(singleRes.body.source).toBeUndefined();
      expect(singleRes.body.group).toBeUndefined();
    });
  });

  describe('GET /api/positions', () => {
    test('Admin positions have source field', async () => {
      const res = await request(app)
        .get('/api/positions')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const pos = res.body.find(p => p.deviceId === 8881);
      expect(pos).toBeDefined();
      expect(pos.source).toBe('traccar');
    });

    test('Customer positions have source stripped', async () => {
      const res = await request(app)
        .get('/api/positions')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(200);
      const pos = res.body.find(p => p.deviceId === 8881);
      expect(pos).toBeDefined();
      expect(pos.source).toBeUndefined();
    });
  });

  describe('Commands & Command Logs', () => {
    test('Admin receives source in command responses', async () => {
      const typeRes = await request(app)
        .get('/api/commands/types/8881')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(typeRes.status).toBe(200);
      expect(typeRes.body.source).toBe('traccar');

      const postRes = await request(app)
        .post('/api/commands')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ deviceId: 8881, type: 'engineResume' });
      expect(postRes.status).toBe(200);
      expect(postRes.body.source).toBe('traccar');

      cache.del('debounce:cmd:traccar:8881');

      const logsRes = await request(app)
        .get('/api/commands/logs?deviceId=8881')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(logsRes.status).toBe(200);
      expect(logsRes.body.logs.length).toBeGreaterThanOrEqual(1);
      expect(logsRes.body.logs[0].source).toBe('traccar');
    });

    test('Customer has source stripped from command responses and logs', async () => {
      const typeRes = await request(app)
        .get('/api/commands/types/8881')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(typeRes.status).toBe(200);
      expect(typeRes.body.source).toBeUndefined();

      cache.del('debounce:cmd:traccar:8881');

      const postRes = await request(app)
        .post('/api/commands')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ deviceId: 8881, type: 'engineResume' });
      expect(postRes.status).toBe(200);
      expect(postRes.body.source).toBeUndefined();

      const logsRes = await request(app)
        .get('/api/commands/logs?deviceId=8881')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(logsRes.status).toBe(200);
      expect(logsRes.body.logs.length).toBeGreaterThanOrEqual(1);
      for (const l of logsRes.body.logs) {
        expect(l.source).toBeUndefined();
      }
    });
  });

  describe('Reports: Parking & Summary', () => {
    test('Admin receives source in parking report', async () => {
      const res = await request(app)
        .get('/api/reports/parking?deviceId=8881&from=2026-09-01T00:00:00Z')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.source).toBe('traccar');
    });

    test('Customer has source stripped from parking report', async () => {
      const res = await request(app)
        .get('/api/reports/parking?deviceId=8881&from=2026-09-01T00:00:00Z')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.source).toBeUndefined();
    });

    test('Admin receives source in summary report', async () => {
      const res = await request(app)
        .get('/api/reports/summary?deviceId=8881&from=2026-09-01T00:00:00Z')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.source).toBe('traccar');
      expect(res.body.summaries[0].source).toBe('traccar');
    });

    test('Customer has source stripped from summary report', async () => {
      const res = await request(app)
        .get('/api/reports/summary?deviceId=8881&from=2026-09-01T00:00:00Z')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.source).toBeUndefined();
      expect(res.body.summaries[0].source).toBeUndefined();
    });
  });
});
