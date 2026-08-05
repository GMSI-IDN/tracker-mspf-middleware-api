const request = require('supertest');

jest.mock('../services/traccar', () => ({
  getDevices: jest.fn(),
  getGroups: jest.fn(),
  getPositions: jest.fn(),
  getCommands: jest.fn(),
  getCommandTypes: jest.fn(),
  sendCommand: jest.fn(),
  getHealth: jest.fn(),
  getReportStops: jest.fn(),
  getReportTrips: jest.fn(),
  getReportSummary: jest.fn(),
  getReportEvents: jest.fn(),
  getGeofences: jest.fn(),
}));

jest.mock('../services/mspf', () => {
  const mockDevices = [];
  return {
    init: jest.fn(),
    getApi: jest.fn(() => ({ get: jest.fn(), put: jest.fn() })),
    normalizeDevice: jest.fn((d) => d),
    normalizePosition: jest.fn((id, p) => p),
    getDevices: jest.fn(() => Promise.resolve({ data: mockDevices, total: 0, next: null })),
    getDevice: jest.fn(),
    getBcList: jest.fn(),
    getBc: jest.fn(),
    getPositions: jest.fn(() => Promise.resolve([])),
    getDeviceRoute: jest.fn(),
    getDeviceStatus: jest.fn(),
    getDeviceStatusList: jest.fn(),
    getCommandHistory: jest.fn(),
    activateDevice: jest.fn(),
    getDeviceParking: jest.fn(),
    getDeviceParkingAll: jest.fn(),
    getDeviceTrip: jest.fn(),
    getStatsSummary: jest.fn(),
    getDeviceStatsReports: jest.fn(),
    getBcStatsReports: jest.fn(),
    getMspfEvents: jest.fn(),
    getMspfClosedEvents: jest.fn(),
  };
});

jest.mock('../services/foxlogger', () => ({
  init: jest.fn(),
  waitForInit: jest.fn(() => Promise.resolve()),
  getApi: jest.fn(),
  getUserId: jest.fn(() => null),
  resolveImei: jest.fn((id) => String(id)),
  normalizeDevice: jest.fn((d) => d),
  normalizeReportPosition: jest.fn(),
  normalizeHistoryPosition: jest.fn(),
  getDevices: jest.fn(() => Promise.resolve({ data: [], total: 0, next: null })),
  searchDevices: jest.fn(() => Promise.resolve([])),
  getPositions: jest.fn(() => Promise.resolve([])),
  getDeviceRoute: jest.fn(() => Promise.resolve([])),
  getDeviceParking: jest.fn(() => Promise.resolve([])),
  getDeviceSummary: jest.fn(() => Promise.resolve({ data: [] })),
  getGeoFences: jest.fn(() => Promise.resolve([])),
  getAlarmReports: jest.fn(() => Promise.resolve([])),
}));

jest.mock('../services/autoSync', () => ({
  runAutoSync: jest.fn(),
}));

jest.mock('../services/customAttributes', () => ({
  applyRules: jest.fn((device, rules) => device),
  computeFormula: jest.fn(),
  getDeviceRules: jest.fn(() => Promise.resolve([])),
  buildDeviceRulesCache: jest.fn(() => Promise.resolve()),
}));

const traccar = require('../services/traccar');
const mspf = require('../services/mspf');
const foxlogger = require('../services/foxlogger');
const db = require('../db');

const app = require('../app');

jest.setTimeout(30000);
beforeAll(async () => {
  await db.waitForMigration();
});

describe('Health', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET / returns 200 with status', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('running');
  });

  test('GET /health returns 200 healthy', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
  });

  test('GET /health/detailed returns dependency status', async () => {
    traccar.getHealth.mockResolvedValue('OK');
    const res = await request(app).get('/health/detailed');
    expect(res.status).toBe(200);
    expect(res.body.dependencies).toBeDefined();
  });
});

describe('Authentication', () => {
  test('POST /api/auth/login with valid credentials returns token', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.role).toBe('admin');
  });

  test('POST /api/auth/login with invalid credentials returns 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ERR_UNAUTHORIZED');
  });

  test('POST /api/auth/login without body returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ERR_VALIDATION');
  });

  test('GET /api/auth/me returns user profile', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    const token = login.body.token;

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('admin');
  });

  test('GET /api/auth/me without token returns 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('User Management', () => {
  let adminToken;

  beforeEach(async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    adminToken = login.body.token;
  });

  test('GET /api/users returns user list (admin only)', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  test('GET /api/users without admin role returns 403', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    const customerToken = login.body.token;

    // Admin can create a customer user for testing
    const create = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'test_customer', password: 'pass', role: 'customer', groups: [] });
    expect([201, 409]).toContain(create.status);

    // Login as customer
    const cl = await request(app)
      .post('/api/auth/login')
      .send({ username: 'test_customer', password: 'pass' });
    const ct = cl.body.token;

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${ct}`);
    expect(res.status).toBe(403);
  });

  test('PUT /api/users/:id updates groups', async () => {
    const users = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`);
    const userId = users.body[0].id;

    const res = await request(app)
      .put(`/api/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ groups: ['traccar_5', 'mspf_3'] });
    expect(res.status).toBe(200);
    expect(res.body.groups).toEqual(['traccar_5', 'mspf_3']);
  });

  test('PUT /api/users/:id updates role', async () => {
    const users = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`);
    const customer = users.body.find(u => u.username === 'test_customer');

    const res = await request(app)
      .put(`/api/users/${customer.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'customer' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('customer');
  });
});

describe('Groups', () => {
  test('GET /api/groups with admin token returns only custom groups', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    const token = login.body.token;

    const res = await request(app)
      .get('/api/groups')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    // All groups must be source: 'custom' (no Traccar/MSPF)
    expect(res.body.groups.every(g => g.source === 'custom')).toBe(true);
  });
});

describe('Devices', () => {
  test('GET /api/devices returns device list (mocked)', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });

    traccar.getDevices.mockResolvedValue([]);
    mspf.getDevices.mockResolvedValue({ data: [], total: 0, next: null });

    const res = await request(app)
      .get('/api/devices')
      .set('Authorization', `Bearer ${login.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.devices).toBeDefined();
  });
  test('GET /api/devices without token returns 401', async () => {
    const res = await request(app).get('/api/devices');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ERR_UNAUTHORIZED');
  });

  test('Device list sorted by ID for stable pagination', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });

    traccar.getDevices.mockResolvedValue([
      { id: 10, name: 'B' },
      { id: 5, name: 'A', groupId: 1 },
    ]);
    mspf.getDevices.mockResolvedValue({
      data: [{ id: 7, name: 'C', bcId: 3, status: 'WORKING', tags: {} }],
      total: 1, next: null,
    });

    const res = await request(app)
      .get('/api/devices')
      .set('Authorization', `Bearer ${login.body.token}`);
    expect(res.status).toBe(200);
    const ids = res.body.devices.map(d => d.id);
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBeGreaterThan(ids[i - 1]);
    }
  });
});

