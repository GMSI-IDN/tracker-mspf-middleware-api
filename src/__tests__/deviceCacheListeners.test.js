'use strict';

jest.mock('../services/traccar', () => ({
  getDevices: jest.fn(() => Promise.resolve([])),
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

const cache = require('../services/cache');
const traccar = require('../services/traccar');
const mspf = require('../services/mspf');
const foxlogger = require('../services/foxlogger');
const {
  getOrBuildDeviceCache,
  setDevices,
  invalidate,
  stop,
  _resetForTests,
} = require('../services/deviceCache');

jest.setTimeout(10000);

describe('P2-T3d: removal of set/del/expired listeners & explicit cache control', () => {
  let savedDevicesMerged;
  const origPerfNow = performance.now;
  const origDateNow = Date.now;

  beforeAll(() => {
    savedDevicesMerged = cache.get('devices:merged');
  });

  afterAll(() => {
    stop();
    performance.now = origPerfNow;
    Date.now = origDateNow;
    if (savedDevicesMerged !== undefined) {
      setDevices(savedDevicesMerged);
    } else {
      cache.del('devices:merged');
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    _resetForTests();
    cache.del('devices:merged');
    performance.now = origPerfNow;
    Date.now = origDateNow;

    mspf.waitForInit.mockResolvedValue();
    foxlogger.waitForInit.mockResolvedValue();
    traccar.getDevices.mockResolvedValue([]);
    mspf.getDevices.mockResolvedValue({ data: [] });
    foxlogger.getDevices.mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    performance.now = origPerfNow;
    Date.now = origDateNow;
  });

  test('(i) pembaca pertama saat soft-expired TIDAK menerima undefined pada cache.get maupun getOrBuildDeviceCache, dan tepat 1 rebuild latar belakang terpicu', async () => {
    const initialDevices = [
      { id: 101, name: 'Vehicle 101', uniqueId: 'v101', source: 'traccar', group: 'traccar_1', attributes: {} },
    ];
    setDevices(initialDevices);

    // Mock upstream dengan sedikit jeda asinkron agar proses rebuild berjalan di latar belakang
    traccar.getDevices.mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve([
        { id: 101, name: 'Vehicle 101 Updated', uniqueId: 'v101', groupId: 1, attributes: {} },
      ]), 20);
    }));

    // Simulasikan waktu maju 150 detik (lewat freshUntil 120 detik, masih dalam hard TTL 24 jam)
    const advanceMs = 150 * 1000;
    performance.now = () => origPerfNow.call(performance) + advanceMs;
    Date.now = () => origDateNow.call(Date) + advanceMs;

    // Pembaca pertama memeriksa cache.get
    const fromDirectCache = cache.get('devices:merged');
    expect(fromDirectCache).toBeDefined();
    expect(fromDirectCache).toHaveLength(1);
    expect(fromDirectCache[0].id).toBe(101);

    // Pembaca pertama memanggil getOrBuildDeviceCache
    const fromGetOrBuild = await getOrBuildDeviceCache();
    expect(fromGetOrBuild).toBeDefined();
    expect(fromGetOrBuild).toHaveLength(1);
    expect(fromGetOrBuild[0].id).toBe(101);

    // Beri waktu sejenak agar background revalidation menyelesaikan promise
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Tepat 1 rebuild latar belakang harus terpicu ke upstream
    expect(traccar.getDevices).toHaveBeenCalledTimes(1);
  });

  test('(ii) setelah invalidate(), cache.get tetap undefined dan getOrBuildDeviceCache berikutnya menunggu rebuild (bukan snapshot lama)', async () => {
    const oldDevices = [
      { id: 201, name: 'Old Unit 201', uniqueId: 'v201', source: 'traccar', group: 'traccar_1', attributes: {} },
    ];
    setDevices(oldDevices);

    expect(cache.get('devices:merged')).toHaveLength(1);

    // Panggil invalidate()
    invalidate();

    // Cache harus tetap undefined (tidak dihidupkan kembali secara ajaib)
    expect(cache.get('devices:merged')).toBeUndefined();

    // Mock upstream mengembalikan armada baru yang berbeda
    traccar.getDevices.mockResolvedValue([
      { id: 202, name: 'New Unit 202', uniqueId: 'v202', groupId: 1, attributes: {} },
    ]);

    // getOrBuildDeviceCache berikutnya harus menunggu rebuild dan mengembalikan data baru (bukan data lama 201)
    const fresh = await getOrBuildDeviceCache();
    expect(fresh).toHaveLength(1);
    expect(fresh[0].id).toBe(202);
    expect(cache.get('devices:merged')[0].id).toBe(202);
  });

  test('(iii) tidak ada listener terdaftar oleh modul pada node-cache (cache.on set/del/expired dihapus)', () => {
    // Pada kode yang benar (setelah listener dihapus), jumlah listener harus 0.
    // Pada kode lama, ini GAGAL karena cache.on('set'), cache.on('del'), dan cache.on('expired') terdaftar.
    expect(cache.listenerCount('set')).toBe(0);
    expect(cache.listenerCount('del')).toBe(0);
    expect(cache.listenerCount('expired')).toBe(0);
  });

  test('(iv) saat entri terhapus pada hard TTL: menerima hasil rebuild bila upstream sukses, dan hasil kosong TIDAK disimpan ke cache bila upstream gagal', async () => {
    // Skenario A: Upstream sukses saat hard TTL habis
    cache.del('devices:merged');
    traccar.getDevices.mockResolvedValue([
      { id: 301, name: 'Rebuilt Unit 301', uniqueId: 'v301', groupId: 1, attributes: {} },
    ]);

    const resSuccess = await getOrBuildDeviceCache();
    expect(resSuccess).toHaveLength(1);
    expect(resSuccess[0].id).toBe(301);
    expect(cache.get('devices:merged')).toHaveLength(1);

    // Skenario B: Tidak ada data sama sekali dan upstream gagal
    cache.del('devices:merged');
    _resetForTests();
    traccar.getDevices.mockRejectedValue(new Error('Traccar offline'));
    mspf.getDevices.mockRejectedValue(new Error('MSPF offline'));
    foxlogger.getDevices.mockRejectedValue(new Error('FoxLogger offline'));

    const resFail = await getOrBuildDeviceCache();
    expect(resFail).toEqual([]);
    // Hasil kosong TIDAK disimpan ke cache
    expect(cache.get('devices:merged')).toBeUndefined();
  });
});
