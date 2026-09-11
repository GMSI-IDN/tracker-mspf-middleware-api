const request = require('supertest');

jest.mock('../services/traccar', () => ({
  getDevices: jest.fn((params = {}) => {
    const devices = [
      { id: 9101, name: 'Trac Unit 1', uniqueId: 'trac_9101', status: 'online', groupId: 10 },
      { id: 9102, name: 'Trac Unit 2', uniqueId: 'trac_9102', status: 'online', groupId: 10 },
      { id: 9103, name: 'Trac Other Group', uniqueId: 'trac_9103', status: 'online', groupId: 99 },
    ];
    if (params.id) {
      return Promise.resolve(devices.filter(d => d.id === params.id));
    }
    return Promise.resolve(devices);
  }),
  getGroups: jest.fn(() => Promise.resolve([
    { id: 10, name: 'Traccar Fleet Group 10' },
  ])),
  toKmh: jest.fn(s => s || 0),
  getHealth: jest.fn(),
}));

jest.mock('../services/mspf', () => ({
  init: jest.fn(),
  waitForInit: jest.fn(() => Promise.resolve()),
  getApi: jest.fn(() => ({ get: jest.fn(), put: jest.fn() })),
  getDevices: jest.fn((params = {}) => {
    const devices = [
      { id: 9201, name: 'MSPF Unit 1', uniqueId: 'mspf_9201', status: 'WORKING', bcId: 20, source: 'mspf', tags: {} },
      { id: 9202, name: 'MSPF Unit 2', uniqueId: 'mspf_9202', status: 'WORKING', bcId: 20, source: 'mspf', tags: {} },
      { id: 9203, name: 'MSPF BC 30 Unit', uniqueId: 'mspf_9203', status: 'WORKING', bcId: 30, source: 'mspf', tags: {} },
    ];
    if (params['bc[]'] || params.bc) {
      const bcList = params['bc[]'] || params.bc;
      return Promise.resolve({
        data: devices.filter(d => bcList.includes(d.bcId)),
        total: 1,
        next: null,
      });
    }
    return Promise.resolve({ data: devices, total: devices.length, next: null });
  }),
  getBc: jest.fn((id) => Promise.resolve({ id, name: `MSPF BC ${id}` })),
  getBcList: jest.fn(() => Promise.resolve([{ id: 20, name: 'MSPF BC 20' }])),
}));