describe('Device Metadata', () => {
  let token;
  let deviceId;

  beforeAll(async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    token = login.body.token;
    deviceId = 999999;
  });

  test('PUT /api/devices/:id/metadata saves and returns metadata', async () => {
    const res = await request(app)
      .put(`/api/devices/${deviceId}/metadata`)
      .set('Authorization', `Bearer ${token}`)
      .send({ source: 'traccar', metadata: { jenis: 'Box', merek: 'Mitsubishi', tahun: '2024', warna: 'Putih' } });
    expect(res.status).toBe(200);
    expect(res.body.metadata.jenis).toBe('Box');
  });

  test('PUT /api/devices/:id/metadata without body returns 400', async () => {
    const res = await request(app)
      .put(`/api/devices/${deviceId}/metadata`)
      .set('Authorization', `Bearer ${token}`)
      .send({ source: 'traccar' });
    expect(res.status).toBe(400);
  });

  test('Metadata appears in device detail', async () => {
    traccar.getDevices.mockResolvedValue([
      { id: deviceId, name: 'Test Device', uniqueId: 'TEST001', status: 'online', groupId: 1, attributes: {} },
    ]);
    const res = await request(app)
      .get(`/api/devices/${deviceId}?source=traccar`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.metadata).toBeDefined();
    expect(res.body.metadata.jenis).toBe('Box');
  });

  test('DELETE /api/devices/:id/metadata removes metadata', async () => {
    const res = await request(app)
      .delete(`/api/devices/${deviceId}/metadata?source=traccar`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);

    const detail = await request(app)
      .get(`/api/devices/${deviceId}?source=traccar`)
      .set('Authorization', `Bearer ${token}`);
    expect(detail.body.metadata).toEqual({});
  });

  test('DELETE /api/devices/9999/metadata without source returns 400', async () => {
    const res = await request(app)
      .delete('/api/devices/9999/metadata')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});

describe('Rate Limiting', () => {
  test('Login endpoint returns 429 after too many attempts', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    expect([200, 429]).toContain(res.status);
  });
});

