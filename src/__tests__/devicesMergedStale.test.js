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
const { triggerRebuild, _resetForTests } = require('../services/deviceCache');
const app = require('../app');

jest.setTimeout(10000);

describe('P2-T1 Reproduction: devices:merged stale-while-revalidate & single-flight', () => {
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
      cache.set('devices:merged', savedDevicesMerged, 120);
    } else {
      cache.del('devices:merged');
    }
  });

  beforeEach(() => {
    _resetForTests();
    jest.resetAllMocks();
    mspf.waitForInit.mockResolvedValue();
    foxlogger.waitForInit.mockResolvedValue();
    mspf.getDevices.mockResolvedValue({ data: [], total: 0 });
    foxlogger.getDevices.mockResolvedValue({ data: [] });
    mspf.getPositions.mockResolvedValue([]);
    foxlogger.getPositions.mockResolvedValue([]);
    traccar.getPositions.mockResolvedValue([]);
  });

  test('skenario (a): setelah TTL habis, hasil kosong padahal data lama ada', async () => {
    const oldDevices = [
      { id: 101, name: 'Vehicle 101', uniqueId: 'v101', source: 'traccar', group: 'traccar_1', attributes: {} },
      { id: 102, name: 'Vehicle 102', uniqueId: 'v102', source: 'traccar', group: 'traccar_1', attributes: {} },
    ];
    cache.set('devices:merged', oldDevices, 120);

    // Pastikan data lama ada sebelum kedaluwarsa
    expect(cache.get('devices:merged')).toHaveLength(2);

    // Simulasi TTL habis: entri kedaluwarsa dari cache
    cache.del('devices:merged');

    // Upstream gagal saat proses revalidasi/rebuild
    traccar.getDevices.mockRejectedValue(new Error('Upstream Traccar unavailable'));
    mspf.getDevices.mockRejectedValue(new Error('Upstream MSPF unavailable'));
    foxlogger.getDevices.mockRejectedValue(new Error('Upstream FoxLogger unavailable'));

    const res = await request(app)
      .get('/api/devices')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    // Ekspektasi Pilar 2 (stale-while-revalidate): saat upstream gagal pasca kedaluwarsa,
    // gateway harus tetap menyajikan data lama yang ada dan tidak menghasilkan data kosong.
    // Pada implementasi sekarang, assertion ini GAGAL karena getOrBuildDeviceCache() mengembalikan []
    // dan menimpa cache dengan array kosong.
    expect(res.body.devices.length).toBe(oldDevices.length);
  });

  test('skenario (b): N request bersamaan setelah kedaluwarsa memicu >1 panggilan upstream', async () => {
    // Simulasi TTL habis / cache kosong
    cache.del('devices:merged');

    // Mock upstream dengan jeda asinkron (30ms) untuk mensimulasikan latensi I/O jaringan
    traccar.getDevices.mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve([
        { id: 201, name: 'Vehicle 201', uniqueId: 'v201', groupId: 1, attributes: {} },
      ]), 30);
    }));
    mspf.getDevices.mockResolvedValue({ data: [] });
    foxlogger.getDevices.mockResolvedValue({ data: [] });

    // N request bersamaan masuk setelah kedaluwarsa
    const N = 3;
    const concurrentRequests = Array.from({ length: N }, () =>
      request(app)
        .get('/api/devices')
        .set('Authorization', `Bearer ${adminToken}`)
    );

    const responses = await Promise.all(concurrentRequests);

    for (const res of responses) {
      expect(res.status).toBe(200);
    }

    // Ekspektasi Pilar 2 (single-flight): N request bersamaan hanya boleh memicu tepat 1 panggilan ke upstream
    // Pada implementasi sekarang, assertion ini GAGAL karena tidak ada coalescing / in-flight promise deduplication
    // sehingga traccar.getDevices dipanggil N kali (3 kali).
    expect(traccar.getDevices).toHaveBeenCalledTimes(1);
  });

  test('kegagalan sebagian: kegagalan salah satu upstream tidak menimpa data lama yang lengkap', async () => {
    // Data lama mencakup perangkat dari Traccar dan MSPF
    const oldDevices = [
      { id: 301, name: 'Traccar Old 1', uniqueId: 't301', source: 'traccar', group: 'traccar_1', attributes: {} },
      { id: 302, name: 'Traccar Old 2', uniqueId: 't302', source: 'traccar', group: 'traccar_1', attributes: {} },
      { id: 303, name: 'MSPF Old 1', uniqueId: 'm303', source: 'mspf', group: 'mspf_1', attributes: {} },
      { id: 304, name: 'MSPF Old 2', uniqueId: 'm304', source: 'mspf', group: 'mspf_1', attributes: {} },
    ];
    cache.set('devices:merged', oldDevices, 120);

    // Rebuild dipicu: Traccar berhasil memberikan armada baru, MSPF gagal (503), FoxLogger kosong
    traccar.getDevices.mockResolvedValue([
      { id: 301, name: 'Traccar New 1', uniqueId: 't301', groupId: 1, attributes: {} },
      { id: 302, name: 'Traccar New 2', uniqueId: 't302', groupId: 1, attributes: {} },
    ]);
    mspf.getDevices.mockRejectedValue(new Error('MSPF 503 Service Unavailable'));
    foxlogger.getDevices.mockResolvedValue({ data: [] });

    // Paksa rebuild untuk mensimulasikan proses revalidasi
    const rebuilt = await triggerRebuild();

    // Verifikasi total perangkat tetap 4 (2 Traccar baru + 2 MSPF lama dipertahankan)
    expect(rebuilt.length).toBe(4);
    const mspfDevices = rebuilt.filter((d) => d.source === 'mspf');
    expect(mspfDevices.length).toBe(2);
    expect(mspfDevices.map((d) => d.id).sort()).toEqual([303, 304]);

    const traccarDevices = rebuilt.filter((d) => d.source === 'traccar');
    expect(traccarDevices.length).toBe(2);
    expect(traccarDevices[0].name).toBe('Traccar New 1');

    // Verifikasi via HTTP endpoint GET /api/devices
    const res = await request(app)
      .get('/api/devices')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.devices.length).toBe(4);
  });

  test('hard TTL habis: jika data telah melampaui batas hard TTL 24 jam dan upstream gagal, data usang tidak dipakai', async () => {
    // Reset state agar tidak ada cache dan tidak ada data lama yang valid dalam hard TTL
    _resetForTests();
    cache.del('devices:merged');

    // Seluruh upstream gagal
    traccar.getDevices.mockRejectedValue(new Error('Traccar offline'));
    mspf.getDevices.mockRejectedValue(new Error('MSPF offline'));
    foxlogger.getDevices.mockRejectedValue(new Error('FoxLogger offline'));

    const res = await request(app)
      .get('/api/devices')
      .set('Authorization', `Bearer ${adminToken}`);

    // Karena hard TTL habis (tidak ada data lama dalam batas 24 jam) dan upstream gagal,
    // gateway mengembalikan list kosong (bukan data purba di luar hard TTL)
    expect(res.status).toBe(200);
    expect(res.body.devices.length).toBe(0);
    expect(res.body.total).toBe(0);
  });

  test('hard TTL habis lalu upstream berhasil: cache diisi data segar dengan hard TTL 24 jam', async () => {
    _resetForTests();
    cache.del('devices:merged');

    traccar.getDevices.mockResolvedValue([
      { id: 401, name: 'Vehicle Fresh 1', uniqueId: 'v401', groupId: 1, attributes: {} },
    ]);
    mspf.getDevices.mockResolvedValue({ data: [] });
    foxlogger.getDevices.mockResolvedValue({ data: [] });

    const res = await request(app)
      .get('/api/devices')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.devices.length).toBe(1);
    expect(res.body.devices[0].id).toBe(401);

    // Verifikasi tersimpan di cache
    const inCache = cache.get('devices:merged');
    expect(inCache).toHaveLength(1);
    expect(inCache[0].id).toBe(401);
  });

  test('rebuild gagal lalu berhasil kembali: menyajikan stale data saat gagal, lalu update saat upstream pulih', async () => {
    // 1. Inisialisasi data awal di cache
    const initialDevices = [
      { id: 501, name: 'Vehicle Init 1', uniqueId: 'v501', source: 'traccar', group: 'traccar_1', attributes: {} },
    ];
    cache.set('devices:merged', initialDevices, 120);

    // 2. Upstream gagal saat rebuild pertama
    traccar.getDevices.mockRejectedValue(new Error('Temporary upstream glitch'));
    mspf.getDevices.mockRejectedValue(new Error('Temporary upstream glitch'));
    foxlogger.getDevices.mockRejectedValue(new Error('Temporary upstream glitch'));

    // Rebuild gagal -> harus mempertahankan stale data
    const failRebuildResult = await triggerRebuild();
    expect(failRebuildResult.length).toBe(1);
    expect(failRebuildResult[0].id).toBe(501);

    // Verifikasi endpoint menyajikan stale data
    const resFail = await request(app)
      .get('/api/devices')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resFail.status).toBe(200);
    expect(resFail.body.devices.length).toBe(1);
    expect(resFail.body.devices[0].id).toBe(501);

    // 3. Upstream pulih dan berhasil pada rebuild berikutnya
    traccar.getDevices.mockResolvedValue([
      { id: 501, name: 'Vehicle Init 1', uniqueId: 'v501', groupId: 1, attributes: {} },
      { id: 502, name: 'Vehicle Recovered 2', uniqueId: 'v502', groupId: 1, attributes: {} },
    ]);
    mspf.getDevices.mockResolvedValue({ data: [] });
    foxlogger.getDevices.mockResolvedValue({ data: [] });

    const successRebuildResult = await triggerRebuild();
    expect(successRebuildResult.length).toBe(2);
    expect(successRebuildResult.map((d) => d.id).sort()).toEqual([501, 502]);

    // Verifikasi endpoint menyajikan data baru yang telah diperbarui
    const resSuccess = await request(app)
      .get('/api/devices')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resSuccess.status).toBe(200);
    expect(resSuccess.body.devices.length).toBe(2);
  });
});
