'use strict';

const request = require('supertest');

jest.mock('../services/traccar', () => ({
  getDevices: jest.fn(),
  getPositions: jest.fn(() => Promise.resolve([])),
}));

jest.mock('../services/mspf', () => ({
  init: jest.fn(),
  waitForInit: jest.fn(() => Promise.resolve()),
  getDevices: jest.fn(() => Promise.resolve({ data: [], total: 0 })),
  getPositions: jest.fn(() => Promise.resolve([])),
  getBcList: jest.fn(() => Promise.resolve([])),
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
const traccar = require('../services/traccar');
const mspf = require('../services/mspf');
const foxlogger = require('../services/foxlogger');
const {
  setDevices,
  _resetForTests: resetDeviceCache,
} = require('../services/deviceCache');
const {
  syncPositions,
  _resetForTests: resetPositionSync,
} = require('../services/positionSync');
const app = require('../app');

jest.setTimeout(15000);

describe('P2-T3b: positionSync integration with deviceCache', () => {
  let adminToken;
  let savedDevicesMerged;

  beforeAll(async () => {
    await db.waitForMigration();
    savedDevicesMerged = cache.get('devices:merged');

    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    adminToken = adminLogin.body.token;
  });

  afterAll(async () => {
    if (savedDevicesMerged !== undefined) {
      cache.set('devices:merged', savedDevicesMerged, 86400);
    } else {
      cache.del('devices:merged');
    }
  });

  beforeEach(() => {
    jest.resetAllMocks();
    resetDeviceCache();
    resetPositionSync();
    cache.del('devices:merged');
    cache.del('positions:merged');

    mspf.waitForInit.mockResolvedValue();
    foxlogger.waitForInit.mockResolvedValue();
    traccar.getPositions.mockResolvedValue([]);
    mspf.getPositions.mockResolvedValue([]);
    foxlogger.getPositions.mockResolvedValue([]);
    mspf.getBcList.mockResolvedValue([{ id: 10000001 }]);
  });

  test('skenario (i): 5 panggilan syncPositions/rebuild bersamaan dengan GET /api/devices hanya memanggil upstream 1x (single-flight lintas positionSync dan rute)', async () => {
    cache.del('devices:merged');

    // Beri sedikit jeda asinkron agar request berjalan bersamaan di event loop
    traccar.getDevices.mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve([
        { id: 101, name: 'Vehicle 101', uniqueId: 'v101', groupId: 1, attributes: {} },
      ]), 30);
    }));
    mspf.getDevices.mockResolvedValue({ data: [] });
    foxlogger.getDevices.mockResolvedValue({ data: [] });

    // 4 panggilan syncPositions dan 1 panggilan GET /api/devices secara bersamaan
    const concurrentCalls = [
      syncPositions(),
      syncPositions(),
      syncPositions(),
      syncPositions(),
      request(app).get('/api/devices').set('Authorization', `Bearer ${adminToken}`),
    ];

    const results = await Promise.all(concurrentCalls);
    const httpRes = results[4];
    expect(httpRes.status).toBe(200);

    // Ekspektasi: Single-flight lintas rute dan worker positionSync -> upstream hanya dipanggil tepat 1 kali
    expect(traccar.getDevices).toHaveBeenCalledTimes(1);
    expect(mspf.getDevices).toHaveBeenCalledTimes(1);
    expect(foxlogger.getDevices).toHaveBeenCalledTimes(1);
  });

  test('skenario (ii): setelah rebuild lewat positionSync, sisa TTL entri ≈ 24 jam (cache.getTtl), bukan 120 dtk', async () => {
    cache.del('devices:merged');

    traccar.getDevices.mockResolvedValue([
      { id: 201, name: 'Vehicle 201', uniqueId: 'v201', groupId: 1, attributes: {} },
    ]);
    mspf.getDevices.mockResolvedValue({ data: [] });
    foxlogger.getDevices.mockResolvedValue({ data: [] });
    mspf.getPositions.mockResolvedValue([
      { deviceId: 201, latitude: -6.2, longitude: 106.8, speed: 0, attributes: {} },
    ]);

    await syncPositions();

    const ttlTimestamp = cache.getTtl('devices:merged');
    const remainingSeconds = Math.round((ttlTimestamp - Date.now()) / 1000);

    // Di kode lama, positionSync.js:231 menulis dengan TTL 120 dtk.
    // Di kode baru, harus menggunakan hard TTL 24 jam (≈ 86400 detik).
    expect(remainingSeconds).toBeGreaterThan(23 * 3600);
  });

  test('skenario (iii): jika upstream gagal saat rebuild dan ada data lama, positionSync tidak menimpa dengan kosong', async () => {
    const oldDevices = [
      { id: 301, name: 'Old Vehicle 1', uniqueId: 'v301', source: 'traccar', group: 'traccar_1', attributes: {} },
      { id: 302, name: 'Old Vehicle 2', uniqueId: 'v302', source: 'mspf', group: 'mspf_1', attributes: {} },
    ];
    setDevices(oldDevices);

    // Simulasi cache entri terhapus/expired di node-cache
    cache.del('devices:merged');

    // Upstream gagal saat proses rebuild positionSync
    traccar.getDevices.mockRejectedValue(new Error('Traccar service unavailable'));
    mspf.getDevices.mockRejectedValue(new Error('MSPF timeout'));
    foxlogger.getDevices.mockRejectedValue(new Error('FoxLogger connection refused'));

    await syncPositions();

    // Di kode lama, positionSync.js:231 menimpa cache dengan rebuild = [] (array kosong).
    // Di kode baru, data lama harus tetap dipertahankan oleh deviceCache.
    const currentInCache = cache.get('devices:merged');
    expect(currentInCache).toHaveLength(oldDevices.length);
    expect(currentInCache[0].id).toBe(301);
  });
});
