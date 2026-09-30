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
  setDevices,
  getDevices,
  invalidate,
  getOrBuildDeviceCache,
  _resetForTests,
} = require('../services/deviceCache');
const { updateMergedDeviceCache } = require('../utils/engineControl');

jest.setTimeout(10000);

describe('P2-T3a: deviceCache writers (setDevices & updateMergedDeviceCache)', () => {
  let savedDevicesMerged;

  beforeAll(() => {
    savedDevicesMerged = cache.get('devices:merged');
  });

  afterAll(() => {
    if (savedDevicesMerged !== undefined) {
      cache.set('devices:merged', savedDevicesMerged, 86400);
    } else {
      cache.del('devices:merged');
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    _resetForTests();
    cache.del('devices:merged');
  });

  test('skenario (i-a): sisa TTL ≈ 24 jam setelah penulisan lewat setDevices', () => {
    const devices = [
      { id: 101, name: 'Vehicle 101', source: 'traccar', attributes: {} },
    ];

    setDevices(devices);

    const ttlTimestamp = cache.getTtl('devices:merged');
    const remainingSeconds = Math.round((ttlTimestamp - Date.now()) / 1000);

    // Hard TTL 24 jam = 86400 detik. Di kode lama, tersimpan dengan TTL 120 detik.
    expect(remainingSeconds).toBeGreaterThan(23 * 3600);
  });

  test('skenario (i-b): sisa TTL ≈ 24 jam setelah penulisan lewat updateMergedDeviceCache (engineControl)', () => {
    const initialDevices = [
      { id: 201, name: 'Vehicle 201', source: 'traccar', attributes: { blocked: false } },
    ];
    cache.set('devices:merged', initialDevices, 86400);

    // Panggil updateMergedDeviceCache di engineControl
    updateMergedDeviceCache(201, 'traccar', { attributes: { blocked: true } });

    const ttlTimestamp = cache.getTtl('devices:merged');
    const remainingSeconds = Math.round((ttlTimestamp - Date.now()) / 1000);

    // Di kode lama, utils/engineControl.js:54 menulis dengan TTL 120 dtk.
    expect(remainingSeconds).toBeGreaterThan(23 * 3600);
    expect(cache.get('devices:merged')[0].attributes.blocked).toBe(true);
  });

  test('skenario (ii): setDevices([]) menolak array kosong dan tidak menimpa data lama', () => {
    const oldDevices = [
      { id: 301, name: 'Vehicle 301', source: 'traccar', attributes: {} },
      { id: 302, name: 'Vehicle 302', source: 'mspf', attributes: {} },
    ];
    cache.set('devices:merged', oldDevices, 86400);

    // Panggilan dengan array kosong tidak boleh menimpa data lama
    setDevices([]);

    const currentInCache = cache.get('devices:merged');
    expect(currentInCache).toHaveLength(oldDevices.length);
    expect(currentInCache[0].id).toBe(301);
  });

  test('skenario (iii): setDevices tidak memutasi array masukan', () => {
    const input = [
      { id: 401, name: 'Vehicle 401', source: 'traccar', attributes: { volt: 12 } },
    ];
    const originalInputName = input[0].name;

    setDevices(input);

    expect(input[0].name).toBe(originalInputName);
    expect(input).toHaveLength(1);
  });

  test('skenario (iv): getOrBuildDeviceCache di cache kosong menulis dengan TTL 24 jam', async () => {
    traccar.getDevices.mockResolvedValue([
      { id: 501, name: 'Vehicle 501', uniqueId: 'v501', groupId: 1, attributes: {} },
    ]);
    mspf.getDevices.mockResolvedValue({ data: [] });
    foxlogger.getDevices.mockResolvedValue({ data: [] });

    const built = await getOrBuildDeviceCache();

    expect(built).toHaveLength(1);
    const ttlTimestamp = cache.getTtl('devices:merged');
    const remainingSeconds = Math.round((ttlTimestamp - Date.now()) / 1000);

    expect(remainingSeconds).toBeGreaterThan(23 * 3600);
  });

  test('skenario (v): getDevices mengembalikan referensi data dan invalidate menghapus entri', () => {
    const devices = [
      { id: 601, name: 'Vehicle 601', source: 'traccar', attributes: {} },
    ];
    setDevices(devices);

    expect(getDevices()).toHaveLength(1);
    expect(getDevices()[0].id).toBe(601);

    invalidate();

    expect(getDevices()).toBeUndefined();
  });
});
