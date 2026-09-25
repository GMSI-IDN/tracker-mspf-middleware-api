const http = require('http');
const cache = require('../services/cache');
const { statusTracker } = require('../utils/liveStatus');
const {
  setupWebSocket,
  teardownWebSocket,
  getIO,
  handleTraccarMessage,
} = require('../websocket');

describe('Traccar WS Message Characterization & Snapshot Parity', () => {
  let server;
  let mockSocket;
  let emittedEvents = [];

  beforeAll(() => {
    server = http.createServer();
    setupWebSocket(server);
  });

  afterAll((done) => {
    teardownWebSocket();
    if (server && server.listening) {
      server.close(done);
    } else {
      done();
    }
  });

  beforeEach(() => {
    emittedEvents = [];
    statusTracker.reset();

    // Verify cache has useClones disabled for high-throughput zero-copy performance
    expect(cache.options.useClones).toBe(false);

    const io = getIO();
    mockSocket = {
      user: { id: 1, role: 'admin', username: 'admin' },
      allowedDevices: null,
      emit: jest.fn((event, data) => {
        emittedEvents.push({ event, data: JSON.parse(JSON.stringify(data)) });
      }),
    };
    io.sockets.sockets.clear();
    io.sockets.sockets.set('test_admin_socket', mockSocket);
  });

  afterEach(() => {
    cache.del('devices:merged');
  });

  // Fixture: 10 devices
  const initialDevices = Array.from({ length: 10 }, (_, i) => ({
    id: 101 + i,
    name: `Traccar Device ${101 + i}`,
    uniqueId: `TRAC_${101 + i}`,
    status: i % 2 === 0 ? 'online' : 'offline',
    source: 'traccar',
    group: 'traccar_10',
    lastUpdate: '2026-09-20T08:00:00.000Z',
    voltage: 12.4,
    ignition: false,
    attributes: {
      blocked: false,
      ignition: false,
      power: 12.4,
    },
  }));

  // Fixture WS Message with 10 devices, 10 positions, and 2 events
  const fixtureMessage = {
    devices: Array.from({ length: 10 }, (_, i) => ({
      id: 101 + i,
      status: i % 2 === 0 ? 'offline' : 'online',
      lastUpdate: `2026-09-20T10:0${i}:00.000Z`,
      attributes: {
        blocked: i === 0,
        ignition: true,
        voltage: 13.2,
      },
    })),
    events: [
      { type: 'deviceOnline', deviceId: 101, eventTime: '2026-09-20T10:00:00.000Z' },
      { type: 'deviceOffline', deviceId: 102, eventTime: '2026-09-20T10:01:00.000Z' },
    ],
    positions: Array.from({ length: 10 }, (_, i) => ({
      deviceId: 101 + i,
      latitude: -6.2 + i * 0.01,
      longitude: 106.8 + i * 0.01,
      speed: 10 + i,
      course: 90,
      altitude: 15,
      deviceTime: `2026-09-20T10:0${i}:00.000Z`,
      valid: true,
      attributes: {
        ignition: true,
        power: 13.2,
      },
    })),
  };

  test('records emitted socket events and matches snapshot fixture', async () => {
    cache.set('devices:merged', initialDevices, 120);

    await handleTraccarMessage(Buffer.from(JSON.stringify(fixtureMessage)));

    // Ensure events were emitted
    expect(emittedEvents.length).toBeGreaterThan(0);

    // Filter by event type
    const statusEvents = emittedEvents.filter((e) => e.event === 'device-status');
    const positionEvents = emittedEvents.filter((e) => e.event === 'position');

    // 10 device status from devices loop + 2 from events loop + 10 from positions loop = 22 status emits
    expect(statusEvents.length).toBe(22);
    // 10 positions emitted
    expect(positionEvents.length).toBe(10);

    // Snapshot match — guarantees 100% parity with pre-refactor implementation
    expect(emittedEvents).toMatchSnapshot();
  });

  test('calls cache.get with key "devices:merged" EXACTLY 1 time per message', async () => {
    cache.set('devices:merged', initialDevices, 120);

    const getSpy = jest.spyOn(cache, 'get');

    try {
      await handleTraccarMessage(Buffer.from(JSON.stringify(fixtureMessage)));

      const devicesMergedCalls = getSpy.mock.calls.filter((call) => call[0] === 'devices:merged');
      expect(devicesMergedCalls.length).toBe(1);
    } finally {
      getSpy.mockRestore();
    }
  });
});
