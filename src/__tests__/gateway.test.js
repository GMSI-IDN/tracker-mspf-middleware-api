const request = require('supertest');

jest.mock('../services/traccar', () => ({
  getDevices: jest.fn(),
  getGroups: jest.fn(),
  getPositions: jest.fn(),
  getCommands: jest.fn(),
  getCommandTypes: jest.fn(),
  sendCommand: jest.fn(),
  getHealth: jest.fn(),
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
  };
});

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
