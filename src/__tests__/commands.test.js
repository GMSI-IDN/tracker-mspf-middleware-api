const request = require('supertest');
const bcrypt = require('bcryptjs');

jest.mock('../services/traccar', () => ({
  getDevices: jest.fn(),
  getGroups: jest.fn(),
  getPositions: jest.fn(),
  getReportRoute: jest.fn(),
  toKmh: jest.fn((s) => (s ? parseFloat((s * 1.852).toFixed(2)) : 0)),
  getCommands: jest.fn(),
  getCommandTypes: jest.fn(() => Promise.resolve(['engineStop', 'engineResume', 'positionPeriodic'])),
  sendCommand: jest.fn(() => Promise.resolve({ id: 101, type: 'engineStop' })),
  getHealth: jest.fn(),
}));

jest.mock('../services/mspf', () => ({
  init: jest.fn(),
  waitForInit: jest.fn(() => Promise.resolve()),
  getApi: jest.fn(() => ({ get: jest.fn(), put: jest.fn() })),
  activateDevice: jest.fn(() => Promise.resolve({ success: true })),
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
  applyRules: jest.fn((d) => d),
  computeFormula: jest.fn(),
  getDeviceRules: jest.fn(() => Promise.resolve([])),
  buildDeviceRulesCache: jest.fn(() => Promise.resolve()),
}));

const db = require('../db');
const deviceRouter = require('../services/deviceRouter');
const cache = require('../services/cache');
const mspf = require('../services/mspf');
const traccar = require('../services/traccar');
const app = require('../app');

