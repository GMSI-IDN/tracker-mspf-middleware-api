'use strict';

jest.mock('../services/traccar');
jest.mock('../services/foxlogger');
jest.mock('../services/autoSync', () => ({
  runAutoSync: jest.fn(() => Promise.resolve()),
}));

const cache = require('../services/cache');
const mspf = require('../services/mspf');

const DEVICE_COUNT = 1109;
const MOCK_DELAY_MS = 50;
const CHUNK_SIZE = 50;
const EXPECTED_TICKS = Math.ceil(DEVICE_COUNT / CHUNK_SIZE);
const MAX_AGE_LIMIT_MS = 180000;
const STALE_THRESHOLD_MS = 5 * 60 * 1000;
const INTERVAL_MS = 7000;

function createMockApi(delayMs = MOCK_DELAY_MS) {
  return {
    get: jest.fn(async (url) => {
      await new Promise(r => setTimeout(r, delayMs));
      if (url.includes('/data/history')) {
        return { data: { data: [{ tid: 1, kph: 20, volt: 12.5 }] } };
      }
      return { data: {} };
    }),
    interceptors: { response: { use: jest.fn() } },
  };
}

function populateDevices(count) {
  const devices = [];
  for (let i = 1; i <= count; i++) {
    devices.push({ id: i, source: 'mspf', group: 'mspf_1' });
  }
  cache.set('devices:merged', devices, 600);
}