jest.mock('../services/foxlogger', () => ({
  init: jest.fn(),
  waitForInit: jest.fn(() => Promise.resolve()),
  getApi: jest.fn(),
  getDevices: jest.fn(() => Promise.resolve({
    data: [
      { id: 9301, name: 'Fox Unit 1', uniqueId: 'fox_9301', status: 'online', source: 'foxlogger' },
    ],
  })),
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
const { runAutoSync } = require('../services/autoSync');

describe('Custom Groups: Multi-Sync Rules, Manual Add & Customer Deduplication', () => {
  let adminToken;
  let customerToken;
  const groupAId = 9100;
  const groupBId = 9200;

  beforeAll(async () => {
    await db.waitForMigration();

    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    adminToken = adminLogin.body.token;

    // Clean up test data
    await db('group_sync_rules').whereIn('middleware_group_id', [groupAId, groupBId]).delete();
    await db('device_groups').whereIn('group_id', [groupAId, groupBId]).delete();
    await db('groups').whereIn('id', [groupAId, groupBId]).delete();
    await db('users').where({ username: 'cust_multigroup' }).delete();

    // 1. Create two custom groups
    await db('groups').insert([
      { id: groupAId, name: 'Custom Group A (Hybrid: Traccar + MSPF + Manual)', description: 'Group A' },
      { id: groupBId, name: 'Custom Group B (Overlapping MSPF Group)', description: 'Group B' },
    ]);

    // 2. Setup sync rules for Group A:
    // Rule 1: Sync from Traccar Group 10 (contains 9101, 9102)
    // Rule 2: Sync from MSPF BC 20 (contains 9201, 9202)
    await db('group_sync_rules').insert([
      { middleware_group_id: groupAId, source: 'traccar', source_group_id: 'traccar_10', source_group_name: 'Traccar 10' },
      { middleware_group_id: groupAId, source: 'mspf', source_group_id: 'mspf_20', source_group_name: 'MSPF 20' },
      // Rule for Group B: Sync from MSPF BC 20 (overlapping with Group A: contains 9201, 9202)
      { middleware_group_id: groupBId, source: 'mspf', source_group_id: 'mspf_20', source_group_name: 'MSPF 20' },
    ]);

    // 3. Execute auto-sync
    await runAutoSync();

    // 4. Manually add a device to Group A: 9301 (FoxLogger)
    await db('device_groups').insert({
      device_id: 9301,
      source: 'foxlogger',
      group_id: groupAId,
    });

    // Also manually add 9101 (Traccar) to Group B (overlapping with Group A)
    await db('device_groups').insert({
      device_id: 9101,
      source: 'traccar',
      group_id: groupBId,
    });

    // 5. Create customer user assigned to BOTH Group A and Group B
    await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username: 'cust_multigroup',
        email: 'cust_multigroup@test.local',
        firstName: 'Multi',
        lastName: 'Group',
        password: 'password123',
        confirmPassword: 'password123',
        role: 'customer',
        groups: [groupAId, groupBId],
        timezone: 'Asia/Jakarta',
      });

    const custLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'cust_multigroup', password: 'password123' });
    customerToken = custLogin.body.token;
  });

  beforeEach(() => {
    cache.del('devices:merged');
  });

  afterAll(async () => {
    await db('group_sync_rules').whereIn('middleware_group_id', [groupAId, groupBId]).delete();
    await db('device_groups').whereIn('group_id', [groupAId, groupBId]).delete();
    await db('groups').whereIn('id', [groupAId, groupBId]).delete();
    await db('users').where({ username: 'cust_multigroup' }).delete();
  });

  test('Auto-sync populates multi-sync rules and ignores non-matching group devices', async () => {
    const groupADevices = await db('device_groups').where({ group_id: groupAId }).select('*');
    // Group A should have: 9101 (traccar), 9102 (traccar), 9201 (mspf), 9202 (mspf), 9301 (foxlogger manual)
    const deviceIds = groupADevices.map(d => d.device_id);
    expect(deviceIds).toContain(9101);
    expect(deviceIds).toContain(9102);
    expect(deviceIds).toContain(9201);
    expect(deviceIds).toContain(9202);
    expect(deviceIds).toContain(9301);
    // Should NOT contain 9103 (Traccar group 99) or 9203 (MSPF BC 30)
    expect(deviceIds).not.toContain(9103);
    expect(deviceIds).not.toContain(9203);
  });

  test('Customer GET /api/devices strictly deduplicates overlapping devices across groups', async () => {
    const res = await request(app)
      .get('/api/devices')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.devices)).toBe(true);

    // Collect all device IDs returned in response
    const ids = res.body.devices.map(d => d.id);
    const uniqueIds = new Set(ids);

    // Strict deduplication invariant: total length must equal unique set length!
    expect(ids.length).toBe(uniqueIds.size);

    // Overlapping devices 9101, 9201, 9202 must appear EXACTLY ONCE
    expect(ids.filter(id => id === 9101).length).toBe(1);
    expect(ids.filter(id => id === 9201).length).toBe(1);
    expect(ids.filter(id => id === 9202).length).toBe(1);

    // Check customGroups array on overlapping device 9101: must include BOTH Group A and Group B
    const dev9101 = res.body.devices.find(d => d.id === 9101);
    expect(dev9101).toBeDefined();
    expect(dev9101.customGroups).toBeDefined();
    const groupIdsFor9101 = dev9101.customGroups.map(g => g.id);
    expect(groupIdsFor9101).toContain(groupAId);
    expect(groupIdsFor9101).toContain(groupBId);

    // Verify customer data sanitization: source and vendor group must be undefined
    expect(dev9101.source).toBeUndefined();
    expect(dev9101.group).toBeUndefined();
  });

  test('Customer GET /api/devices?group=X filters accurately and attaches customGroups', async () => {
    // Request Group A: should contain 9101, 9102, 9201, 9202, 9301
    const resA = await request(app)
      .get(`/api/devices?group=${groupAId}`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(resA.status).toBe(200);
    const idsA = resA.body.devices.map(d => d.id);
    expect(idsA).toContain(9101);
    expect(idsA).toContain(9102);
    expect(idsA).toContain(9201);
    expect(idsA).toContain(9202);
    expect(idsA).toContain(9301);
    expect(idsA).not.toContain(9103);

    // Ensure customGroups is populated even when filtering with ?group=X
    for (const d of resA.body.devices) {
      expect(d.customGroups).toBeDefined();
      expect(Array.isArray(d.customGroups)).toBe(true);
      expect(d.customGroups.length).toBeGreaterThanOrEqual(1);
    }

    // Request Group B: should contain 9101, 9201, 9202
    const resB = await request(app)
      .get(`/api/devices?group=${groupBId}`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(resB.status).toBe(200);
    const idsB = resB.body.devices.map(d => d.id);
    expect(idsB).toContain(9101);
    expect(idsB).toContain(9201);
    expect(idsB).toContain(9202);
    expect(idsB).not.toContain(9102);
    expect(idsB).not.toContain(9301);
  });

  test('POST /api/admin/group-sync immediately triggers auto-sync into device_groups', async () => {
    // Create new custom group C
    const groupCId = 9300;
    await db('groups').insert({
      id: groupCId,
      name: 'Group C Dynamic Sync',
      description: 'Group C',
    });

    try {
      const createRes = await request(app)
        .post('/api/admin/group-sync')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          middlewareGroupId: groupCId,
          source: 'traccar',
          sourceGroupId: 'traccar_10',
        });

      expect(createRes.status).toBe(201);

      // Wait a tiny tick for async sync to finish
      await new Promise(r => setTimeout(r, 200));

      // Verify devices are immediately synced into device_groups for Group C!
      const groupCDevices = await db('device_groups').where({ group_id: groupCId }).select('*');
      expect(groupCDevices.length).toBeGreaterThanOrEqual(2);
      const ids = groupCDevices.map(d => d.device_id);
      expect(ids).toContain(9101);
      expect(ids).toContain(9102);
    } finally {
      await db('group_sync_rules').where({ middleware_group_id: groupCId }).delete();
      await db('device_groups').where({ group_id: groupCId }).delete();
      await db('groups').where({ id: groupCId }).delete();
    }
  });
});