describe('Vehicle Commands, Permissions & Audit Trail', () => {
  let adminToken;
  let customerTokenNoCut;
  let customerTokenWithCut;
  let testGroupId = 999;
  let customerNoCutId;
  let customerWithCutId;

  beforeAll(async () => {
    await db.waitForMigration();

    // 1. Login as admin
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    adminToken = adminLogin.body.token;

    // Clean up test data
    await db('command_logs').delete();
    await db('device_groups').where({ group_id: testGroupId }).delete();
    await db('groups').where({ id: testGroupId }).delete();
    await db('users').whereIn('username', ['cust_nocut', 'cust_withcut']).delete();

    // Create a custom test group
    await db('groups').insert({
      id: testGroupId,
      name: 'Test Commands Fleet',
      description: 'Group for testing command permissions',
    });

    // Assign devices 1001 (traccar) and 2001 (mspf) to test group
    await db('device_groups').insert([
      { device_id: 1001, source: 'traccar', group_id: testGroupId },
      { device_id: 2001, source: 'mspf', group_id: testGroupId },
      { device_id: 3001, source: 'foxlogger', group_id: testGroupId },
    ]);

    deviceRouter.setSourceByDeviceId(1001, 'traccar');
    deviceRouter.setSourceByDeviceId(2001, 'mspf');
    deviceRouter.setSourceByDeviceId(3001, 'foxlogger');
    deviceRouter.setSourceByDeviceId(9999, 'traccar'); // unassigned device

    // Create customer WITHOUT canCutEngine
    const resNoCut = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username: 'cust_nocut',
        email: 'cust_nocut@test.local',
        firstName: 'Cust',
        lastName: 'NoCut',
        password: 'password123',
        confirmPassword: 'password123',
        role: 'customer',
        groups: [testGroupId],
        timezone: 'Asia/Jakarta',
        permissions: { canCutEngine: false },
      });
    customerNoCutId = resNoCut.body.id;

    // Create customer WITH canCutEngine
    const resWithCut = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username: 'cust_withcut',
        email: 'cust_withcut@test.local',
        firstName: 'Cust',
        lastName: 'WithCut',
        password: 'password123',
        confirmPassword: 'password123',
        role: 'customer',
        groups: [testGroupId],
        timezone: 'Asia/Jakarta',
        permissions: { canCutEngine: true },
      });
    customerWithCutId = resWithCut.body.id;

    // Login both
    const loginNoCut = await request(app)
      .post('/api/auth/login')
      .send({ username: 'cust_nocut', password: 'password123' });
    customerTokenNoCut = loginNoCut.body.token;

    const loginWithCut = await request(app)
      .post('/api/auth/login')
      .send({ username: 'cust_withcut', password: 'password123' });
    customerTokenWithCut = loginWithCut.body.token;
  });

  beforeEach(() => {
    // Clear debounce cache keys before each test
    cache.del('debounce:cmd:traccar:1001');
    cache.del('debounce:cmd:mspf:2001');
    cache.del('debounce:cmd:traccar:9999');
    mspf.activateDevice.mockClear();
    traccar.sendCommand.mockClear();
  });

  afterAll(async () => {
    await db('command_logs').delete();
    await db('device_groups').where({ group_id: testGroupId }).delete();
    await db('groups').where({ id: testGroupId }).delete();
    await db('users').whereIn('username', ['cust_nocut', 'cust_withcut']).delete();
  });

  describe('User Permissions & Auth', () => {
    test('User profile and login return permissions object', async () => {
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${customerTokenNoCut}`);
      expect(meRes.status).toBe(200);
      expect(meRes.body.permissions).toEqual({ canCutEngine: false });

      const meCutRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${customerTokenWithCut}`);
      expect(meCutRes.status).toBe(200);
      expect(meCutRes.body.permissions).toEqual({ canCutEngine: true });
    });

    test('Admin can update customer permissions via PUT /api/users/:id', async () => {
      const updateRes = await request(app)
        .put(`/api/users/${customerNoCutId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ permissions: { canCutEngine: true } });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.permissions.canCutEngine).toBe(true);

      // Revert back for remaining tests
      await request(app)
        .put(`/api/users/${customerNoCutId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ permissions: { canCutEngine: false } });

      // Re-login to refresh token
      const reLogin = await request(app)
        .post('/api/auth/login')
        .send({ username: 'cust_nocut', password: 'password123' });
      customerTokenNoCut = reLogin.body.token;
    });
  });

  describe('Device Ownership Isolation', () => {
    test('Customer cannot send command to device outside their groups', async () => {
      const res = await request(app)
        .post('/api/commands')
        .set('Authorization', `Bearer ${customerTokenWithCut}`)
        .send({
          deviceId: 9999, // not in testGroupId
          type: 'engineResume',
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ERR_FORBIDDEN');
    });

    test('Admin can send command to any device regardless of group', async () => {
      const res = await request(app)
        .post('/api/commands')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          deviceId: 9999,
          type: 'engineResume',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Engine Cut Permission Guard (canCutEngine)', () => {
    test('Customer WITHOUT canCutEngine is rejected for POST /api/commands engineStop', async () => {
      const res = await request(app)
        .post('/api/commands')
        .set('Authorization', `Bearer ${customerTokenNoCut}`)
        .send({
          deviceId: 1001,
          type: 'engineStop',
          confirm: true,
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ERR_FORBIDDEN');
      expect(res.body.error).toContain('permission to stop vehicle engine');
    });

    test('Customer WITHOUT canCutEngine is rejected for PUT /activation INACTIVE', async () => {
      const res = await request(app)
        .put('/api/commands/1001/activation')
        .set('Authorization', `Bearer ${customerTokenNoCut}`)
        .send({
          desiredStatus: 'INACTIVE',
          confirm: true,
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ERR_FORBIDDEN');
    });

    test('Customer WITHOUT canCutEngine can still send non-cut commands (e.g. engineResume / ACTIVE)', async () => {
      const res = await request(app)
        .put('/api/commands/1001/activation')
        .set('Authorization', `Bearer ${customerTokenNoCut}`)
        .send({
          desiredStatus: 'ACTIVE',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.desiredStatus).toBe('ACTIVE');
    });
  });

  describe('Safety Notice & Confirmation Flow', () => {
    test('Returns 422 WARN_CONFIRMATION_REQUIRED when confirm is missing for engineStop', async () => {
      const res = await request(app)
        .post('/api/commands')
        .set('Authorization', `Bearer ${customerTokenWithCut}`)
        .send({
          deviceId: 1001,
          type: 'engineStop',
          // confirm omitted
        });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('WARN_CONFIRMATION_REQUIRED');
      expect(res.body.requiresConfirmation).toBe(true);
      expect(res.body.safetyNotice).toBeDefined();
    });

    test('Returns 422 WARN_CONFIRMATION_REQUIRED for PUT /activation INACTIVE without confirm', async () => {
      const res = await request(app)
        .put('/api/commands/1001/activation')
        .set('Authorization', `Bearer ${customerTokenWithCut}`)
        .send({
          desiredStatus: 'INACTIVE',
          // confirm omitted
        });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('WARN_CONFIRMATION_REQUIRED');
      expect(res.body.requiresConfirmation).toBe(true);
    });

    test('Succeeds when confirm: true is provided with reason', async () => {
      const res = await request(app)
        .post('/api/commands')
        .set('Authorization', `Bearer ${customerTokenWithCut}`)
        .send({
          deviceId: 1001,
          type: 'engineStop',
          confirm: true,
          reason: 'Suspected stolen vehicle',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.commandType).toBe('engineStop');
    });
  });

  describe('GET /api/commands/types/:deviceId UI Filter', () => {
    test('Hides engineStop and deactivate from customer without canCutEngine', async () => {
      const res = await request(app)
        .get('/api/commands/types/1001')
        .set('Authorization', `Bearer ${customerTokenNoCut}`);

      expect(res.status).toBe(200);
      expect(res.body.types).not.toContain('engineStop');
      expect(res.body.types).not.toContain('deactivate');
    });

    test('Shows engineStop to customer with canCutEngine', async () => {
      const res = await request(app)
        .get('/api/commands/types/1001')
        .set('Authorization', `Bearer ${customerTokenWithCut}`);

      expect(res.status).toBe(200);
      expect(res.body.types).toContain('engineStop');
    });

    test('Returns 403 when customer tries to get types for unassigned device', async () => {
      const res = await request(app)
        .get('/api/commands/types/9999')
        .set('Authorization', `Bearer ${customerTokenWithCut}`);

      expect(res.status).toBe(403);
    });
  });

  describe('Unified Commands Mapping across Providers (MSPF & Traccar)', () => {
    test('POST /api/commands with type: engineResume on MSPF device sends ACTIVE to MSPF', async () => {
      const res = await request(app)
        .post('/api/commands')
        .set('Authorization', `Bearer ${customerTokenWithCut}`)
        .send({
          deviceId: 2001,
          type: 'engineResume',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.commandType).toBe('engineResume');
      expect(mspf.activateDevice).toHaveBeenCalledWith(2001, 'ACTIVE');
      expect(res.body.engineControl).toEqual({
        desired: 'ACTIVE',
        state: 'ACTIVATING',
        isApplied: false,
        lastAppliedAt: null,
      });
    });

    test('POST /api/commands with type: engineStop on MSPF device sends INACTIVE to MSPF', async () => {
      const res = await request(app)
        .post('/api/commands')
        .set('Authorization', `Bearer ${customerTokenWithCut}`)
        .send({
          deviceId: 2001,
          type: 'engineStop',
          confirm: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.commandType).toBe('engineStop');
      expect(mspf.activateDevice).toHaveBeenCalledWith(2001, 'INACTIVE');
      expect(res.body.engineControl).toEqual({
        desired: 'INACTIVE',
        state: 'DEACTIVATING',
        isApplied: false,
        lastAppliedAt: null,
      });
    });

    test('POST /api/commands with legacy type: activate on MSPF device sends ACTIVE to MSPF', async () => {
      const res = await request(app)
        .post('/api/commands')
        .set('Authorization', `Bearer ${customerTokenWithCut}`)
        .send({
          deviceId: 2001,
          type: 'activate',
        });

      expect(res.status).toBe(200);
      expect(mspf.activateDevice).toHaveBeenCalledWith(2001, 'ACTIVE');
    });

    test('POST /api/commands with legacy type: deactivate on MSPF device sends INACTIVE to MSPF', async () => {
      const res = await request(app)
        .post('/api/commands')
        .set('Authorization', `Bearer ${customerTokenWithCut}`)
        .send({
          deviceId: 2001,
          type: 'deactivate',
          confirm: true,
        });

      expect(res.status).toBe(200);
      expect(mspf.activateDevice).toHaveBeenCalledWith(2001, 'INACTIVE');
    });

    test('POST /api/commands with legacy type: activate on Traccar device translates to engineResume', async () => {
      const res = await request(app)
        .post('/api/commands')
        .set('Authorization', `Bearer ${customerTokenWithCut}`)
        .send({
          deviceId: 1001,
          type: 'activate',
        });

      expect(res.status).toBe(200);
      expect(traccar.sendCommand).toHaveBeenCalledWith(expect.objectContaining({
        deviceId: 1001,
        type: 'engineResume',
      }));
    });

    test('POST /api/commands with unsupported command on MSPF returns 400 ERR_NOT_SUPPORTED', async () => {
      const res = await request(app)
        .post('/api/commands')
        .set('Authorization', `Bearer ${customerTokenWithCut}`)
        .send({
          deviceId: 2001,
          type: 'customUnsupportedCommand',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('ERR_NOT_SUPPORTED');
      expect(mspf.activateDevice).not.toHaveBeenCalled();
    });

    test('GET /types on MSPF device returns unified engineResume and engineStop', async () => {
      const res = await request(app)
        .get('/api/commands/types/2001')
        .set('Authorization', `Bearer ${customerTokenWithCut}`);

      expect(res.status).toBe(200);
      expect(res.body.types).toContain('engineResume');
      expect(res.body.types).toContain('engineStop');
    });
  });

  describe('Debounce & Device Support', () => {
    test('Rejects command to FoxLogger device with 400', async () => {
      const res = await request(app)
        .post('/api/commands')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          deviceId: 3001,
          type: 'engineStop',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('ERR_NOT_SUPPORTED');
    });

    test('Debounce returns 429 when sending duplicate command within 5 seconds', async () => {
      const res1 = await request(app)
        .put('/api/commands/2001/activation')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ desiredStatus: 'ACTIVE' });

      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .put('/api/commands/2001/activation')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ desiredStatus: 'ACTIVE' });

      expect(res2.status).toBe(429);
      expect(res2.body.code).toBe('ERR_RATE_LIMIT');
    });
  });

  describe('Audit Trail: GET /api/commands/logs', () => {
    test('Admin can view all command logs', async () => {
      const res = await request(app)
        .get('/api/commands/logs')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.logs)).toBe(true);
      expect(res.body.total).toBeGreaterThanOrEqual(1);

      // Verify log details
      const stolenLog = res.body.logs.find(l => l.reason === 'Suspected stolen vehicle');
      expect(stolenLog).toBeDefined();
      expect(stolenLog.confirmed).toBe(true);
      expect(stolenLog.status).toBe('SUCCESS');
      expect(stolenLog.commandType).toBe('engineStop');
    });

    test('Customer only sees logs for devices in their groups', async () => {
      const res = await request(app)
        .get('/api/commands/logs')
        .set('Authorization', `Bearer ${customerTokenWithCut}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.logs)).toBe(true);

      // Every log should belong to testGroupId devices (1001, 2001, 3001)
      for (const log of res.body.logs) {
        expect([1001, 2001, 3001]).toContain(log.deviceId);
      }
    });

    test('Logs support filtering by status and deviceId', async () => {
      const res = await request(app)
        .get('/api/commands/logs?deviceId=1001&status=SUCCESS')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      for (const log of res.body.logs) {
        expect(log.deviceId).toBe(1001);
        expect(log.status).toBe('SUCCESS');
      }
    });
  });
});
