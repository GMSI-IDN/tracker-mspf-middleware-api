const { createStatusTracker, resolveThresholds, toMs } = require('../utils/liveStatus');

const OFFLINE = 600000;
const ONLINE = 600000;

function tracker() {
  return createStatusTracker();
}

describe('liveStatus — notePosition / change detection', () => {
  test('fresh data makes device online with statusChanged', () => {
    const t = tracker();
    const now = Date.now();
    const res = t.notePosition({ deviceId: 1, source: 'mspf', latitude: -6.2, longitude: 106.8, speed: 10, course: 90, deviceTime: new Date(now - 1000).toISOString() }, { now, offlineMs: OFFLINE, onlineMs: ONLINE });
    expect(res.status).toBe('online');
    expect(res.statusChanged).toBe(true);
    expect(res.shouldEmitPos).toBe(true);
  });

  test('identical position does not re-emit (change-only)', () => {
    const t = tracker();
    const now = Date.now();
    const item = { deviceId: 1, source: 'traccar', latitude: -6.2, longitude: 106.8, speed: 0, course: 0, deviceTime: new Date(now - 1000).toISOString() };
    t.notePosition(item, { now, offlineMs: OFFLINE, onlineMs: ONLINE });
    const res = t.notePosition(item, { now, offlineMs: OFFLINE, onlineMs: ONLINE });
    expect(res.shouldEmitPos).toBe(false);
  });

  test('course change triggers emit (speed/course included in key)', () => {
    const t = tracker();
    const now = Date.now();
    const base = { deviceId: 1, source: 'mspf', latitude: -6.2, longitude: 106.8, speed: 10, course: 90, deviceTime: new Date(now - 1000).toISOString() };
    t.notePosition(base, { now, offlineMs: OFFLINE, onlineMs: ONLINE });
    const res = t.notePosition({ ...base, course: 180 }, { now, offlineMs: OFFLINE, onlineMs: ONLINE });
    expect(res.shouldEmitPos).toBe(true);
  });

  test('stale position does not mark device online', () => {
    const t = tracker();
    const now = Date.now();
    const res = t.notePosition({ deviceId: 1, source: 'foxlogger', latitude: 0, longitude: 0, speed: 0, course: 0, deviceTime: new Date(now - 3600 * 1000).toISOString() }, { now, offlineMs: OFFLINE, onlineMs: ONLINE });
    expect(res.status).toBe('offline');
  });
});

describe('liveStatus — offline detection & hysteresis', () => {
  test('marks offline after threshold, edge-triggered', () => {
    const t = tracker();
    const start = Date.now();
    t.notePosition({ deviceId: 1, source: 'traccar', latitude: 0, longitude: 0, speed: 0, course: 0, deviceTime: new Date(start).toISOString() }, { now: start, offlineMs: OFFLINE, onlineMs: ONLINE });
    expect(t.evaluateStale(1, 'traccar', start, { now: start + OFFLINE - 1000, offlineMs: OFFLINE })).toBeNull();
    expect(t.evaluateStale(1, 'traccar', start, { now: start + OFFLINE + 1000, offlineMs: OFFLINE })).toBe('offline');
    expect(t.evaluateStale(1, 'traccar', start, { now: start + OFFLINE + 2000, offlineMs: OFFLINE })).toBeNull();
  });

  test('device never seen online is not marked offline', () => {
    const t = tracker();
    const now = Date.now();
    expect(t.evaluateStale(9, 'mspf', now - 3600 * 1000, { now, offlineMs: OFFLINE })).toBeNull();
  });

  test('cooldown prevents rapid flapping', () => {
    const t = tracker();
    const start = Date.now();
    // device comes online recently, but its last known data is old (edge case)
    t.setStatus(1, 'mspf', 'online', start - OFFLINE - 5000, { now: start + 1 });
    // stale by a large margin, but within cooldown → blocked
    expect(t.evaluateStale(1, 'mspf', start - OFFLINE - 5000, { now: start + 1000, offlineMs: OFFLINE })).toBeNull();
    // after cooldown elapsed → offline
    expect(t.evaluateStale(1, 'mspf', start - OFFLINE - 5000, { now: start + 61000, offlineMs: OFFLINE })).toBe('offline');
  });
});

describe('liveStatus — thresholds', () => {
  test('global default is 10 minutes', () => {
    expect(resolveThresholds('unknown_source', null).offlineMs).toBe(OFFLINE);
  });

  test('per-source override wins over global', () => {
    expect(resolveThresholds('mspf', null).offlineMs).toBe(OFFLINE);
  });

  test('per-device metadata reportIntervalMinutes wins over source/global', () => {
    const t = tracker();
    const meta = { reportIntervalMinutes: 30 };
    const thresholds = t.resolveThresholds('mspf', meta);
    expect(thresholds.offlineMs).toBe(30 * 60 * 1000 * 2);
  });

  test('per-device offlineThresholdMs wins over reportIntervalMinutes', () => {
    const t = tracker();
    const thresholds = t.resolveThresholds('traccar', { offlineThresholdMs: 999000, reportIntervalMinutes: 30 });
    expect(thresholds.offlineMs).toBe(999000);
  });

  test('precedence: per-group then per-type (overrides) before source/global', () => {
    const t = tracker();
    expect(t.resolveThresholds('traccar', null, { perGroup: 1500000 }).offlineMs).toBe(1500000);
    expect(t.resolveThresholds('traccar', null, { perGroup: 1500000, perType: 2000000 }).offlineMs).toBe(1500000);
    expect(t.resolveThresholds('traccar', null, { perType: 2000000 }).offlineMs).toBe(2000000);
    // per-device still highest
    expect(t.resolveThresholds('traccar', { offlineThresholdMs: 999000 }, { perGroup: 1500000, perType: 2000000 }).offlineMs).toBe(999000);
  });
});

describe('liveStatus — snapshot & heartbeat', () => {
  test('snapshot returns only devices with known status, filterable', () => {
    const t = tracker();
    const now = Date.now();
    t.notePosition({ deviceId: 1, source: 'traccar', latitude: 0, longitude: 0, speed: 0, course: 0, deviceTime: new Date(now - 1000).toISOString() }, { now, offlineMs: OFFLINE, onlineMs: ONLINE });
    t.notePosition({ deviceId: 2, source: 'mspf', latitude: 0, longitude: 0, speed: 0, course: 0, deviceTime: new Date(now - 1000).toISOString() }, { now, offlineMs: OFFLINE, onlineMs: ONLINE });
    const all = t.snapshot();
    expect(all.length).toBe(2);
    const filtered = t.snapshot((k) => k === 'traccar:1');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].status).toBe('online');
  });

  test('heartbeatDevices returns all known devices', () => {
    const t = tracker();
    const now = Date.now();
    t.notePosition({ deviceId: 1, source: 'mspf', latitude: 0, longitude: 0, speed: 0, course: 0, deviceTime: new Date(now - 1000).toISOString() }, { now, offlineMs: OFFLINE, onlineMs: ONLINE });
    expect(t.heartbeatDevices()).toHaveLength(1);
  });
});

describe('liveStatus — toMs', () => {
  test('converts unix seconds / ISO / ms', () => {
    expect(toMs(1591181120)).toBe(1591181120000);
    expect(toMs('2026-06-15T10:00:00Z')).toBe(new Date('2026-06-15T10:00:00Z').getTime());
    expect(toMs(null)).toBe(0);
  });
});
