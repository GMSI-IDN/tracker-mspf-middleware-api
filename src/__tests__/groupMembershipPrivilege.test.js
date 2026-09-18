const request = require('supertest');

jest.mock('../services/traccar', () => ({
  getDevices: jest.fn((params = {}) => {
    const devices = [
      { id: 8101, name: 'Privilege Trac Unit 1', uniqueId: 'trac_8101', status: 'online', groupId: 50 },
      { id: 8102, name: 'Privilege Trac Unit 2', uniqueId: 'trac_8102', status: 'online', groupId: 99 },
    ];
    if (params.id) return Promise.resolve(devices.filter(d => d.id === params.id));
    return Promise.resolve(devices);
  }),
  getGroups: jest.fn(() => Promise.resolve([{ id: 50, name: 'Group 50' }])),
  toKmh: jest.fn(s => s || 0),
  getHealth: jest.fn(),
}));

jest.mock('../services/mspf', () => ({
  init: jest.fn(),
  waitForInit: jest.fn(() => Promise.resolve()),
  getApi: jest.fn(() => ({ get: jest.fn(), put: jest.fn() })),
  getDevices: jest.fn((params = {}) => {
    const devices = [
      { id: 8201, name: 'Privilege MSPF Unit 1', uniqueId: 'mspf_8201', status: 'WORKING', bcId: 60, source: 'mspf', tags: {} },
      { id: 8202, name: 'Privilege MSPF Unit 2', uniqueId: 'mspf_8202', status: 'WORKING', bcId: 70, source: 'mspf', tags: {} },
    ];
    if (params['bc[]'] || params.bc) {
      const bcs = params['bc[]'] || params.bc;
      return Promise.resolve({ data: devices.filter(d => bcs.includes(d.bcId)), total: 1, next: null });
    }
    return Promise.resolve({ data: devices, total: devices.length, next: null });
  }),
  getBc: jest.fn((id) => Promise.resolve({ id, name: `BC ${id}` })),
  getBcList: jest.fn(() => Promise.resolve([{ id: 60, name: 'BC 60' }, { id: 70, name: 'BC 70' }])),
  getDevice: jest.fn((id) => Promise.resolve({
    id,
    name: `Privilege MSPF Unit ${id}`,
    bcId: 60,
    tags: {},
  })),
  enrichDevice: jest.fn((d) => Promise.resolve({
    ...d,
    source: 'mspf',
    group: `mspf_${d.bcId}`,
    attributes: { bcId: d.bcId },
  })),
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
const { isDeviceAllowedForGroups, getAllowedDeviceKeys, invalidateSyncRulesCache } = require('../services/groupMembership');

describe('Customer Privilege Security & Dynamic Sync vs Manual Segregation', () => {
  let adminToken;
  let customerAToken;
  let customerBToken;
  const customGroup1 = 8100;
  const customGroup2 = 8200;

  beforeAll(async () => {
    await db.waitForMigration();

    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    adminToken = adminLogin.body.token;

    // Clean up
    await db('group_sync_rules').whereIn('middleware_group_id', [customGroup1, customGroup2]).delete();
    await db('device_groups').whereIn('group_id', [customGroup1, customGroup2]).delete();
    await db('groups').whereIn('id', [customGroup1, customGroup2]).delete();
    await db('users').whereIn('username', ['cust_priv_a', 'cust_priv_b']).delete();

    // 1. Create Custom Group 1 & Custom Group 2
    await db('groups').insert([
      { id: customGroup1, name: 'Custom Group 1 (Sync MSPF 60)', description: 'G1' },
      { id: customGroup2, name: 'Custom Group 2 (Manual Trac 8102)', description: 'G2' },
    ]);

    // 2. Add Dynamic Sync Rule to Custom Group 1 for MSPF BC 60 (contains device 8201)
    await db('group_sync_rules').insert({
      middleware_group_id: customGroup1,
      source: 'mspf',
      source_group_id: 'mspf_60',
      source_group_name: 'MSPF BC 60',
    });

    // 3. Add Manual Device to Custom Group 2 (contains device 8102)
    await db('device_groups').insert({
      device_id: 8102,
      source: 'traccar',
      group_id: customGroup2,
    });

    // 4. Create Customer A (has Custom Group 1)
    await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username: 'cust_priv_a',
        email: 'cust_priv_a@test.local',
        firstName: 'Priv',
        lastName: 'A',
        password: 'password123',
        confirmPassword: 'password123',
        role: 'customer',
        groups: [customGroup1],
        timezone: 'Asia/Jakarta',
      });

    // Create Customer B (has Custom Group 2)
    await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username: 'cust_priv_b',
        email: 'cust_priv_b@test.local',
        firstName: 'Priv',
        lastName: 'B',
        password: 'password123',
        confirmPassword: 'password123',
        role: 'customer',
        groups: [customGroup2],
        timezone: 'Asia/Jakarta',
      });

    const loginA = await request(app).post('/api/auth/login').send({ username: 'cust_priv_a', password: 'password123' });
    customerAToken = loginA.body.token;

    const loginB = await request(app).post('/api/auth/login').send({ username: 'cust_priv_b', password: 'password123' });
    customerBToken = loginB.body.token;
  });

  beforeEach(() => {
    cache.del('devices:merged');
    invalidateSyncRulesCache();
  });

  afterAll(async () => {
    await db('group_sync_rules').whereIn('middleware_group_id', [customGroup1, customGroup2]).delete();
    await db('device_groups').whereIn('group_id', [customGroup1, customGroup2]).delete();
    await db('groups').whereIn('id', [customGroup1, customGroup2]).delete();
    await db('users').whereIn('username', ['cust_priv_a', 'cust_priv_b']).delete();
  });

  test('Customer A can access synced device 8201, but is FORBIDDEN from accessing device 8102 (403)', async () => {
    // Access allowed device 8201
    const resOk = await request(app)
      .get('/api/devices/8201')
      .set('Authorization', `Bearer ${customerAToken}`);
    expect(resOk.status).toBe(200);
    expect(resOk.body.id).toBe(8201);

    // Access forbidden device 8102 (belongs to Group 2)
    const resForbidden = await request(app)
      .get('/api/devices/8102')
      .set('Authorization', `Bearer ${customerAToken}`);
    expect(resForbidden.status).toBe(403);
    expect(resForbidden.body.code).toBe('ERR_FORBIDDEN');
  });

  test('Customer A list only contains 8201, and completely excludes 8202 (unlinked BC) and 8101/8102', async () => {
    const res = await request(app)
      .get('/api/devices')
      .set('Authorization', `Bearer ${customerAToken}`);

    expect(res.status).toBe(200);
    const ids = res.body.devices.map(d => d.id);
    expect(ids).toContain(8201);
    expect(ids).not.toContain(8202); // BC 70 is not in sync rules!
    expect(ids).not.toContain(8101); // Group 50 is not synced!
    expect(ids).not.toContain(8102); // Group 2 manual device!
  });

  test('Synced devices do not appear in GET /api/admin/device-groups (cannot be individually deleted)', async () => {
    // Only manual devices appear in device-groups table
    const res = await request(app)
      .get(`/api/admin/device-groups?groupId=${customGroup1}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    // Synced device 8201 should NOT be in the manual device_groups table
    const deviceIds = res.body.deviceGroups.map(dg => dg.deviceId);
    expect(deviceIds).not.toContain(8201);
    expect(res.body.deviceGroups.length).toBe(0);
  });

  test('Deleting a sync rule immediately revokes Customer A access to all synced devices', async () => {
    // 1. Verify Customer A currently has access
    const beforeRes = await request(app)
      .get('/api/devices/8201')
      .set('Authorization', `Bearer ${customerAToken}`);
    expect(beforeRes.status).toBe(200);

    // 2. Admin deletes sync rule
    const rule = await db('group_sync_rules').where({ middleware_group_id: customGroup1 }).first();
    const delRes = await request(app)
      .delete(`/api/admin/group-sync/${rule.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(delRes.status).toBe(200);

    // 3. Immediately verify Customer A loses access (403 Forbidden)!
    const afterRes = await request(app)
      .get('/api/devices/8201')
      .set('Authorization', `Bearer ${customerAToken}`);
    expect(afterRes.status).toBe(403);
    expect(afterRes.body.code).toBe('ERR_FORBIDDEN');

    // And Customer A device list becomes empty!
    const listRes = await request(app)
      .get('/api/devices')
      .set('Authorization', `Bearer ${customerAToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.devices.length).toBe(0);
  });
});
