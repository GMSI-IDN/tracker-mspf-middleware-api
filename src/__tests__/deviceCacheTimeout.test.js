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
  stop,
  _resetForTests,
} = require('../services/deviceCache');

jest.setTimeout(10000);

describe('P2-T3c2: upstream request timeout in deviceCache.doRebuild()', () => {
  let savedDevicesMerged;

  beforeAll(() => {
    savedDevicesMerged = cache.get('devices:merged');
  });

  afterAll(() => {
    stop();
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

    mspf.waitForInit.mockResolvedValue();
    foxlogger.waitForInit.mockResolvedValue();
    traccar.getDevices.mockResolvedValue([]);
    mspf.getDevices.mockResolvedValue({ data: [] });
    foxlogger.getDevices.mockResolvedValue({ data: [] });
  });

  test('saat rebuild dipicu, traccar.getDevices dipanggil dengan opsi { timeout: 10000 }', async () => {
    await getOrBuildDeviceCache();

    expect(traccar.getDevices).toHaveBeenCalledTimes(1);
    const traccarCalls = traccar.getDevices.mock.calls[0];
    // Parameter pertama adalah params ({ all: true }), parameter kedua adalah options ({ timeout: 10000 })
    expect(traccarCalls[1]).toEqual(expect.objectContaining({ timeout: 10000 }));
  });

  test('saat rebuild dipicu, mspf.getDevices dipanggil dengan opsi { timeout: 10000 }', async () => {
    await getOrBuildDeviceCache();

    expect(mspf.getDevices).toHaveBeenCalledTimes(1);
    const mspfCalls = mspf.getDevices.mock.calls[0];
    // Parameter pertama adalah params ({}), parameter kedua adalah options ({ timeout: 10000 })
    expect(mspfCalls[1]).toEqual(expect.objectContaining({ timeout: 10000 }));
  });

  test('saat rebuild dipicu, foxlogger.getDevices dipanggil dengan opsi { timeout: 10000 }', async () => {
    await getOrBuildDeviceCache();

    expect(foxlogger.getDevices).toHaveBeenCalledTimes(1);
    const foxCalls = foxlogger.getDevices.mock.calls[0];
    // Parameter pertama adalah params ({}), parameter kedua adalah options ({ timeout: 10000 })
    expect(foxCalls[1]).toEqual(expect.objectContaining({ timeout: 10000 }));
  });
});
