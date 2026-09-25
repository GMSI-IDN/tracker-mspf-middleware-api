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
    const completedLog = infoSpy.mock.calls.find(c => c[0].includes('[PositionSync] completed in'));
    expect(completedLog).toBeDefined();
    expect(completedLog[0]).toMatch(/\[PositionSync\] completed in \d+ms/);
  });

  test('logs duration on early return path when no BC IDs found', async () => {
    cache.set('devices:merged', [], 120);
    mspf.getBcList.mockResolvedValue({ data: [] });

    await syncPositions();

    expect(getActiveSyncCount()).toBe(0);
    const completedLog = infoSpy.mock.calls.find(c => c[0].includes('[PositionSync] completed in'));
    expect(completedLog).toBeDefined();
    expect(completedLog[0]).toMatch(/\[PositionSync\] completed in \d+ms/);
  });

  test('handles upstream error gracefully via Promise.allSettled', async () => {
    cache.set('devices:merged', [
      { id: 2, source: 'mspf', group: 'mspf_100' },
    ], 120);

    traccar.getPositions.mockRejectedValue(new Error('Fatal network explosion'));
    mspf.getPositions.mockResolvedValue([]);
    foxlogger.getPositions.mockResolvedValue([]);

    await syncPositions();
    expect(getActiveSyncCount()).toBe(0);
    const completedLog = infoSpy.mock.calls.find(c => c[0].includes('[PositionSync] completed in'));
    expect(completedLog).toBeDefined();
    expect(completedLog[0]).toMatch(/\[PositionSync\] completed in \d+ms/);
  });

  test('guards against overlapping runs and logs WARN when previous cycle is still in progress', async () => {
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

    const p1 = syncPositions();
    const p2 = syncPositions();

    expect(getActiveSyncCount()).toBe(1);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[PositionSync] previous run still in progress')
    );

    resolveFirst();
    await Promise.all([p1, p2]);

    expect(getActiveSyncCount()).toBe(0);
  });
});
