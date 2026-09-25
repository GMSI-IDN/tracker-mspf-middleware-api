'use strict';

jest.mock('../services/traccar', () => ({
  getPositions: jest.fn(),
  getDevices: jest.fn(),
}));

jest.mock('../services/mspf', () => ({
  getPositions: jest.fn(),
  getDevices: jest.fn(),
  getBcList: jest.fn(),
  waitForInit: jest.fn(() => Promise.resolve()),
}));

jest.mock('../services/foxlogger', () => ({
  getPositions: jest.fn(),
  getDevices: jest.fn(),
  waitForInit: jest.fn(() => Promise.resolve()),
}));

const cache = require('../services/cache');
const traccar = require('../services/traccar');
const mspf = require('../services/mspf');
const foxlogger = require('../services/foxlogger');
const { syncPositions, setEmitHooks, getActiveSyncCount } = require('../services/positionSync');
const { logger } = require('../middleware/logger');

describe('positionSync — Metrics, Duration & Concurrency', () => {
  let infoSpy;
  let warnSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    cache.del('devices:merged');
    cache.del('positions:merged');
    setEmitHooks({ onPosition: jest.fn(), onStatus: jest.fn() });
    infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });

  test('logs duration on normal success path', async () => {
    cache.set('devices:merged', [
      { id: 1, source: 'traccar', group: 'traccar_1' },
      { id: 2, source: 'mspf', group: 'mspf_100' },
    ], 120);

    traccar.getPositions.mockResolvedValue([]);
    mspf.getPositions.mockResolvedValue([]);
    foxlogger.getPositions.mockResolvedValue([]);

    await syncPositions();

    expect(getActiveSyncCount()).toBe(0);
    const startLog = infoSpy.mock.calls.find(c => c[0].includes('[PositionSync] start (concurrent: 1)'));
    const completedLog = infoSpy.mock.calls.find(c => c[0].includes('[PositionSync] completed in'));
    expect(startLog).toBeDefined();
    expect(completedLog).toBeDefined();
    expect(completedLog[0]).toMatch(/\[PositionSync\] completed in \d+ms \(concurrent: 0\)/);
  });

  test('logs duration on early return path when no BC IDs found', async () => {
    // Empty devices cache and empty API fallback
    cache.set('devices:merged', [], 120);
    mspf.getBcList.mockResolvedValue({ data: [] });

    await syncPositions();

    expect(getActiveSyncCount()).toBe(0);
    const completedLog = infoSpy.mock.calls.find(c => c[0].includes('[PositionSync] completed in'));
    expect(completedLog).toBeDefined();
    expect(completedLog[0]).toMatch(/\[PositionSync\] completed in \d+ms \(concurrent: 0\)/);
  });

  test('logs duration on error path and rethrows', async () => {
    cache.set('devices:merged', [
      { id: 2, source: 'mspf', group: 'mspf_100' },
    ], 120);

    // Force an unexpected error in traccar.getPositions
    traccar.getPositions.mockImplementation(() => {
      throw new Error('Fatal network explosion');
    });

    await expect(syncPositions()).rejects.toThrow('Fatal network explosion');
    expect(getActiveSyncCount()).toBe(0);
    const completedLog = infoSpy.mock.calls.find(c => c[0].includes('[PositionSync] completed in'));
    expect(completedLog).toBeDefined();
    expect(completedLog[0]).toMatch(/\[PositionSync\] completed in \d+ms \(concurrent: 0\)/);
  });

  test('concurrency counter is 2 and logs WARN when two cycles run concurrently', async () => {
    cache.set('devices:merged', [
      { id: 1, source: 'traccar', group: 'traccar_1' },
      { id: 2, source: 'mspf', group: 'mspf_100' },
    ], 120);

    let resolveFirst;
    const slowPromise = new Promise(resolve => {
      resolveFirst = resolve;
    });

    traccar.getPositions.mockImplementation(() => slowPromise.then(() => []));
    mspf.getPositions.mockResolvedValue([]);
    foxlogger.getPositions.mockResolvedValue([]);

    // Start first sync (will wait on slowPromise)
    const p1 = syncPositions();

    // Start second sync immediately while first is running
    const p2 = syncPositions();

    // Now check concurrency counter
    expect(getActiveSyncCount()).toBe(2);

    // Verify WARN was logged for concurrent execution
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[PositionSync] concurrent execution detected: 2 runs in progress')
    );

    // Resolve slow promise to finish both
    resolveFirst();
    await Promise.all([p1, p2]);

    expect(getActiveSyncCount()).toBe(0);
  });
});
