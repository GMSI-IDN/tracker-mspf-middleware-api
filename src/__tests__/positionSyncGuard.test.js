'use strict';

jest.mock('../services/traccar');
jest.mock('../services/mspf');
jest.mock('../services/foxlogger');
jest.mock('../services/autoSync', () => ({
  runAutoSync: jest.fn(() => Promise.resolve()),
}));

const traccar = require('../services/traccar');
const mspf = require('../services/mspf');
const foxlogger = require('../services/foxlogger');
const cache = require('../services/cache');
const positionSync = require('../services/positionSync');

describe('Pilar 1: PositionSync GuardedJob Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cache.del('devices:merged');
    cache.del('positions:merged');

    cache.set('devices:merged', [
      { id: 101, source: 'traccar', group: 'traccar_1' },
      { id: 1001, source: 'mspf', group: 'mspf_1' },
    ], 300);

    traccar.getPositions.mockResolvedValue([
      { deviceId: 101, source: 'traccar', speed: 10, latitude: -6.2, longitude: 106.8 },
    ]);
    mspf.getPositions.mockResolvedValue([
      { deviceId: 1001, source: 'mspf', speed: 20, latitude: -6.1, longitude: 106.9 },
    ]);
    foxlogger.getPositions.mockResolvedValue([]);
  });

  test('tick saat sync sedang berjalan dilewati (skipped)', async () => {
    let resolveFirstSync;
    mspf.getPositions.mockImplementationOnce(() => new Promise(r => { resolveFirstSync = r; }));

    const run1Promise = positionSync.syncPositions();
    await positionSync.syncPositions();

    expect(traccar.getPositions).toHaveBeenCalledTimes(1);

    resolveFirstSync([{ deviceId: 1001, source: 'mspf', speed: 20, latitude: -6.1, longitude: 106.9 }]);
    await run1Promise;

    await positionSync.syncPositions();
    expect(traccar.getPositions).toHaveBeenCalledTimes(2);
  });

  test('sync yang throw error tidak menyangkutkan guard', async () => {
    traccar.getPositions.mockRejectedValueOnce(new Error('Fatal upstream crash'));

    try { await positionSync.syncPositions(); } catch {}

    traccar.getPositions.mockResolvedValueOnce([
      { deviceId: 101, source: 'traccar', speed: 10, latitude: -6.2, longitude: 106.8 },
    ]);
    await positionSync.syncPositions();
    expect(traccar.getPositions).toHaveBeenCalledTimes(2);
  });

  test('watchdog membuka kunci setelah timeout 120s', async () => {
    jest.useFakeTimers();
    try {
      mspf.getPositions.mockImplementationOnce(() => new Promise(() => {}));

      positionSync.syncPositions();
      expect(traccar.getPositions).toHaveBeenCalledTimes(1);

      await positionSync.syncPositions();
      expect(traccar.getPositions).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(121000);

      await positionSync.syncPositions();
      expect(traccar.getPositions).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  test('stale run yang selesai SETELAH watchdog tidak menulis cache', async () => {
    jest.useFakeTimers();
    try {
      const stalePositions = [
        { deviceId: 999, source: 'traccar', speed: 99, latitude: 0, longitude: 0, serverTime: '1970-01-01T00:00:00Z' },
      ];
      let resolveStale;
      mspf.getPositions.mockImplementationOnce(() => new Promise(r => { resolveStale = r; }));

      const stalePromise = positionSync.syncPositions();

      await jest.advanceTimersByTimeAsync(121000);

      traccar.getPositions.mockResolvedValueOnce([
        { deviceId: 101, source: 'traccar', speed: 10, latitude: -6.2, longitude: 106.8 },
      ]);
      mspf.getPositions.mockResolvedValueOnce([
        { deviceId: 1001, source: 'mspf', speed: 20, latitude: -6.1, longitude: 106.9 },
      ]);

      const freshPromise = positionSync.syncPositions();
      await freshPromise;

      const freshPositions = cache.get('positions:merged');
      expect(freshPositions).toBeDefined();
      expect(freshPositions.length).toBe(2);
      expect(freshPositions.some(p => p.deviceId === 999)).toBe(false);

      resolveStale(stalePositions);
      await stalePromise;

      const afterStale = cache.get('positions:merged');
      expect(afterStale.length).toBe(2);
      expect(afterStale.some(p => p.deviceId === 999)).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test('stale run tidak mengganggu run yang sedang aktif (2 run bertumpuk)', async () => {
    jest.useFakeTimers();
    try {
      let resolve1;
      mspf.getPositions.mockImplementationOnce(() => new Promise(r => { resolve1 = r; }));

      const p1 = positionSync.syncPositions();

      await jest.advanceTimersByTimeAsync(121000);

      let resolve2;
      traccar.getPositions.mockResolvedValueOnce([
        { deviceId: 101, source: 'traccar', speed: 10, latitude: -6.2, longitude: 106.8 },
      ]);
      mspf.getPositions.mockImplementationOnce(() => new Promise(r => { resolve2 = r; }));

      const p2 = positionSync.syncPositions();

      resolve1([{ deviceId: 1001, source: 'mspf', speed: 20, latitude: -6.1, longitude: 106.9 }]);
      await p1;

      expect(positionSync.getActiveSyncCount()).toBe(1);

      resolve2([{ deviceId: 1001, source: 'mspf', speed: 20, latitude: -6.1, longitude: 106.9 }]);
      await p2;

      expect(positionSync.getActiveSyncCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
