process.env.RUN_MIGRATIONS = 'false';

const cache = require('../services/cache');
const { buildStatusPayload } = require('../websocket/index');

describe('buildStatusPayload — device-status contract', () => {
  beforeEach(() => {
    cache.del('devices:merged');
  });

  test('offline: 5 sensor fields present as null, running UNKNOWN, lastUpdate preserved', () => {
    const payload = buildStatusPayload({ deviceId: 2, source: 'mspf', status: 'offline', lastUpdate: '2026-06-18T04:05:12Z' });
    expect(payload.status).toBe('offline');
    expect(payload.running).toBe('UNKNOWN');
    expect(payload.ignition).toBeNull();
    expect(payload.voltage).toBeNull();
    expect(payload.internalBattery).toBeNull();
    expect(payload.batteryLevel).toBeNull();
    expect(payload.lastUpdate).toBe('2026-06-18T04:05:12.000Z');
    expect(Object.keys(payload)).toEqual(expect.arrayContaining([
      'deviceId', 'source', 'status', 'lastUpdate',
      'running', 'ignition', 'voltage', 'internalBattery', 'batteryLevel',
    ]));
  });

  test('online with cache data: sensor fields populated', () => {
    cache.set('devices:merged', [
      { id: 2, source: 'mspf', name: 'Box', lastUpdate: '2026-06-18T04:05:12Z', running: 'STOP', attributes: { ignition: false, voltage: 13.59, addr_IB: 3.98, batteryLevel: 75 } },
    ], 120);
    const payload = buildStatusPayload({ deviceId: 2, source: 'mspf', status: 'online', lastUpdate: '2026-06-18T04:05:12Z' });
    expect(payload.running).toBe('STOP');
    expect(payload.ignition).toBe(false);
    expect(payload.voltage).toBe(13.59);
    expect(payload.internalBattery).toBe(3.98);
    expect(payload.batteryLevel).toBe(75);
  });

  test('online without cache data: sensor fields null (always present)', () => {
    const payload = buildStatusPayload({ deviceId: 99, source: 'foxlogger', status: 'online', lastUpdate: '2026-06-18T04:05:12Z' });
    expect(payload.running).toBeNull();
    expect(payload.ignition).toBeNull();
    expect(payload.voltage).toBeNull();
    expect(payload.internalBattery).toBeNull();
    expect(payload.batteryLevel).toBeNull();
    expect('voltage' in payload).toBe(true);
    expect(payload.status).toBe('online');
  });

  test('lastUpdate falls back to device cache then now', () => {
    cache.set('devices:merged', [
      { id: 2, source: 'mspf', lastUpdate: '2026-06-18T04:05:12Z', attributes: {} },
    ], 120);
    const payload = buildStatusPayload({ deviceId: 2, source: 'mspf', status: 'online', lastUpdate: undefined });
    expect(payload.lastUpdate).toBe('2026-06-18T04:05:12Z');
  });
});