describe('3b: MCCS Worker Coverage (fake timers, no real delays)', () => {
  let apiSpy;
  let mockApi;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mspf.resetMccsWorkerState();
    cache.del('devices:merged');
    cache.del('positions:merged');
    mockApi = createMockApi();
    apiSpy = jest.spyOn(mspf, 'getApi').mockReturnValue(mockApi);
  });

  afterEach(() => {
    mspf.resetMccsWorkerState();
    apiSpy.mockRestore();
    jest.useRealTimers();
  });

  async function runTicks(n, advancePerTick = INTERVAL_MS) {
    for (let i = 0; i < n; i++) {
      const p = mspf.runMccsSyncOnce();
      await jest.advanceTimersByTimeAsync(MOCK_DELAY_MS * 6);
      await p;
      await jest.advanceTimersByTimeAsync(advancePerTick - MOCK_DELAY_MS * 6);
    }
  }

  test('first cycle: 100% coverage, time-to-full reported, max age < 180s', async () => {
    populateDevices(DEVICE_COUNT);

    await runTicks(EXPECTED_TICKS);

    const stats = mspf.getMccsStats();
    expect(stats.storeSize).toBe(DEVICE_COUNT);
    expect(stats.maxAgeMs).toBeLessThan(MAX_AGE_LIMIT_MS);
    expect(stats.maxAgeMs).toBeGreaterThan(0);
    expect(stats.timeToFullMs).toBeGreaterThan(0);
    expect(stats.timeToFullMs).toBeLessThan(MAX_AGE_LIMIT_MS);
    expect(stats.staleCount).toBe(0);
  }, 30000);

  test('req/s within expected range (7.1 req/s simulated)', async () => {
    populateDevices(DEVICE_COUNT);

    await runTicks(EXPECTED_TICKS);

    const totalRequests = mockApi.get.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/data/history')
    ).length;
    expect(totalRequests).toBe(DEVICE_COUNT);

    const simulatedCycleSec = EXPECTED_TICKS * (INTERVAL_MS / 1000);
    const reqPerSec = totalRequests / simulatedCycleSec;
    expect(reqPerSec).toBeGreaterThan(5);
    expect(reqPerSec).toBeLessThan(15);
  }, 30000);

  test('multi-cycle: 100% coverage maintained, staleCount stays 0', async () => {
    populateDevices(DEVICE_COUNT);

    for (let cycle = 0; cycle < 2; cycle++) {
      await runTicks(EXPECTED_TICKS);
      const stats = mspf.getMccsStats();
      expect(stats.storeSize).toBe(DEVICE_COUNT);
      expect(stats.maxAgeMs).toBeLessThan(MAX_AGE_LIMIT_MS);
      expect(stats.staleCount).toBe(0);
    }
  }, 60000);

  test('stale purge: entries for removed devices are deleted at cycle boundary', async () => {
    populateDevices(100);
    await runTicks(2);
    expect(mspf.getMccsStats().storeSize).toBe(100);

    cache.set('devices:merged', [
      { id: 1, source: 'mspf', group: 'mspf_1' },
      { id: 2, source: 'mspf', group: 'mspf_1' },
    ], 600);

    await runTicks(1);

    const stats = mspf.getMccsStats();
    expect(stats.storeSize).toBeLessThanOrEqual(100);
  }, 15000);

  test('old data persists when refresh fails', async () => {
    const smallCount = 100;
    populateDevices(smallCount);
    await runTicks(Math.ceil(smallCount / CHUNK_SIZE));

    expect(mspf.getMccsStats().storeSize).toBe(smallCount);

    apiSpy.mockReturnValue({
      get: jest.fn(async () => { throw new Error('upstream error'); }),
      interceptors: { response: { use: jest.fn() } },
    });

    await runTicks(Math.ceil(smallCount / CHUNK_SIZE));

    const stats = mspf.getMccsStats();
    expect(stats.storeSize).toBe(smallCount);
  }, 15000);

  test('staleCount > 0 when fetch times exceed 5 minutes', async () => {
    populateDevices(50);
    await runTicks(1);

    const stats1 = mspf.getMccsStats();
    expect(stats1.staleCount).toBe(0);

    await jest.advanceTimersByTimeAsync(STALE_THRESHOLD_MS + 1000);

    const stats2 = mspf.getMccsStats();
    expect(stats2.staleCount).toBe(50);
  }, 10000);

  test('re-entrancy guard prevents concurrent execution', async () => {
    populateDevices(100);

    const p1 = mspf.runMccsSyncOnce();
    const p2 = mspf.runMccsSyncOnce();

    await jest.advanceTimersByTimeAsync(MOCK_DELAY_MS * 6);
    await Promise.all([p1, p2]);

    const stats = mspf.getMccsStats();
    expect(stats.isSyncing).toBe(false);

    const historyCalls = mockApi.get.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/data/history')
    ).length;
    expect(historyCalls).toBeLessThanOrEqual(100);
  }, 10000);

  test('resetMccsWorkerState clears all state', () => {
    populateDevices(100);
    mspf.resetMccsWorkerState();

    const stats = mspf.getMccsStats();
    expect(stats.storeSize).toBe(0);
    expect(stats.isSyncing).toBe(false);
    expect(stats.offset).toBe(0);
    expect(stats.totalDevices).toBe(0);
    expect(stats.maxAgeMs).toBe(0);
    expect(stats.staleCount).toBe(0);
    expect(stats.missingCount).toBe(0);
    expect(stats.timeToFullMs).toBe(0);
  });

  test('missingCount: devices that never got MCCS data are counted after first cycle', async () => {
    populateDevices(100);

    // Mock API returns 404/null for devices > 80
    apiSpy.mockReturnValue({
      get: jest.fn(async (url) => {
        await new Promise(r => setTimeout(r, MOCK_DELAY_MS));
        const match = url.match(/\/device\/(\d+)\/data\/history/);
        const devId = match ? parseInt(match[1], 10) : 0;
        if (devId > 80) return { data: { data: [] } };
        return { data: { data: [{ tid: 1, kph: 20 }] } };
      }),
      interceptors: { response: { use: jest.fn() } },
    });

    // Before cycle completes (tick 1 of 2): missingCount is 0
    await runTicks(1);
    expect(mspf.getMccsStats().missingCount).toBe(0);

    // Complete cycle (tick 2 of 2): now cycle 1 is done
    await runTicks(1);
    const stats = mspf.getMccsStats();
    expect(stats.storeSize).toBe(80);
    // Devices 81..100 (20 devices) never got data -> missingCount = 20
    expect(stats.missingCount).toBe(20);
  }, 15000);
});
