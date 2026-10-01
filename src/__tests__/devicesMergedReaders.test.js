'use strict';

const request = require('supertest');

jest.mock('../services/traccar', () => ({
  getDevices: jest.fn(() => Promise.resolve([])),
  getPositions: jest.fn(() => Promise.resolve([])),
  getReportTrips: jest.fn(() => Promise.resolve([])),
  getReportSummary: jest.fn(() => Promise.resolve([])),
}));

jest.mock('../services/mspf', () => ({
  init: jest.fn(),
  waitForInit: jest.fn(() => Promise.resolve()),
  getDevices: jest.fn(() => Promise.resolve({ data: [], total: 0 })),
  getPositions: jest.fn(() => Promise.resolve([])),
  getBcList: jest.fn(() => Promise.resolve([])),
  getBcStatsReports: jest.fn(() => Promise.resolve([])),
  getStatsSummary: jest.fn(() => Promise.resolve({})),
}));

jest.mock('../services/foxlogger', () => ({
  init: jest.fn(),
  waitForInit: jest.fn(() => Promise.resolve()),
  getDevices: jest.fn(() => Promise.resolve({ data: [] })),
  getPositions: jest.fn(() => Promise.resolve([])),
}));

jest.mock('../services/autoSync', () => ({
  runAutoSync: jest.fn(),
}));

const db = require('../db');
const cache = require('../services/cache');
const { setDevices } = require('../services/deviceCache');
const app = require('../app');

jest.setTimeout(15000);

