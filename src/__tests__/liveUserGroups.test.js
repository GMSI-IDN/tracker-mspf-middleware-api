const request = require('supertest');

jest.mock('../services/traccar', () => ({
  getDevices: jest.fn(() => Promise.resolve([
    { id: 9501, name: 'Live Trac 1', uniqueId: 'trac_9501', status: 'online', groupId: 1 },
  ])),
  getGroups: jest.fn(() => Promise.resolve([])),
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

jest.mock('../services/customAttributes', () => ({
  applyRules: jest.fn(d => d),
  computeFormula: jest.fn(),
  getDeviceRules: jest.fn(() => Promise.resolve([])),
  buildDeviceRulesCache: jest.fn(() => Promise.resolve()),
}));

const db = require('../db');
const cache = require('../services/cache');
const app = require('../app');

describe('Live User Groups & No-Logout Session Continuity', () => {
  let adminToken;
  let customerToken;
  let customerUserId;
  const testGroup1 = 9510;
  const testGroup2 = 9520;

  beforeAll(async () => {
    await db.waitForMigration();

    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    adminToken = adminLogin.body.token;

    // Clean up
    await db('device_groups').whereIn('group_id', [testGroup1, testGroup2]).delete();
    await db('groups').whereIn('id', [testGroup1, testGroup2]).delete();
    await db('users').where({ username: 'cust_live_session' }).delete();

    // Create groups
    await db('groups').insert([
      { id: testGroup1, name: 'Group 1' },
      { id: testGroup2, name: 'Group 2' },
    ]);

    // Add device 9501 to Group 2
    await db('device_groups').insert({
      device_id: 9501,
      source: 'traccar',
      group_id: testGroup2,
    });

    // Create customer with ONLY testGroup1 initially
    const createRes = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username: 'cust_live_session',
        email: 'livesession@test.local',
        firstName: 'Live',
        lastName: 'Session',
        password: 'password123',
        confirmPassword: 'password123',
        role: 'customer',
        groups: [testGroup1],
        timezone: 'Asia/Jakarta',
        permissions: { canCutEngine: false },
      });
    customerUserId = createRes.body.id;

    // Customer logs in and obtains token
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'cust_live_session', password: 'password123' });
    customerToken = login.body.token;
  });

  beforeEach(() => {
    cache.del('devices:merged');
  });

  afterAll(async () => {
    await db('device_groups').whereIn('group_id', [testGroup1, testGroup2]).delete();
    await db('groups').whereIn('id', [testGroup1, testGroup2]).delete();
    await db('users').where({ username: 'cust_live_session' }).delete();
  });

  test('Customer cannot see device 9501 initially', async () => {
    const res = await request(app)
      .get('/api/devices')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    const ids = res.body.devices.map(d => d.id);
    expect(ids).not.toContain(9501);
  });

  test('When admin assigns testGroup2 to customer, customer IS NOT logged out and immediately accesses testGroup2 devices', async () => {
    // Admin updates customer's groups to [testGroup1, testGroup2], also sending standard permissions object from form
    const updateRes = await request(app)
      .put(`/api/users/${customerUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        groups: [testGroup1, testGroup2],
        permissions: { canCutEngine: false }, // same value, should not bump token_version!
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.groups).toEqual([testGroup1, testGroup2]);

    // CRITICAL: Customer makes subsequent request with the SAME EXISTING TOKEN (NOT logged out!)
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(meRes.status).toBe(200); // Token remains valid!
    expect(meRes.body.groups).toEqual([testGroup1, testGroup2]);

    // Customer immediately sees device 9501 from the newly assigned group!
    const devicesRes = await request(app)
      .get('/api/devices')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(devicesRes.status).toBe(200);
    const ids = devicesRes.body.devices.map(d => d.id);
    expect(ids).toContain(9501);
  });
});
