'use strict';

const cache = require('../services/cache');

describe('Cache Immutability & Deep Freeze Strict Guard (Object.freeze + use strict)', () => {
  beforeEach(() => {
    cache.del('positions:merged');
  });

  test('Mutating nested property positions[0].speed = 1 throws TypeError in strict mode', () => {
    const rawPositions = [
      { id: 101, deviceId: 101, speed: 20, source: 'mspf', attributes: { volt: 12.5, ignition: true } },
      { id: 102, deviceId: 102, speed: 35, source: 'traccar', attributes: { volt: 13.0, ignition: false } },
    ];
    cache.set('positions:merged', rawPositions);

    const cached = cache.get('positions:merged');

    // 1. Mutating nested property: positions[0].speed = 1
    expect(() => {
      cached[0].speed = 1;
    }).toThrow(TypeError);

    // 2. Mutating deeper nested attribute: positions[0].attributes.volt = 99
    expect(() => {
      cached[0].attributes.volt = 99;
    }).toThrow(TypeError);

    // 3. Mutating array element index: positions[0] = { ... }
    expect(() => {
      cached[0] = { id: 999 };
    }).toThrow(TypeError);

    // 4. Deleting a property: delete positions[0].source
    expect(() => {
      delete cached[0].source;
    }).toThrow(TypeError);

    // Verify data remains untouched
    const fresh = cache.get('positions:merged');
    expect(fresh[0].speed).toBe(20);
    expect(fresh[0].attributes.volt).toBe(12.5);
    expect(fresh[0].source).toBe('mspf');
  });

  test('Shallow copying allows safe modification without altering cached data', () => {
    const rawPositions = [
      { id: 101, deviceId: 101, speed: 20, source: 'mspf', attributes: { volt: 12.5 } },
    ];
    cache.set('positions:merged', rawPositions);

    const cached = cache.get('positions:merged');
    const safeCopy = cached.map(p => ({
      ...p,
      attributes: { ...p.attributes },
    }));

    // Mutating the shallow copy is completely permitted
    safeCopy[0].speed = 1;
    safeCopy[0].attributes.volt = 99;
    delete safeCopy[0].source;

    expect(safeCopy[0].speed).toBe(1);
    expect(safeCopy[0].attributes.volt).toBe(99);
    expect(safeCopy[0].source).toBeUndefined();

    // Master cache remains completely untouched
    const fresh = cache.get('positions:merged');
    expect(fresh[0].speed).toBe(20);
    expect(fresh[0].attributes.volt).toBe(12.5);
    expect(fresh[0].source).toBe('mspf');
  });
});