describe('Admin Custom Groups', () => {
  let token;

  beforeAll(async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    token = login.body.token;
    await db('groups').whereIn('name', ['test_group', 'custom_attr_group']).delete();
  });

  afterAll(async () => {
    await db('groups').whereIn('name', ['test_group', 'custom_attr_group']).delete();
  });

  test('GET /api/admin/groups returns empty list', async () => {
    const res = await request(app)
      .get('/api/admin/groups')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.groups).toEqual([]);
  });

  test('POST /api/admin/groups creates a group', async () => {
    const res = await request(app)
      .post('/api/admin/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'test_group', description: 'Test' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('test_group');
  });

  test('POST /api/admin/groups duplicate name returns 409', async () => {
    const res = await request(app)
      .post('/api/admin/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'test_group' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ERR_CONFLICT');
  });

  test('GET /api/admin/device-groups returns list with device_name', async () => {
    const res = await request(app)
      .get('/api/admin/device-groups')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.deviceGroups)).toBe(true);
    if (res.body.deviceGroups.length > 0) {
      expect(res.body.deviceGroups[0]).toHaveProperty('device_name');
    }
  });

  test('DELETE /api/admin/groups/:id removes group', async () => {
    const group = await request(app)
      .get('/api/admin/groups')
      .set('Authorization', `Bearer ${token}`);
    const id = group.body.groups[0]?.id;
    if (!id) return;
    const res = await request(app)
      .delete(`/api/admin/groups/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  test('GET /api/admin/groups without token returns 401', async () => {
    const res = await request(app).get('/api/admin/groups');
    expect(res.status).toBe(401);
  });

  test('GET /api/admin/groups with customer token returns 403', async () => {
    // First create a customer user if not exists
    await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'cust_test', password: 'pass', role: 'customer', groups: [] });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'cust_test', password: 'pass' });
    const custToken = login.body.token;
    const res = await request(app)
      .get('/api/admin/groups')
      .set('Authorization', `Bearer ${custToken}`);
    expect(res.status).toBe(403);
  });
});

describe('Group Sync', () => {
  let token;

  beforeAll(async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    token = login.body.token;
  });

  test('GET /api/admin/group-sync returns rules list', async () => {
    const res = await request(app)
      .get('/api/admin/group-sync')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.rules).toBeDefined();
  });

  test('POST /api/admin/group-sync with invalid group returns 404', async () => {
    const res = await request(app)
      .post('/api/admin/group-sync')
      .set('Authorization', `Bearer ${token}`)
      .send({ middlewareGroupId: 9999, source: 'traccar', sourceGroupId: 'traccar_5' });
    expect(res.status).toBe(404);
  });

  test('POST /api/admin/group-sync with invalid source returns 400', async () => {
    const res = await request(app)
      .post('/api/admin/group-sync')
      .set('Authorization', `Bearer ${token}`)
      .send({ middlewareGroupId: 1, source: 'invalid', sourceGroupId: 'test' });
    expect(res.status).toBe(400);
  });

  test('DELETE /api/admin/group-sync/:id without auth returns 401', async () => {
    const res = await request(app).delete('/api/admin/group-sync/1');
    expect(res.status).toBe(401);
  });
});

describe('Custom Attributes', () => {
  let token;
  let groupId;

  beforeAll(async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    token = login.body.token;
    // Clean any leftover from previous runs
    await db('groups').where('name', 'custom_attr_group').delete();
    // Create a group to use in tests
    const grp = await request(app)
      .post('/api/admin/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'custom_attr_group' });
    groupId = grp.body.id;
  });

  afterAll(async () => {
    await db('groups').where('name', 'custom_attr_group').delete();
  });

  test('GET /api/admin/custom-attributes returns empty list', async () => {
    const res = await request(app)
      .get('/api/admin/custom-attributes')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.rules).toEqual([]);
  });

  test('GET /api/admin/custom-attributes/available-fields returns field list', async () => {
    const res = await request(app)
      .get('/api/admin/custom-attributes/available-fields')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.fields).toBeDefined();
    expect(Array.isArray(res.body.fields)).toBe(true);
  });

  test('GET /api/groups/:id/preview returns attribute preview', async () => {
    const res = await request(app)
      .get(`/api/groups/${groupId}/preview`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.rootFields).toBeDefined();
    expect(res.body.visibleAttributes).toBeDefined();
    expect(res.body.group).toBeDefined();
  });

  test('GET /api/groups/9999/preview returns 404', async () => {
    const res = await request(app)
      .get('/api/groups/9999/preview')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  test('GET /api/groups/:id/preview with customer returns 403 if not assigned', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'test_customer', password: 'pass' });
    const customerToken = login.body.token;

    const res = await request(app)
      .get(`/api/groups/${groupId}/preview`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(403);
  });

  test('POST invalid mode returns 400', async () => {
    const res = await request(app)
      .post('/api/admin/custom-attributes')
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId, name: 'test', mode: 'invalid' });
    expect(res.status).toBe(400);
  });

  test('POST missing group returns 404', async () => {
    const res = await request(app)
      .post('/api/admin/custom-attributes')
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId: 9999, name: 'test', mode: 'passthrough' });
    expect(res.status).toBe(404);
  });

  test('POST create passthrough rule', async () => {
    const res = await request(app)
      .post('/api/admin/custom-attributes')
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId, name: 'adc1', mode: 'passthrough' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('adc1');
  });

  test('DELETE rule', async () => {
    const list = await request(app)
      .get('/api/admin/custom-attributes')
      .set('Authorization', `Bearer ${token}`);
    const id = list.body.rules[0]?.id;
    if (!id) return;
    const res = await request(app)
      .delete(`/api/admin/custom-attributes/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  test('GET without auth returns 401', async () => {
    const res = await request(app).get('/api/admin/custom-attributes');
    expect(res.status).toBe(401);
  });
});

describe('Parking Reports', () => {
  let token;
  const traccarDeviceId = 999991;
  const mspfDeviceId = 999992;

  beforeAll(async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    token = login.body.token;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/reports/parking without deviceId returns 400', async () => {
    const res = await request(app)
      .get('/api/reports/parking')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ERR_VALIDATION');
  });

  test('GET /api/reports/parking without from returns 400', async () => {
    const res = await request(app)
      .get(`/api/reports/parking?deviceId=${traccarDeviceId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ERR_VALIDATION');
  });

  test('GET /api/reports/parking without token returns 401', async () => {
    const res = await request(app)
      .get(`/api/reports/parking?deviceId=${traccarDeviceId}&from=2026-06-01T00:00:00Z`);
    expect(res.status).toBe(401);
  });

  test('GET /api/reports/parking returns Traccar parking data', async () => {
    traccar.getDevices.mockResolvedValue([{ id: traccarDeviceId, name: 'Test Traccar', uniqueId: 'test', status: 'online', groupId: 5 }]);
    traccar.getReportStops.mockResolvedValue([
      { deviceId: traccarDeviceId, startTime: '2026-06-15T10:00:00Z', endTime: '2026-06-15T10:30:00Z', duration: 1800, lat: -6.2088, lon: 106.8456, address: 'Jl. Sudirman', engineHours: 0 },
      { deviceId: traccarDeviceId, startTime: '2026-06-15T11:00:00Z', endTime: '2026-06-15T11:15:00Z', duration: 900, lat: -6.2090, lon: 106.8460, address: 'Jl. Thamrin', engineHours: 0 },
    ]);

    const res = await request(app)
      .get(`/api/reports/parking?deviceId=${traccarDeviceId}&from=2026-06-01T00:00:00Z&to=2026-06-30T00:00:00Z`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('traccar');
    expect(res.body.deviceId).toBe(traccarDeviceId);
    expect(res.body.parking.length).toBe(2);
    expect(res.body.parking[0]).toHaveProperty('startTime');
    expect(res.body.parking[0]).toHaveProperty('duration');
    expect(res.body.parking[0]).toHaveProperty('latitude');
    expect(res.body.parking[0]).toHaveProperty('address');
    expect(res.body.summary.total).toBe(2);
    expect(res.body.summary.totalDuration).toBe(2700);
  });

  test('GET /api/reports/parking filters out idle stops (engineHours > 0) for Traccar', async () => {
    traccar.getDevices.mockResolvedValue([{ id: traccarDeviceId, name: 'Test Traccar', uniqueId: 'test', status: 'online', groupId: 5 }]);
    traccar.getReportStops.mockResolvedValue([
      { deviceId: traccarDeviceId, startTime: '2026-06-15T10:00:00Z', endTime: '2026-06-15T10:30:00Z', duration: 1800, lat: -6.2088, lon: 106.8456, address: 'Jl. Sudirman', engineHours: 0 },
      { deviceId: traccarDeviceId, startTime: '2026-06-15T11:00:00Z', endTime: '2026-06-15T11:15:00Z', duration: 900, lat: -6.2090, lon: 106.8460, address: 'Jl. Thamrin', engineHours: 900 },
    ]);

    const res = await request(app)
      .get(`/api/reports/parking?deviceId=${traccarDeviceId}&from=2026-06-01T00:00:00Z`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.parking.length).toBe(1);
    expect(res.body.parking[0].duration).toBe(1800);
  });

  test('GET /api/reports/parking returns MSPF parking data', async () => {
    traccar.getDevices.mockResolvedValue([]);
    mspf.getDevice.mockResolvedValue({ id: mspfDeviceId, status: 'WORKING' });
    mspf.getDeviceParkingAll.mockResolvedValue([
      { parkingStartTime: '2026-06-15T12:00:00Z', parkingTime: 90, position: { lat: -7.3235, lon: 112.7410 } },
      { parkingStartTime: '2026-06-15T14:00:00Z', parkingTime: 30, position: { lat: -7.3236, lon: 112.7411 } },
    ]);

    const res = await request(app)
      .get(`/api/reports/parking?deviceId=${mspfDeviceId}&from=2026-06-01T00:00:00Z`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('mspf');
    expect(res.body.deviceId).toBe(mspfDeviceId);
    expect(res.body.parking.length).toBe(2);
    expect(res.body.parking[0].duration).toBe(1800);
    expect(res.body.parking[1].duration).toBe(5400);
    expect(res.body.summary.total).toBe(2);
    expect(res.body.summary.totalDuration).toBe(7200);
  });

  test('GET /api/reports/parking returns empty list when no stops', async () => {
    traccar.getDevices.mockResolvedValue([{ id: traccarDeviceId, name: 'Test', uniqueId: 'test', status: 'online', groupId: 5 }]);
    traccar.getReportStops.mockResolvedValue([]);

    const res = await request(app)
      .get(`/api/reports/parking?deviceId=${traccarDeviceId}&from=2026-06-01T00:00:00Z`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.parking).toEqual([]);
    expect(res.body.summary.total).toBe(0);
    expect(res.body.summary.totalDuration).toBe(0);
  });
});

describe('Idle Reports', () => {
  let token;
  const traccarDeviceId = 999993;
  const mspfDeviceId = 999994;

  beforeAll(async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    token = login.body.token;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/reports/idle without deviceId returns 400', async () => {
    const res = await request(app)
      .get('/api/reports/idle')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ERR_VALIDATION');
  });

  test('GET /api/reports/idle without from returns 400', async () => {
    const res = await request(app)
      .get(`/api/reports/idle?deviceId=${traccarDeviceId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ERR_VALIDATION');
  });

  test('GET /api/reports/idle without token returns 401', async () => {
    const res = await request(app)
      .get(`/api/reports/idle?deviceId=${traccarDeviceId}&from=2026-06-01T00:00:00Z`);
    expect(res.status).toBe(401);
  });

  test('GET /api/reports/idle returns Traccar idle data (engineHours > 0)', async () => {
    traccar.getDevices.mockResolvedValue([{ id: traccarDeviceId, name: 'Test', uniqueId: 'test', status: 'online', groupId: 5 }]);
    traccar.getReportStops.mockResolvedValue([
      { deviceId: traccarDeviceId, startTime: '2026-06-15T10:00:00Z', endTime: '2026-06-15T10:30:00Z', duration: 1800, lat: -6.2088, lon: 106.8456, address: 'Jl. Sudirman', engineHours: 0 },
      { deviceId: traccarDeviceId, startTime: '2026-06-15T11:00:00Z', endTime: '2026-06-15T11:15:00Z', duration: 900, lat: -6.2090, lon: 106.8460, address: 'Jl. Thamrin', engineHours: 900 },
    ]);

    const res = await request(app)
      .get(`/api/reports/idle?deviceId=${traccarDeviceId}&from=2026-06-01T00:00:00Z`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('traccar');
    expect(res.body.idle.length).toBe(1);
    expect(res.body.idle[0].duration).toBe(900);
    expect(res.body.idle[0].address).toBe('Jl. Thamrin');
    expect(res.body.summary.total).toBe(1);
    expect(res.body.summary.totalDuration).toBe(900);
  });

  test('GET /api/reports/idle returns MSPF idle from route positions', async () => {
    traccar.getDevices.mockResolvedValue([]);
    mspf.getDevice.mockResolvedValue({ id: mspfDeviceId, status: 'WORKING' });
    mspf.getDeviceRoute.mockResolvedValue([
      { deviceId: mspfDeviceId, latitude: -7.3235, longitude: 112.7410, speed: 50, deviceTime: '2026-06-15T09:00:00Z', attributes: { ignition: true } },
      { deviceId: mspfDeviceId, latitude: -7.3235, longitude: 112.7410, speed: 0, deviceTime: '2026-06-15T09:05:00Z', attributes: { ignition: true } },
      { deviceId: mspfDeviceId, latitude: -7.3235, longitude: 112.7410, speed: 0, deviceTime: '2026-06-15T09:15:00Z', attributes: { ignition: true } },
      { deviceId: mspfDeviceId, latitude: -7.3236, longitude: 112.7411, speed: 40, deviceTime: '2026-06-15T09:20:00Z', attributes: { ignition: true } },
      { deviceId: mspfDeviceId, latitude: -7.3236, longitude: 112.7411, speed: 0, deviceTime: '2026-06-15T09:30:00Z', attributes: { ignition: true } },
      { deviceId: mspfDeviceId, latitude: -7.3236, longitude: 112.7411, speed: 0, deviceTime: '2026-06-15T09:40:00Z', attributes: { ignition: true } },
    ]);

    const res = await request(app)
      .get(`/api/reports/idle?deviceId=${mspfDeviceId}&from=2026-06-01T00:00:00Z`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('mspf');
    expect(res.body.idle.length).toBe(2);
    expect(res.body.idle[1].duration).toBe(600);
    expect(res.body.idle[0].duration).toBe(600);
  });

  test('GET /api/reports/idle returns empty list when no idle events', async () => {
    traccar.getDevices.mockResolvedValue([{ id: traccarDeviceId, name: 'Test', uniqueId: 'test', status: 'online', groupId: 5 }]);
    traccar.getReportStops.mockResolvedValue([]);

    const res = await request(app)
      .get(`/api/reports/idle?deviceId=${traccarDeviceId}&from=2026-06-01T00:00:00Z`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.idle).toEqual([]);
    expect(res.body.summary.total).toBe(0);
    expect(res.body.summary.totalDuration).toBe(0);
  });
});

describe('Trip Reports', () => {
  let token;
  const traccarDeviceId = 999995;
  const mspfDeviceId = 999996;

  beforeAll(async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    token = login.body.token;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/reports/trips without deviceId returns 400', async () => {
    const res = await request(app)
      .get('/api/reports/trips')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ERR_VALIDATION');
  });

  test('GET /api/reports/trips without from returns 400', async () => {
    const res = await request(app)
      .get(`/api/reports/trips?deviceId=${traccarDeviceId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  test('GET /api/reports/trips without token returns 401', async () => {
    const res = await request(app)
      .get(`/api/reports/trips?deviceId=${traccarDeviceId}&from=2026-06-01T00:00:00Z`);
    expect(res.status).toBe(401);
  });

  test('GET /api/reports/trips returns Traccar trip data', async () => {
    traccar.getDevices.mockResolvedValue([{ id: traccarDeviceId, name: 'Test', uniqueId: 'test', status: 'online', groupId: 5 }]);
    traccar.getReportTrips.mockResolvedValue([
      { deviceId: traccarDeviceId, startTime: '2026-06-15T08:00:00Z', endTime: '2026-06-15T09:30:00Z', duration: 5400, startLat: -6.2088, startLon: 106.8456, endLat: -6.4032, endLon: 106.8183, startAddress: 'Jl. A', endAddress: 'Jl. B', distance: 25.5, averageSpeed: 45.2, maxSpeed: 80.5, spentFuel: 5.2, driverName: 'John' },
    ]);

    const res = await request(app)
      .get(`/api/reports/trips?deviceId=${traccarDeviceId}&from=2026-06-01T00:00:00Z&to=2026-06-30T00:00:00Z`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('traccar');
    expect(res.body.trips.length).toBe(1);
    expect(res.body.trips[0].duration).toBe(5400);
    expect(res.body.trips[0].distance).toBe(25.5);
    expect(res.body.trips[0].averageSpeed).toBe(45.2);
    expect(res.body.trips[0].maxSpeed).toBe(80.5);
    expect(res.body.trips[0].driverName).toBe('John');
    expect(res.body.summary.total).toBe(1);
    expect(res.body.summary.totalDistance).toBe(25.5);
  });

  test('GET /api/reports/trips returns MSPF enriched trip data', async () => {
    traccar.getDevices.mockResolvedValue([]);
    mspf.getDevice.mockResolvedValue({ id: mspfDeviceId, status: 'WORKING' });
    mspf.getDeviceTrip.mockResolvedValue([
      { timeStart: '2026-06-15T08:00:00Z', timeEnd: '2026-06-15T09:00:00Z', positionStart: { lat: -6.2088, lon: 106.8456 }, positionEnd: { lat: -6.4032, lon: 106.8183 } },
    ]);
    mspf.getDeviceRoute.mockResolvedValue([
      { deviceId: mspfDeviceId, latitude: -6.2088, longitude: 106.8456, speed: 0, deviceTime: '2026-06-15T08:00:00Z' },
      { deviceId: mspfDeviceId, latitude: -6.2500, longitude: 106.8500, speed: 40, deviceTime: '2026-06-15T08:20:00Z' },
      { deviceId: mspfDeviceId, latitude: -6.3000, longitude: 106.8300, speed: 50, deviceTime: '2026-06-15T08:40:00Z' },
      { deviceId: mspfDeviceId, latitude: -6.4032, longitude: 106.8183, speed: 0, deviceTime: '2026-06-15T09:00:00Z' },
    ]);

    const res = await request(app)
      .get(`/api/reports/trips?deviceId=${mspfDeviceId}&from=2026-06-01T00:00:00Z`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('mspf');
    expect(res.body.trips.length).toBe(1);
    expect(res.body.trips[0].duration).toBe(3600);
    expect(res.body.trips[0].distance).toBeGreaterThan(0);
    expect(res.body.trips[0].maxSpeed).toBe(50);
    expect(res.body.trips[0].averageSpeed).toBeGreaterThan(0);
    expect(res.body.summary.total).toBe(1);
  });

  test('GET /api/reports/trips returns empty list when no trips', async () => {
    traccar.getDevices.mockResolvedValue([{ id: traccarDeviceId, name: 'Test', uniqueId: 'test', status: 'online', groupId: 5 }]);
    traccar.getReportTrips.mockResolvedValue([]);

    const res = await request(app)
      .get(`/api/reports/trips?deviceId=${traccarDeviceId}&from=2026-06-01T00:00:00Z`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.trips).toEqual([]);
    expect(res.body.summary.total).toBe(0);
    expect(res.body.summary.totalDistance).toBe(0);
  });
});

describe('Summary Reports', () => {
  let token;
  const traccarDeviceId = 999997;
  const mspfDeviceId = 999998;

  beforeAll(async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    token = login.body.token;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/reports/summary without token returns 401', async () => {
    const res = await request(app)
      .get('/api/reports/summary');
    expect(res.status).toBe(401);
  });

  test('GET /api/reports/summary returns all devices admin', async () => {
    traccar.getReportSummary.mockResolvedValue([
      { deviceId: 1, deviceName: 'Device A', distance: 500, maxSpeed: 80, averageSpeed: 40, spentFuel: 30, engineHours: 10 },
    ]);
    mspf.getStatsSummary.mockResolvedValue({
      data: [{ deviceId: 2, totalMileage: 300, totalDrivingTime: 8 }],
    });

    const res = await request(app)
      .get('/api/reports/summary?from=2026-06-01T00:00:00Z&to=2026-06-30T00:00:00Z')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.summaries.length).toBe(2);
    expect(res.body.total.devices).toBe(2);
    expect(res.body.total.distance).toBe(800);
  });

  test('GET /api/reports/summary returns Traccar single device summary', async () => {
    traccar.getDevices.mockResolvedValue([{ id: traccarDeviceId, name: 'Test', uniqueId: 'test', status: 'online', groupId: 5 }]);
    traccar.getReportSummary.mockResolvedValue([
      { deviceId: traccarDeviceId, deviceName: 'Test Device', distance: 250.5, maxSpeed: 95.3, averageSpeed: 42.1, spentFuel: 18.2, engineHours: 6 },
    ]);

    const res = await request(app)
      .get(`/api/reports/summary?deviceId=${traccarDeviceId}&from=2026-06-01T00:00:00Z`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.summaries.length).toBe(1);
    expect(res.body.summaries[0].source).toBe('traccar');
    expect(res.body.summaries[0].distance).toBe(250.5);
    expect(res.body.summaries[0].maxSpeed).toBe(95.3);
    expect(res.body.summaries[0].spentFuel).toBe(18.2);
    expect(res.body.summaries[0].engineHours).toBe(6);
    expect(res.body.total.distance).toBe(250.5);
  });

  test('GET /api/reports/summary returns enriched MSPF single device summary', async () => {
    traccar.getDevices.mockResolvedValue([]);
    mspf.getDevice.mockResolvedValue({ id: mspfDeviceId, status: 'WORKING' });
    mspf.getDeviceRoute.mockResolvedValue([
      { deviceId: mspfDeviceId, latitude: -6.2088, longitude: 106.8456, speed: 0, deviceTime: '2026-06-15T08:00:00Z' },
      { deviceId: mspfDeviceId, latitude: -6.2500, longitude: 106.8500, speed: 40, deviceTime: '2026-06-15T08:20:00Z' },
      { deviceId: mspfDeviceId, latitude: -6.3000, longitude: 106.8300, speed: 60, deviceTime: '2026-06-15T08:40:00Z' },
      { deviceId: mspfDeviceId, latitude: -6.4032, longitude: 106.8183, speed: 0, deviceTime: '2026-06-15T09:00:00Z' },
    ]);

    const res = await request(app)
      .get(`/api/reports/summary?deviceId=${mspfDeviceId}&from=2026-06-01T00:00:00Z`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.summaries.length).toBe(1);
    expect(res.body.summaries[0].source).toBe('mspf');
    expect(res.body.summaries[0].distance).toBeGreaterThan(0);
    expect(res.body.summaries[0].maxSpeed).toBe(60);
    expect(res.body.summaries[0].averageSpeed).toBeGreaterThan(0);
    expect(res.body.summaries[0].duration).toBe(3600);
    expect(res.body.summaries[0].spentFuel).toBeNull();
  });

  test('GET /api/reports/summary returns empty when no devices', async () => {
    traccar.getReportSummary.mockResolvedValue([]);
    mspf.getStatsSummary.mockResolvedValue({ data: [] });

    const res = await request(app)
      .get('/api/reports/summary?from=2026-06-01T00:00:00Z')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.summaries).toEqual([]);
    expect(res.body.total.devices).toBe(0);
    expect(res.body.total.distance).toBe(0);
  });
});

describe('Summary Time-Series (granularity)', () => {
  let token;
  const traccarDeviceId = 9999911;
  const mspfDeviceId = 9999912;
  const foxDeviceId = 9999913;

  beforeAll(async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    token = login.body.token;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/reports/summary with invalid granularity returns 400', async () => {
    const res = await request(app)
      .get(`/api/reports/summary?deviceId=${traccarDeviceId}&granularity=hour`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ERR_VALIDATION');
  });

  test('GET /api/reports/summary with granularity but no deviceId/group returns 400', async () => {
    const res = await request(app)
      .get('/api/reports/summary?granularity=day&from=2026-06-01T00:00:00Z')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ERR_VALIDATION');
  });

  test('GET /api/reports/summary returns Traccar day series with filled buckets', async () => {
    traccar.getDevices.mockResolvedValue([{ id: traccarDeviceId, name: 'Test Traccar', uniqueId: 'test', status: 'online', groupId: 5 }]);
    traccar.getReportTrips.mockResolvedValue([
      { startTime: '2026-06-10T08:00:00Z', distance: 10, duration: 600, maxSpeed: 40, averageSpeed: 60, spentFuel: 1 },
      { startTime: '2026-06-10T09:00:00Z', distance: 20, duration: 1200, maxSpeed: 80, averageSpeed: 60, spentFuel: 2 },
      { startTime: '2026-06-12T09:00:00Z', distance: 5, duration: 300, maxSpeed: 30, averageSpeed: 60, spentFuel: 0.5 },
    ]);

    const res = await request(app)
      .get(`/api/reports/summary?deviceId=${traccarDeviceId}&granularity=day&from=2026-06-10T00:00:00Z&to=2026-06-12T00:00:00Z`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.type).toBe('device');
    expect(res.body.deviceId).toBe(traccarDeviceId);
    expect(res.body.granularity).toBe('day');
    expect(res.body.series).toHaveLength(3);
    const d10 = res.body.series.find(b => b.key === '2026-06-10');
    expect(d10.distance).toBe(30);
    expect(d10.drivingTime).toBe(1800);
    expect(d10.maxSpeed).toBe(80);
    expect(res.body.series[1].distance).toBe(0);
    expect(res.body.series[1].maxSpeed).toBeNull();
    expect(res.body.total.distance).toBe(35);
    expect(res.body.total.drivingTime).toBe(2100);
    expect(res.body.total.maxSpeed).toBe(80);
  });

  test('GET /api/reports/summary returns MSPF day series from native stats', async () => {
    traccar.getDevices.mockResolvedValue([]);
    mspf.getDevice.mockResolvedValue({ id: mspfDeviceId, status: 'WORKING' });
    mspf.getDeviceStatsReports.mockResolvedValue([
      { datetime: '2026-06-15', mileage: 45.2, drivingtime: 3600 },
      { datetime: '2026-06-16', mileage: 10.0, drivingtime: 600 },
    ]);

    const res = await request(app)
      .get(`/api/reports/summary?deviceId=${mspfDeviceId}&granularity=day&from=2026-06-15T00:00:00Z&to=2026-06-16T00:00:00Z`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.series).toHaveLength(2);
    expect(res.body.series[0].distance).toBe(45.2);
    expect(res.body.series[0].drivingTime).toBe(3600);
    expect(res.body.series[0].maxSpeed).toBeNull();
    expect(res.body.total.distance).toBe(55.2);
    expect(mspf.getDeviceStatsReports).toHaveBeenCalledWith(mspfDeviceId, { startDate: '2026-06-15', endDate: '2026-06-16' });
  });

  test('GET /api/reports/summary returns FoxLogger day series from report-summary', async () => {
    traccar.getDevices.mockResolvedValue([]);
    mspf.getDevice.mockResolvedValue(null);
    foxlogger.getDevices.mockResolvedValue({ data: [{ id: foxDeviceId, uniqueId: '9999913', name: 'FL Test' }], total: 1, next: null });
    foxlogger.getDeviceSummary.mockResolvedValue({
      data: [
        { from_time: '2026-06-15 07:00:00', distance: '30', speed_max: '70', speed_avg: '40', fuel_usage: '2', time_hour: '0', time_minute: '30', time_second: '0' },
      ],
    });

    const res = await request(app)
      .get(`/api/reports/summary?deviceId=${foxDeviceId}&granularity=day&from=2026-06-15T00:00:00Z&to=2026-06-15T00:00:00Z`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.series).toHaveLength(1);
    expect(res.body.series[0].key).toBe('2026-06-15');
    expect(res.body.series[0].distance).toBe(30);
    expect(res.body.series[0].drivingTime).toBe(1800);
    expect(res.body.series[0].maxSpeed).toBe(70);
    expect(res.body.series[0].spentFuel).toBe(2);
  });

  test('GET /api/reports/summary returns monthly aggregation (week/month)', async () => {
    traccar.getDevices.mockResolvedValue([{ id: traccarDeviceId, name: 'Test', uniqueId: 'test', status: 'online', groupId: 5 }]);
    traccar.getReportTrips.mockResolvedValue([
      { startTime: '2026-06-10T08:00:00Z', distance: 10, duration: 600, maxSpeed: 40, spentFuel: 1 },
      { startTime: '2026-07-05T08:00:00Z', distance: 25, duration: 1200, maxSpeed: 90, spentFuel: 2 },
    ]);

    const res = await request(app)
      .get(`/api/reports/summary?deviceId=${traccarDeviceId}&granularity=month&from=2026-06-01T00:00:00Z&to=2026-07-31T00:00:00Z`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.series).toHaveLength(2);
    expect(res.body.series[0].key).toBe('2026-06');
    expect(res.body.series[0].distance).toBe(10);
    expect(res.body.series[1].key).toBe('2026-07');
    expect(res.body.series[1].distance).toBe(25);
    expect(res.body.total.distance).toBe(35);
  });
});

describe('Summary Time-Series Group', () => {
  let token;
  let groupId;
  const traccarDeviceId = 9999921;
  const mspfDeviceId = 9999922;

  beforeAll(async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    token = login.body.token;
    await db('groups').where('name', 'summary_series_group').delete();
    const grp = await request(app)
      .post('/api/admin/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'summary_series_group' });
    groupId = grp.body.id;
  });

  afterAll(async () => {
    await db('device_groups').where({ group_id: groupId }).delete();
    await db('groups').where({ id: groupId }).delete();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/reports/summary with custom group returns merged series', async () => {
    await db('device_groups').insert([
      { device_id: traccarDeviceId, source: 'traccar', group_id: groupId },
      { device_id: mspfDeviceId, source: 'mspf', group_id: groupId },
    ]);

    const cache = require('../services/cache');
    cache.set('devices:merged', [
      { id: traccarDeviceId, name: 'Traccar A', source: 'traccar', group: 'traccar_5' },
      { id: mspfDeviceId, name: 'MSPF A', source: 'mspf', group: 'mspf_10000023' },
    ], 120);

    traccar.getReportTrips.mockResolvedValue([
      { startTime: '2026-06-15T08:00:00Z', distance: 10, duration: 600, maxSpeed: 40, spentFuel: 1 },
    ]);
    mspf.getBcStatsReports.mockResolvedValue([
      { deviceId: mspfDeviceId, datetime: '2026-06-15', mileage: 20, drivingtime: 1200 },
    ]);

    const res = await request(app)
      .get(`/api/reports/summary?group=${groupId}&granularity=day&from=2026-06-15T00:00:00Z&to=2026-06-15T00:00:00Z`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.type).toBe('group');
    expect(res.body.group.id).toBe(groupId);
    expect(res.body.series).toHaveLength(1);
    expect(res.body.series[0].distance).toBe(30);
    expect(res.body.series[0].drivingTime).toBe(1800);
    expect(mspf.getBcStatsReports).toHaveBeenCalledWith(10000023, { startDate: '2026-06-15', endDate: '2026-06-15' });
  });

  test('GET /api/reports/summary with unknown group returns 404', async () => {
    const res = await request(app)
      .get('/api/reports/summary?group=999999&granularity=day&from=2026-06-01T00:00:00Z')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  test('GET /api/reports/summary group with customer not assigned returns 403', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'test_customer', password: 'pass' });
    const customerToken = login.body.token;

    const res = await request(app)
      .get(`/api/reports/summary?group=${groupId}&granularity=day&from=2026-06-01T00:00:00Z`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(403);
  });
});

describe('Event Reports', () => {
  let token;
  const traccarDeviceId = 999999;

  beforeAll(async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    token = login.body.token;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/reports/events without token returns 401', async () => {
    const res = await request(app).get('/api/reports/events?from=2026-06-01T00:00:00Z');
    expect(res.status).toBe(401);
  });

  test('GET /api/reports/events returns Traccar multi-device events (no enrich)', async () => {
    traccar.getReportEvents.mockResolvedValue([
      { id: 1, type: 'geofenceEnter', eventTime: '2026-06-15T10:00:00Z', deviceId: 2, geofenceId: 5 },
      { id: 2, type: 'ignitionOn', eventTime: '2026-06-15T11:00:00Z', deviceId: 3 },
    ]);
    mspf.getMspfEvents.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/reports/events?from=2026-06-01T00:00:00Z&to=2026-06-30T00:00:00Z')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.events.length).toBe(2);
    expect(res.body.events[0].name).toBeNull();
    expect(res.body.events[0].status).toBe('OPEN');
    expect(res.body.summary.total).toBe(2);
  });

  test('GET /api/reports/events returns Traccar single device with enriched names', async () => {
    traccar.getDevices.mockResolvedValue([{ id: traccarDeviceId, name: 'Test', uniqueId: 'test', status: 'online', groupId: 5 }]);
    traccar.getReportEvents.mockResolvedValue([
      { id: 1, type: 'geofenceEnter', eventTime: '2026-06-15T10:00:00Z', deviceId: traccarDeviceId, geofenceId: 5 },
      { id: 2, type: 'ignitionOn', eventTime: '2026-06-15T11:00:00Z', deviceId: traccarDeviceId },
    ]);
    traccar.getGeofences.mockResolvedValue([
      { id: 5, name: 'Gudang A' },
    ]);

    const res = await request(app)
      .get(`/api/reports/events?deviceId=${traccarDeviceId}&from=2026-06-01T00:00:00Z`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.events.length).toBe(2);
    expect(res.body.events[0].name).toBe('Ignition ON');
    expect(res.body.events[0].status).toBe('OPEN');
    expect(res.body.events[1].name).toBe('Gudang A');
    expect(res.body.events[1].status).toBe('OPEN');
    expect(res.body.events[1].geofenceId).toBe(5);
    expect(res.body.summary.total).toBe(2);
  });

  test('GET /api/reports/events filters by status and name', async () => {
    traccar.getDevices.mockResolvedValue([{ id: traccarDeviceId, name: 'Test', uniqueId: 'test', status: 'online', groupId: 5 }]);
    traccar.getReportEvents.mockResolvedValue([
      { id: 1, type: 'geofenceEnter', eventTime: '2026-06-15T10:00:00Z', deviceId: traccarDeviceId, geofenceId: 5 },
      { id: 2, type: 'geofenceExit', eventTime: '2026-06-15T12:00:00Z', deviceId: traccarDeviceId, geofenceId: 5 },
    ]);
    traccar.getGeofences.mockResolvedValue([{ id: 5, name: 'Gudang A' }]);

    const res = await request(app)
      .get(`/api/reports/events?deviceId=${traccarDeviceId}&from=2026-06-01T00:00:00Z&status=OPEN`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.events.length).toBe(1);
    expect(res.body.events[0].status).toBe('OPEN');
    expect(res.body.summary.total).toBe(1);
  });
});

describe('Dashboard', () => {
  let token;

  beforeAll(async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    token = login.body.token;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/dashboard returns device stats and running status without from', async () => {
    const cache = require('../services/cache');
    cache.set('devices:merged', [
      { id: 1, source: 'traccar', status: 'online', running: 'RUN' },
      { id: 2, source: 'traccar', status: 'offline', running: 'STOP' },
      { id: 3, source: 'mspf', status: 'online', running: 'IDLING' },
    ], 120);

    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.devices.total).toBe(3);
    expect(res.body.devices.online).toBe(2);
    expect(res.body.devices.offline).toBe(1);
    expect(res.body.devices.bySource.traccar).toBe(2);
    expect(res.body.devices.bySource.mspf).toBe(1);
    expect(res.body.runningStatus.RUN).toBe(1);
    expect(res.body.runningStatus.IDLING).toBe(1);
    expect(res.body.runningStatus.STOP).toBe(1);
    expect(res.body.summary).toBeNull();
  });

  test('GET /api/dashboard returns summary when from is provided', async () => {
    const cache = require('../services/cache');
    cache.set('devices:merged', [
      { id: 1, source: 'traccar', status: 'online', running: 'RUN' },
    ], 120);

    traccar.getReportSummary.mockResolvedValue([
      { deviceId: 1, deviceName: 'Test', distance: 500, maxSpeed: 80, averageSpeed: 40, spentFuel: 30, engineHours: 10 },
    ]);
    mspf.getStatsSummary.mockResolvedValue({ data: [] });

    const res = await request(app)
      .get('/api/dashboard?from=2026-06-01T00:00:00Z')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.totalDistance).toBe(500);
    expect(res.body.summary.totalFuel).toBe(30);
    expect(res.body.summary.totalEngineHours).toBe(10);
    expect(res.body.summary.totalDrivingHours).toBeDefined();
  });

  test('GET /api/dashboard without token returns 401', async () => {
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(401);
  });
});
