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
const { syncPositions, setEmitHooks } = require('../services/positionSync');
const { statusTracker } = require('../utils/liveStatus');

describe('positionSync — emit hooks (live tracking)', () => {
  const nowIso = new Date().toISOString();

  beforeEach(() => {
    jest.clearAllMocks();
    statusTracker.reset();
    cache.set('devices:merged', [
      { id: 1, source: 'traccar', group: 'traccar_5', lastUpdate: nowIso },
      { id: 2, source: 'mspf', group: 'mspf_10000023', lastUpdate: nowIso },
      { id: 3, source: 'foxlogger', uniqueId: '3', lastUpdate: nowIso },
    ], 120);
    cache.del('positions:merged');
    setEmitHooks({ onPosition: jest.fn(), onStatus: jest.fn() });
  });

  test('emits position only for MSPF/FoxLogger changed devices (not Traccar)', async () => {
    traccar.getPositions.mockResolvedValue([{ deviceId: 1, latitude: 1, longitude: 1, speed: 0, course: 0, deviceTime: nowIso, attributes: {} }]);
    mspf.getPositions.mockResolvedValue([{ deviceId: 2, latitude: 2, longitude: 2, speed: 5, course: 90, deviceTime: nowIso, attributes: {} }]);
    foxlogger.getPositions.mockResolvedValue([{ deviceId: 3, latitude: 3, longitude: 3, speed: 0, course: 0, deviceTime: nowIso, attributes: {} }]);

    const onPos = jest.fn().mockResolvedValue();
    const onStatus = jest.fn();
    setEmitHooks({ onPosition: onPos, onStatus });

    await syncPositions();

    expect(onPos).toHaveBeenCalledTimes(2);
    const ids = onPos.mock.calls.map(c => c[0].deviceId).sort();
    expect(ids).toEqual([2, 3]);
    const mspfCall = onPos.mock.calls.find(c => c[0].source === 'mspf');
    expect(mspfCall[0].course).toBe(90);
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 2, source: 'mspf', status: 'online' }));
  });

  test('does not re-emit unchanged positions on second sync', async () => {
    mspf.getPositions.mockResolvedValue([{ deviceId: 2, latitude: 2, longitude: 2, speed: 5, course: 90, deviceTime: nowIso, attributes: {} }]);
    foxlogger.getPositions.mockResolvedValue([]);
    traccar.getPositions.mockResolvedValue([]);

    const onPos = jest.fn().mockResolvedValue();
    setEmitHooks({ onPosition: onPos, onStatus: jest.fn() });

    await syncPositions();
    await syncPositions();

    expect(onPos).toHaveBeenCalledTimes(1);
  });

  test('emits offline status once a device goes stale', async () => {
    const staleMs = Date.now() - 700000;
    cache.set('devices:merged', [
      { id: 2, source: 'mspf', group: 'mspf_10000023', lastUpdate: new Date(staleMs).toISOString() },
    ], 120);
    traccar.getPositions.mockResolvedValue([]);
    mspf.getPositions.mockResolvedValue([]);
    foxlogger.getPositions.mockResolvedValue([]);

    // seed tracker as previously online
    statusTracker.setStatus(2, 'mspf', 'online', staleMs, { now: staleMs });

    const onStatus = jest.fn();
    setEmitHooks({ onPosition: jest.fn(), onStatus });

    await syncPositions();

    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 2, source: 'mspf', status: 'offline' }));
  });
});
