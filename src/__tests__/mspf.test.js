const { enrichRouteWithMccsHistory } = require('../services/mspf');

describe('mspf — enrichRouteWithMccsHistory', () => {
  const deviceId = 10175839;
  const status = {
    deviceId,
    tags: {
      VIN: 'B2156POB',
      deviceSerialNo: 'IDN0210246',
      mobilityNo: 'MHKA6GJ3JKJ034175',
    },
    voltage: 12.0,
  };

  test('enriches each route position with its own historical MCCS telemetry', () => {
    const positions = [
      {
        deviceId,
        latitude: -6.245701,
        longitude: 106.734112,
        speed: 0,
        course: 0,
        altitude: 0,
        deviceTime: '2026-09-17T17:09:30.000Z',
        serverTime: '2026-09-17T17:09:40.000Z',
        attributes: {},
      },
      {
        deviceId,
        latitude: -6.245703,
        longitude: 106.734048,
        speed: 0,
        course: 0,
        altitude: 0,
        deviceTime: '2026-09-17T18:10:35.000Z',
        serverTime: '2026-09-17T18:10:45.000Z',
        attributes: {},
      },
    ];

    const mccsHistory = [
      {
        createdAt: '2026-09-17T17:09:34.000Z',
        insDtm: '2026-09-17T17:09:40.000Z',
        data: {
          kph: 15.5,
          dir: 90,
          alt: 40,
          sats: 10,
          odom: 100.5,
          volt: 13.2,
          addr: {
            IGN: 1,
            EB: 13.2,
            IB: 4.0,
          },
        },
      },
      {
        createdAt: '2026-09-17T18:10:39.000Z',
        insDtm: '2026-09-17T18:10:45.000Z',
        data: {
          kph: 0,
          dir: 180,
          alt: 42,
          sats: 14,
          odom: 125.0,
          volt: 12.4,
          addr: {
            IGN: 0,
            EB: 12.4,
            IB: 4.05,
          },
        },
      },
    ];

    const enriched = enrichRouteWithMccsHistory(positions, mccsHistory, status);

    expect(enriched).toHaveLength(2);

    // Point 1: Moving at 15.5 km/h, heading 90, ignition ON
    expect(enriched[0].speed).toBe(15.5);
    expect(enriched[0].course).toBe(90);
    expect(enriched[0].attributes.ignition).toBe(true);
    expect(enriched[0].attributes.voltage).toBe(13.2);
    expect(enriched[0].attributes.odom).toBe(100.5);
    expect(enriched[0].attributes.sats).toBe(10);
    expect(enriched[0].attributes.running).toBe('RUN');
    expect(enriched[0].attributes.VIN).toBe('B2156POB');
    expect(enriched[0].attributes.createdAt).toBe('2026-09-17T17:09:34.000Z');

    // Point 2: Stopped at 0 km/h, heading 180, ignition OFF
    expect(enriched[1].speed).toBe(0);
    expect(enriched[1].course).toBe(180);
    expect(enriched[1].attributes.ignition).toBe(false);
    expect(enriched[1].attributes.voltage).toBe(12.4);
    expect(enriched[1].attributes.odom).toBe(125.0);
    expect(enriched[1].attributes.sats).toBe(14);
    expect(enriched[1].attributes.running).toBe('STOP');
    expect(enriched[1].attributes.VIN).toBe('B2156POB');
    expect(enriched[1].attributes.createdAt).toBe('2026-09-17T18:10:39.000Z');

    // Telemetry MUST NOT be identical across distinct points
    expect(enriched[0].speed).not.toBe(enriched[1].speed);
    expect(enriched[0].course).not.toBe(enriched[1].course);
    expect(enriched[0].attributes.ignition).not.toBe(enriched[1].attributes.ignition);
    expect(enriched[0].attributes.voltage).not.toBe(enriched[1].attributes.voltage);
  });

  test('falls back gracefully to static tags when MCCS timestamp is outside tolerance', () => {
    const positions = [
      {
        deviceId,
        latitude: -6.245,
        longitude: 106.734,
        speed: 5,
        course: 0,
        deviceTime: '2026-09-17T10:00:00.000Z',
        attributes: {},
      },
    ];

    // MCCS record is 1 hour later
    const mccsHistory = [
      {
        createdAt: '2026-09-17T11:00:00.000Z',
        data: { kph: 50, dir: 120 },
      },
    ];

    const enriched = enrichRouteWithMccsHistory(positions, mccsHistory, status);
    expect(enriched).toHaveLength(1);
    expect(enriched[0].speed).toBe(5);
    expect(enriched[0].course).toBe(0);
    expect(enriched[0].attributes.VIN).toBe('B2156POB');
    expect(enriched[0].attributes.kph).toBeUndefined();
  });

  test('handles empty MCCS history and empty positions without errors', () => {
    expect(enrichRouteWithMccsHistory([], [])).toEqual([]);
    const pos = [{ deviceId, latitude: 1, longitude: 2, deviceTime: '2026-09-17T10:00:00.000Z' }];
    const res = enrichRouteWithMccsHistory(pos, [], status);
    expect(res).toHaveLength(1);
    expect(res[0].attributes.VIN).toBe('B2156POB');
  });
});
