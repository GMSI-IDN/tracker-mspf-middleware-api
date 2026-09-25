'use strict';

const cache = require('../services/cache');
const mspf = require('../services/mspf');

describe('Pilar 3: Decouple MCCS from Fast Position Sync', () => {
  beforeEach(() => {
    cache.del('devices:merged');
  });

  test('Fast position sync does not trigger outgoing MCCS history HTTP requests', async () => {
    // Mock getApi responses
    const mockGet = jest.fn((url) => {
      if (url.includes('/positions')) {
        return Promise.resolve({
          data: {
            data: [
              { deviceId: 1001, position: { lat: -6.2, lon: 106.8, speed: 20, timestamp: 1790000000 } },
              { deviceId: 1002, position: { lat: -6.1, lon: 106.9, speed: 30, timestamp: 1790000000 } },
            ],
            next: null,
          },
        });
      }
      if (url.includes('/status')) {
        return Promise.resolve({
          data: {
            data: [
              { deviceId: 1001, speed: 20, ignition: 'ON', running: { status: 'RUN' }, voltage: 12.5 },
              { deviceId: 1002, speed: 30, ignition: 'OFF', running: { status: 'STOP' }, voltage: 12.4 },
            ],
            next: null,
          },
        });
      }
      if (url.includes('/data/history')) {
        return Promise.resolve({ data: { data: [{ tid: 1, kph: 20 }] } });
      }
      return Promise.resolve({ data: {} });
    });

    const mockApi = {
      get: mockGet,
      interceptors: { response: { use: jest.fn() } },
    };

    jest.spyOn(mspf, 'getApi').mockReturnValue(mockApi);

    // Call getPositions (fast path default: fetchMccs: false)
    const positions = await mspf.getPositions({});
    expect(positions.length).toBe(2);
    expect(positions[0].deviceId).toBe(1001);
    expect(positions[0].speed).toBe(20);
    expect(positions[0].attributes.ignition).toBe(true);
    expect(positions[0].attributes.running).toBe('RUN');

    // Verify /data/history was NOT called on the fast position sync path
    const historyCalls = mockGet.mock.calls.filter(([url]) => url.includes('/data/history'));
    expect(historyCalls.length).toBe(0);

    // Verify 3e: timeout 10000ms on position sync path
    const positionsCall = mockGet.mock.calls.find(([url]) => url.includes('/positions'));
    expect(positionsCall[1]).toEqual(expect.objectContaining({ timeout: 10000 }));

    const statusCall = mockGet.mock.calls.find(([url]) => url.includes('/status'));
    expect(statusCall[1]).toEqual(expect.objectContaining({ timeout: 10000 }));
  });
});
