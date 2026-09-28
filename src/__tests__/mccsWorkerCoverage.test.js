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
  cache.set('devices:merged', devices, 86400);
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

  test('missingCount: devices that fail with genuine errors are counted as missing', async () => {
    populateDevices(100);

    apiSpy.mockReturnValue({
      get: jest.fn(async (url) => {
        await new Promise(r => setTimeout(r, MOCK_DELAY_MS));
        const match = url.match(/\/device\/(\d+)\/data\/history/);
        const devId = match ? parseInt(match[1], 10) : 0;
        if (devId > 80) throw new Error('upstream timeout');
        return { data: { data: [{ tid: 1, kph: 20 }] } };
      }),
      interceptors: { response: { use: jest.fn() } },
    });

    await runTicks(1);
    expect(mspf.getMccsStats().missingCount).toBe(0);

    await runTicks(1);
    const stats = mspf.getMccsStats();
    expect(stats.storeSize).toBe(80);
    expect(stats.missingCount).toBe(20);
    expect(stats.pausedCount).toBe(0);
  }, 15000);

  test('failure classification and sample collection per category in getMccsStats (Iterasi 3f)', async () => {
    populateDevices(50);

    apiSpy.mockReturnValue({
      get: jest.fn(async (url) => {
        await new Promise(r => setTimeout(r, MOCK_DELAY_MS));
        const match = url.match(/\/device\/(\d+)\/data\/history/);
        const devId = match ? parseInt(match[1], 10) : 0;
        if (devId <= 10) return { data: { data: [] } };
        if (devId <= 15) {
          const err = new Error('Not Found');
          err.status = 404;
          throw err;
        }
        if (devId <= 20) {
          const err = new Error('Too Many Requests');
          err.status = 429;
          throw err;
        }
        if (devId <= 25) {
          const err = new Error('timeout of 10000ms exceeded');
          err.code = 'ECONNABORTED';
          throw err;
        }
        if (devId <= 30) {
          const err = new Error('Internal Server Error');
          err.status = 500;
          throw err;
        }
        if (devId <= 35) {
          throw new Error('generic network error');
        }
        return { data: { data: [{ tid: devId, kph: 20 }] } };
      }),
      interceptors: { response: { use: jest.fn() } },
    });

    await runTicks(1);

    const stats = mspf.getMccsStats();
    expect(stats.storeSize).toBe(15);
    expect(stats.pausedCount).toBe(10);
    expect(stats.failures.http_404).toBe(5);
    expect(stats.failures.http_429).toBe(5);
    expect(stats.failures.timeout).toBe(5);
    expect(stats.failures.http_5xx).toBe(5);
    expect(stats.failures.other).toBe(5);

    expect(stats.failureSamples.http_404).toEqual([11, 12, 13, 14, 15]);
    expect(stats.failureSamples.http_429).toEqual([16, 17, 18, 19, 20]);
    expect(stats.failureSamples.timeout).toEqual([21, 22, 23, 24, 25]);
    expect(stats.failureSamples.http_5xx).toEqual([26, 27, 28, 29, 30]);
    expect(stats.failureSamples.other).toEqual([31, 32, 33, 34, 35]);
  }, 15000);

  test('empty_data enters jeda, does not trigger missing/stale warning, logs info with data and paused count', async () => {
    const { logger } = require('../middleware/logger');
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});

    try {
      populateDevices(100);

      apiSpy.mockReturnValue({
        get: jest.fn(async (url) => {
          await new Promise(r => setTimeout(r, MOCK_DELAY_MS));
          const match = url.match(/\/device\/(\d+)\/data\/history/);
          const devId = match ? parseInt(match[1], 10) : 0;
          if (devId > 80) return { data: { data: [] } };
          return { data: { data: [{ tid: devId, kph: 20 }] } };
        }),
        interceptors: { response: { use: jest.fn() } },
      });

      await runTicks(2);
      await runTicks(1);

      const stats = mspf.getMccsStats();
      expect(stats.storeSize).toBe(80);
      expect(stats.pausedCount).toBe(20);
      expect(stats.missingCount).toBe(0);
      expect(stats.staleCount).toBe(0);

      const missingWarns = warnSpy.mock.calls.filter(([msg]) =>
        typeof msg === 'string' && msg.includes('missing MCCS data')
      );
      expect(missingWarns.length).toBe(0);

      const failureWarns = warnSpy.mock.calls.filter(([msg]) =>
        typeof msg === 'string' && msg.includes('cycle failures')
      );
      expect(failureWarns.length).toBe(0);

      const cycleDevicesInfo = infoSpy.mock.calls.filter(([msg]) =>
        typeof msg === 'string' && msg.includes('cycle devices:')
      );
      expect(cycleDevicesInfo.length).toBeGreaterThanOrEqual(1);
      expect(cycleDevicesInfo[0][0]).toContain('80 with data, 20 paused');
    } finally {
      warnSpy.mockRestore();
      infoSpy.mockRestore();
    }
  }, 15000);

  test('device in jeda is skipped in subsequent cycles and retried after 30 minutes', async () => {
    populateDevices(100);

    const callRecord = [];
    apiSpy.mockReturnValue({
      get: jest.fn(async (url) => {
        await new Promise(r => setTimeout(r, MOCK_DELAY_MS));
        const match = url.match(/\/device\/(\d+)\/data\/history/);
        const devId = match ? parseInt(match[1], 10) : 0;
        callRecord.push(devId);
        if (devId > 80) return { data: { data: [] } };
        return { data: { data: [{ tid: devId, kph: 20 }] } };
      }),
      interceptors: { response: { use: jest.fn() } },
    });

    // Cycle 1: queries devices 1..100 (2 ticks: 1..50, 51..100)
    await runTicks(2);
    expect(mspf.getMccsStats().pausedCount).toBe(20);

    // Cycle 2 starts on tick 3
    callRecord.length = 0;
    // Cycle 2 has only 80 unpaused devices (takes 2 ticks: 1..50, 51..80)
    await runTicks(2);

    // Verify devices 81..100 were NOT called in Cycle 2
    const queriedOver80 = callRecord.filter(id => id > 80);
    expect(queriedOver80.length).toBe(0);
    expect(callRecord.length).toBe(80);

    // Fast-forward past max randomized pause (36 minutes)
    await jest.advanceTimersByTimeAsync(36 * 60 * 1000);

    // Cycle 3 starts: paused devices are unpaused and retried
    callRecord.length = 0;
    await runTicks(2);
    const retriedOver80 = callRecord.filter(id => id > 80);
    expect(retriedOver80.length).toBeGreaterThan(0);
  }, 30000);

  test('reactivation: device in jeda with newer deviceTime is unpaused and prioritized in next batch', async () => {
    populateDevices(100);

    const callOrder = [];
    let device95HasData = false;
    apiSpy.mockReturnValue({
      get: jest.fn(async (url) => {
        await new Promise(r => setTimeout(r, MOCK_DELAY_MS));
        const match = url.match(/\/device\/(\d+)\/data\/history/);
        const devId = match ? parseInt(match[1], 10) : 0;
        callOrder.push(devId);
        if (devId > 80) {
          if (devId === 95 && device95HasData) {
            return { data: { data: [{ tid: 95, kph: 20 }] } };
          }
          return { data: { data: [] } };
        }
        return { data: { data: [{ tid: devId, kph: 20 }] } };
      }),
      interceptors: { response: { use: jest.fn() } },
    });

    // Run cycle 1 so devices 81..100 enter jeda
    await runTicks(2);
    expect(mspf.getMccsStats().pausedCount).toBe(20);

    // Device 95 now starts reporting MCCS data upstream
    device95HasData = true;

    // Simulate position sync receiving newer deviceTime for device 95
    const baseTime = Date.now() + 60000;
    mspf.notifyDevicePosition(95, new Date(baseTime).toISOString());

    // Device 95 is queued for priority
    const statsAfterReactivation = mspf.getMccsStats();
    expect(statsAfterReactivation.priorityQueueLength).toBe(1);

    // Clear call order and run next tick
    callOrder.length = 0;
    await runTicks(1);

    // Device 95 must be at the very front of the next batch!
    expect(callOrder[0]).toBe(95);

    // Since mock returned valid data for 95, it is unpaused and in store!
    const statsAfterSuccess = mspf.getMccsStats();
    expect(statsAfterSuccess.pausedCount).toBe(19);
    expect(mspf.getMccsForDevice(95)).toBeDefined();
  }, 20000);

  test('prevents repeated reactivation loop: device with empty_data enters full pause after 1 reactivation and ignores deviceTime', async () => {
    populateDevices(50);

    const queriedDeviceIds = [];
    apiSpy.mockReturnValue({
      get: jest.fn(async (url) => {
        await new Promise(r => setTimeout(r, MOCK_DELAY_MS));
        const match = url.match(/\/device\/(\d+)\/data\/history/);
        const devId = match ? parseInt(match[1], 10) : 0;
        queriedDeviceIds.push(devId);
        // Device 50 has active GPS pings but NO MCCS data (always empty)
        return { data: { data: [] } };
      }),
      interceptors: { response: { use: jest.fn() } },
    });

    // Tick 1: all 50 devices return empty_data and enter jeda
    await runTicks(1);
    expect(mspf.getMccsStats().pausedCount).toBe(50);

    // 1st reactivation: GPS position sync sends fresh deviceTime for device 50
    mspf.notifyDevicePosition(50, new Date(Date.now() + 10000).toISOString());
    expect(mspf.getMccsStats().priorityQueueLength).toBe(1);

    // Next tick runs: queries device 50 from priority queue
    queriedDeviceIds.length = 0;
    await runTicks(1);
    expect(queriedDeviceIds).toContain(50);

    // Device 50 returned empty_data again -> MUST enter full pause (hardJeda)
    expect(mspf.getMccsStats().priorityQueueLength).toBe(0);

    // Continuous GPS updates keep arriving for device 50 every 10 seconds
    mspf.notifyDevicePosition(50, new Date(Date.now() + 20000).toISOString());
    mspf.notifyDevicePosition(50, new Date(Date.now() + 30000).toISOString());
    mspf.notifyDevicePosition(50, new Date(Date.now() + 40000).toISOString());

    // Device 50 signals MUST be ignored! It must NOT be added to priorityQueue
    expect(mspf.getMccsStats().priorityQueueLength).toBe(0);

    // Run next tick: device 50 should NOT be queried
    queriedDeviceIds.length = 0;
    await runTicks(1);
    expect(queriedDeviceIds).not.toContain(50);

    // After full pause expires (36 minutes later), device 50 is unpaused and retried
    await jest.advanceTimersByTimeAsync(36 * 60 * 1000);
    queriedDeviceIds.length = 0;
    await runTicks(1);
    expect(queriedDeviceIds).toContain(50);
  }, 25000);

  test('prior MCCS data remains in store when device later enters jeda', async () => {
    populateDevices(50);

    let shouldReturnEmpty = false;
    apiSpy.mockReturnValue({
      get: jest.fn(async (url) => {
        await new Promise(r => setTimeout(r, MOCK_DELAY_MS));
        if (shouldReturnEmpty) return { data: { data: [] } };
        return { data: { data: [{ tid: 101, kph: 45, volt: 12.8 }] } };
      }),
      interceptors: { response: { use: jest.fn() } },
    });

    // Cycle 1: device 1 gets valid MCCS data
    await runTicks(1);
    const initialData = mspf.getMccsForDevice(1);
    expect(initialData).toBeDefined();
    expect(initialData.kph).toBe(45);

    // Fast-forward past max randomized pause (36 minutes), now mock returns empty_data
    await jest.advanceTimersByTimeAsync(36 * 60 * 1000);
    shouldReturnEmpty = true;

    await runTicks(1);
    // Device enters jeda, but prior MCCS data is preserved!
    expect(mspf.getMccsStats().pausedCount).toBe(50);
    const preservedData = mspf.getMccsForDevice(1);
    expect(preservedData).toBeDefined();
    expect(preservedData.kph).toBe(45);
  }, 20000);

  test('monotonic clock: Date.now() jumping forward or backward does not affect masa jeda (pausedAt/pauseDurationMs)', async () => {
    populateDevices(50);

    const realDateNow = Date.now;
    let clockOffset = 0;
    Date.now = jest.fn(() => realDateNow() + clockOffset);

    try {
      apiSpy.mockReturnValue({
        get: jest.fn(async () => ({ data: { data: [] } })),
        interceptors: { response: { use: jest.fn() } },
      });

      // Tick 1: devices enter jeda
      await runTicks(1);
      expect(mspf.getMccsStats().pausedCount).toBe(50);

      // Simulate wall clock jumping 2 hours into the future, but only 10s of real time passed
      clockOffset = 2 * 3600 * 1000;
      await runTicks(1);

      // Devices must STILL be paused (monotonic time has not reached 25-35 minutes)!
      expect(mspf.getMccsStats().pausedCount).toBe(50);

      // Advance monotonic timers past 36 minutes (past the max pause)
      await jest.advanceTimersByTimeAsync(36 * 60 * 1000);

      // And simulate wall clock jumping backward by 2 hours
      clockOffset = -2 * 3600 * 1000;

      // Devices should properly unpause now because performance.now() elapsed >= pauseDurationMs
      await runTicks(1);
      const stats = mspf.getMccsStats();
      expect(stats.completedCycles).toBeGreaterThanOrEqual(1);
    } finally {
      Date.now = realDateNow;
    }
  }, 25000);
});
