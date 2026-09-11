const request = require('supertest');
const { deriveEngineControl, setEngineDesired, getEngineDesired } = require('../utils/engineControl');
const cache = require('../services/cache');

jest.mock('../services/traccar', () => ({
  getDevices: jest.fn(() => Promise.resolve([{
    id: 7771,
    name: 'Engine Test 1',
    uniqueId: 'trac_7771',
    status: 'online',
    groupId: 1,
    attributes: { blocked: true },
  }])),
  getPositions: jest.fn(() => Promise.resolve([])),
  getCommandTypes: jest.fn(() => Promise.resolve(['engineStop', 'engineResume'])),
  sendCommand: jest.fn(() => Promise.resolve({ id: 101 })),
  toKmh: jest.fn(s => s || 0),
  getHealth: jest.fn(),
}));

jest.mock('../services/mspf', () => ({
  init: jest.fn(),
  waitForInit: jest.fn(() => Promise.resolve()),
  getApi: jest.fn(() => ({ get: jest.fn(), put: jest.fn() })),
  getDevices: jest.fn(() => Promise.resolve({ data: [], total: 0 })),
  getDevice: jest.fn((id) => Promise.resolve({
    id,
    name: 'MSPF Engine Unit',
    tags: { volt: 12.4 },
    activationCurrentStatus: 'INACTIVE',
    bcId: 1,
  })),
  enrichDevice: jest.fn((d) => Promise.resolve({
    ...d,
    source: 'mspf',
    attributes: { activationStatus: d.activationCurrentStatus || 'ACTIVE' },
  })),
  activateDevice: jest.fn(() => Promise.resolve({ success: true })),
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
const app = require('../app');

describe('engineControl — Unified Telematics Immobilizer State', () => {
  beforeEach(() => {
    cache.del('engine:desired:traccar:7771');
    cache.del('engine:desired:mspf:7772');
    cache.del('engine:desired:foxlogger:7773');
    cache.del('debounce:cmd:traccar:7771');
    cache.del('debounce:cmd:mspf:7772');
  });

  describe('deriveEngineControl unit logic', () => {
    test('returns null for FoxLogger devices', () => {
      const ec = deriveEngineControl({ id: 7773, source: 'foxlogger' });
      expect(ec).toBeNull();
    });

    test('MSPF: returns INACTIVE and isApplied: true when activationStatus is INACTIVE', () => {
      const dev = {
        id: 7772,
        source: 'mspf',
        attributes: { activationStatus: 'INACTIVE' },
        lastUpdate: '2026-09-10T12:00:00Z',
      };
      const ec = deriveEngineControl(dev);
      expect(ec).toEqual({
        desired: 'INACTIVE',
        state: 'INACTIVE',
        isApplied: true,
        lastAppliedAt: '2026-09-10T12:00:00Z',
      });
    });

    test('MSPF: returns DEACTIVATING and isApplied: false when activationStatus is DEACTIVATING', () => {
      const dev = {
        id: 7772,
        source: 'mspf',
        attributes: { activationStatus: 'DEACTIVATING' },
      };
      const ec = deriveEngineControl(dev);
      expect(ec.state).toBe('DEACTIVATING');
      expect(ec.isApplied).toBe(false);
      expect(ec.desired).toBe('INACTIVE');
    });

    test('MSPF: returns DEACTIVATING when intent is INACTIVE but hardware is still reporting ACTIVE', () => {
      setEngineDesired(7772, 'mspf', 'INACTIVE');
      const dev = {
        id: 7772,
        source: 'mspf',
        attributes: { activationStatus: 'ACTIVE' },
      };
      const ec = deriveEngineControl(dev);
      expect(ec.state).toBe('DEACTIVATING');
      expect(ec.isApplied).toBe(false);
      expect(ec.desired).toBe('INACTIVE');
    });

    test('MSPF: strictly relies on activationStatus and ignores generic relay attribute (avoids false-positives)', () => {
      const dev = {
        id: 7772,
        source: 'mspf',
        attributes: { relay: 1, activationStatus: 'ACTIVE' },
      };
      const ec = deriveEngineControl(dev);
      expect(ec.state).toBe('ACTIVE');
      expect(ec.isApplied).toBe(true);
    });

    test('Traccar: returns INACTIVE and isApplied: true when blocked: true', () => {
      const devBlocked = {
        id: 7771,
        source: 'traccar',
        attributes: { blocked: true },
        lastUpdate: '2026-09-10T12:30:00Z',
      };
      const ecBlocked = deriveEngineControl(devBlocked);
      expect(ecBlocked.state).toBe('INACTIVE');
      expect(ecBlocked.isApplied).toBe(true);
      expect(ecBlocked.desired).toBe('INACTIVE');
      expect(ecBlocked.lastAppliedAt).toBe('2026-09-10T12:30:00Z');
    });

    test('Traccar: strictly ignores generic out1/relay to avoid false-positives on buzzers/auxiliaries', () => {
      const devOut = {
        id: 7771,
        source: 'traccar',
        attributes: { out1: true, relay: 1 },
      };
      const ec = deriveEngineControl(devOut);
      expect(ec.state).toBe('ACTIVE');
      expect(ec.isApplied).toBe(true);
    });

    test('Traccar: returns DEACTIVATING when cut command was sent but blocked is not yet true', () => {
      setEngineDesired(7771, 'traccar', 'INACTIVE');
      const dev = {
        id: 7771,
        source: 'traccar',
        attributes: { blocked: false },
      };
      const ec = deriveEngineControl(dev);
      expect(ec.state).toBe('DEACTIVATING');
      expect(ec.isApplied).toBe(false);
      expect(ec.desired).toBe('INACTIVE');
    });

    test('Traccar: returns ACTIVE when vehicle is normal', () => {
      const dev = {
        id: 7771,
        source: 'traccar',
        attributes: {},
        lastUpdate: '2026-09-10T12:00:00Z',
      };
      const ec = deriveEngineControl(dev);
      expect(ec.state).toBe('ACTIVE');
      expect(ec.isApplied).toBe(true);
      expect(ec.desired).toBe('ACTIVE');
    });
  });

  describe('Integration via API Endpoints', () => {
    let adminToken;
    let customerToken;
    const testGroupId = 7770;

    beforeAll(async () => {
      await db.waitForMigration();

      const adminLogin = await request(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'admin123' });
      adminToken = adminLogin.body.token;

      await db('command_logs').whereIn('device_id', [7771, 7772]).delete();
      await db('device_groups').where({ group_id: testGroupId }).delete();
      await db('groups').where({ id: testGroupId }).delete();
      await db('users').where({ username: 'cust_engine' }).delete();

      await db('groups').insert({
        id: testGroupId,
        name: 'Engine Control Test Fleet',
      });

      await db('device_groups').insert([
        { device_id: 7771, source: 'traccar', group_id: testGroupId },
        { device_id: 7772, source: 'mspf', group_id: testGroupId },
      ]);

      deviceRouter.setSourceByDeviceId(7771, 'traccar');
      deviceRouter.setSourceByDeviceId(7772, 'mspf');

      await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'cust_engine',
          email: 'cust_engine@test.local',
          firstName: 'Cust',
          lastName: 'Engine',
          password: 'password123',
          confirmPassword: 'password123',
          role: 'customer',
          groups: [testGroupId],
          timezone: 'Asia/Jakarta',
          permissions: { canCutEngine: true },
        });

      const custLogin = await request(app)
        .post('/api/auth/login')
        .send({ username: 'cust_engine', password: 'password123' });
      customerToken = custLogin.body.token;
    });

    afterAll(async () => {
      await db('command_logs').whereIn('device_id', [7771, 7772]).delete();
      await db('device_groups').where({ group_id: testGroupId }).delete();
      await db('groups').where({ id: testGroupId }).delete();
      await db('users').where({ username: 'cust_engine' }).delete();
    });

    test('GET /api/devices/:id includes engineControl for both admin and customer', async () => {
      cache.set('devices:merged', [
        { id: 7771, name: 'Trac 1', source: 'traccar', attributes: { blocked: true } },
      ], 300);

      const adminRes = await request(app)
        .get('/api/devices/7771')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(adminRes.status).toBe(200);
      expect(adminRes.body.engineControl).toBeDefined();
      expect(adminRes.body.engineControl.state).toBe('INACTIVE');
      expect(adminRes.body.engineControl.isApplied).toBe(true);

      const custRes = await request(app)
        .get('/api/devices/7771')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(custRes.status).toBe(200);
      expect(custRes.body.source).toBeUndefined(); // customer white-labeled
      expect(custRes.body.engineControl).toBeDefined();
      expect(custRes.body.engineControl.state).toBe('INACTIVE');
      expect(custRes.body.engineControl.isApplied).toBe(true);
    });

    test('POST /api/commands engineStop returns immediate engineControl pending state', async () => {
      const res = await request(app)
        .post('/api/commands')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          deviceId: 7771,
          type: 'engineStop',
          confirm: true,
          reason: 'Testing remote immobilizer',
        });

      expect(res.status).toBe(200);
      expect(res.body.engineControl).toEqual({
        desired: 'INACTIVE',
        state: 'DEACTIVATING',
        isApplied: false,
        lastAppliedAt: null,
      });
    });

    test('PUT /api/commands/:deviceId/activation returns immediate engineControl state', async () => {
      const res = await request(app)
        .put('/api/commands/7772/activation')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          desiredStatus: 'ACTIVE',
        });

      expect(res.status).toBe(200);
      expect(res.body.engineControl).toEqual({
        desired: 'ACTIVE',
        state: 'ACTIVATING',
        isApplied: false,
        lastAppliedAt: null,
      });
    });
  });
});