describe('P2-T3c: Reader paths in dashboard.js and reports.js (hard TTL & soft expiry)', () => {
  let adminToken;
  let customerToken;
  let savedDevicesMerged;
  const testGroupId = 7800;

  const origPerfNow = performance.now;
  const origDateNow = Date.now;

  const seededDevices = [
    {
      id: 7801,
      name: 'Reader Vehicle 7801',
      uniqueId: 'trac_7801',
      source: 'traccar',
      status: 'online',
      group: 'traccar_10',
      attributes: {},
    },
    {
      id: 7802,
      name: 'Reader Vehicle 7802',
      uniqueId: 'mspf_7802',
      source: 'mspf',
      status: 'online',
      group: 'mspf_60',
      attributes: { bcId: 60 },
    },
  ];

  beforeAll(async () => {
    await db.waitForMigration();
    savedDevicesMerged = cache.get('devices:merged');

    // 1. Admin login
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    adminToken = adminLogin.body.token;

    // 2. Clean up test records
    await db('device_groups').where({ group_id: testGroupId }).delete();
    await db('groups').where({ id: testGroupId }).delete();
    await db('users').where({ username: 'cust_readers' }).delete();

    // 3. Create custom group and assign device 7801
    await db('groups').insert({
      id: testGroupId,
      name: 'Readers Test Fleet',
      description: 'Fleet for verifying soft expired reader behavior',
    });

    await db('device_groups').insert({
      device_id: 7801,
      source: 'traccar',
      group_id: testGroupId,
    });

    // 4. Create customer user
    await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username: 'cust_readers',
        email: 'cust_readers@test.local',
        firstName: 'Cust',
        lastName: 'Readers',
        password: 'password123',
        confirmPassword: 'password123',
        role: 'customer',
        groups: [testGroupId],
        timezone: 'Asia/Jakarta',
      });

    const custLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'cust_readers', password: 'password123' });
    customerToken = custLogin.body.token;
  });

  afterAll(async () => {
    performance.now = origPerfNow;
    Date.now = origDateNow;

    if (savedDevicesMerged !== undefined) {
      setDevices(savedDevicesMerged);
    } else {
      cache.del('devices:merged');
    }

    await db('device_groups').where({ group_id: testGroupId }).delete();
    await db('groups').where({ id: testGroupId }).delete();
    await db('users').where({ username: 'cust_readers' }).delete();
  });

  beforeEach(() => {
    performance.now = origPerfNow;
    Date.now = origDateNow;

    // Tulis data armada melalui API resmi setDevices (menghasilkan hard TTL 24 jam)
    setDevices(seededDevices);
  });

  afterEach(() => {
    performance.now = origPerfNow;
    Date.now = origDateNow;
  });

  test('GET /api/dashboard (Admin): saat data lewat freshUntil (soft expired) tapi dalam hard TTL, membaca data lama (BUKAN 0 kendaraan)', async () => {
    // Verifikasi data ada di cache sebelum waktu dimajukan
    expect(cache.get('devices:merged')).toHaveLength(2);

    // Simulasi: Waktu maju 180 detik (melewati freshUntil 120 detik, namun jauh di bawah hard TTL 24 jam / 86400 detik)
    const simulatedAdvanceMs = 180 * 1000;
    performance.now = () => origPerfNow.call(performance) + simulatedAdvanceMs;
    Date.now = () => origDateNow.call(Date) + simulatedAdvanceMs;

    // Verifikasi kondisi soft expired:
    // (a) Entri di node-cache tetap ada karena hard TTL 86400s >> 180s
    expect(cache.get('devices:merged')).toHaveLength(2);
    const ttlTimestamp = cache.getTtl('devices:merged');
    const remainingSeconds = Math.round((ttlTimestamp - Date.now()) / 1000);
    expect(remainingSeconds).toBeGreaterThan(23 * 3600);

    // Request ke endpoint dashboard
    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.devices.total).toBe(2);
    expect(res.body.devices.online).toBe(2);
    expect(res.body.devices.bySource.traccar).toBe(1);
    expect(res.body.devices.bySource.mspf).toBe(1);
    expect(res.body.devices.total).not.toBe(0);
  });

  test('GET /api/dashboard (Customer): saat data lewat freshUntil tapi dalam hard TTL, customer tetap melihat armadanya (BUKAN 0 kendaraan)', async () => {
    // Simulasi: Waktu maju 180 detik
    const simulatedAdvanceMs = 180 * 1000;
    performance.now = () => origPerfNow.call(performance) + simulatedAdvanceMs;
    Date.now = () => origDateNow.call(Date) + simulatedAdvanceMs;

    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    // Customer hanya memiliki akses ke group 7800 yang berisi 1 kendaraan (7801)
    expect(res.body.devices.total).toBe(1);
    expect(res.body.devices.online).toBe(1);
    expect(res.body.devices.total).not.toBe(0);
  });

  test('GET /api/reports/top-distance: membaca devices:merged dari cache saat soft expired', async () => {
    // Simulasi: Waktu maju 180 detik
    const simulatedAdvanceMs = 180 * 1000;
    performance.now = () => origPerfNow.call(performance) + simulatedAdvanceMs;
    Date.now = () => origDateNow.call(Date) + simulatedAdvanceMs;

    cache.del('reports:masterDistance:24h');

    const res = await request(app)
      .get('/api/reports/top-distance')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('topDevices');
    expect(Array.isArray(res.body.topDevices)).toBe(true);
    expect(res.body.totalDevicesEvaluated).toBe(2);
    // Verifikasi entri kendaraan dari devices:merged tetap masuk ke kalkulasi top-distance
    const found7801 = res.body.topDevices.find(d => d.deviceId === 7801 || d.name?.includes('7801'));
    expect(found7801).toBeDefined();
  });

  test('GET /api/reports/summary (group & granularity): rute laporan membaca group mapping dari devices:merged saat soft expired', async () => {
    // Simulasi: Waktu maju 180 detik
    const simulatedAdvanceMs = 180 * 1000;
    performance.now = () => origPerfNow.call(performance) + simulatedAdvanceMs;
    Date.now = () => origDateNow.call(Date) + simulatedAdvanceMs;

    const res = await request(app)
      .get(`/api/reports/summary?group=${testGroupId}&granularity=day`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.type).toBe('group');
    expect(res.body.group.id).toBe(testGroupId);
    expect(Array.isArray(res.body.series)).toBe(true);
  });
});
