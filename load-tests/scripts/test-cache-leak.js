const jwt = require('jsonwebtoken');

console.log('='.repeat(75));
console.log('TEST URUTAN REQUEST: Admin -> Customer A -> Admin -> Customer B');
console.log('Fokus: /api/devices dan /api/positions (Isolasi Data, Jumlah ID & customGroups)');
console.log('='.repeat(75));

// Master simulated cache in memory (simulating cache.get with useClones: false)
const masterDevices = [
  {
    id: 101,
    name: 'MSPF Truck 101',
    source: 'mspf',
    group: 'mspf_1',
    status: 'online',
    attributes: { volt: 12.5, power: 12.5, fuel: 80 },
  },
  {
    id: 102,
    name: 'Traccar Van 102',
    source: 'traccar',
    group: 'traccar_2',
    status: 'online',
    attributes: { volt: 13.0, power: 13.0, fuel: 95 },
  },
];

const masterPositions = [
  {
    deviceId: 101,
    source: 'mspf',
    latitude: -6.2,
    longitude: 106.8,
    speed: 30,
    attributes: { volt: 12.5, power: 12.5, fuel: 80 },
  },
  {
    deviceId: 102,
    source: 'traccar',
    latitude: -6.1,
    longitude: 106.9,
    speed: 45,
    attributes: { volt: 13.0, power: 13.0, fuel: 95 },
  },
];

// Mapping of custom groups in DB:
// Device 101 -> Group 1
// Device 102 -> Group 2
const deviceGroupMap = {
  'mspf:101': [{ id: 1, name: 'Fleet Alpha (Group 1)' }],
  'traccar:102': [{ id: 2, name: 'Fleet Beta (Group 2)' }],
};

// Handler for GET /api/devices with our proposed shallow-copy fix
function handleGetDevices(user) {
  const isAdmin = user.role === 'admin';
  const userGroups = user.groups || [];

  // Read from cache (useClones: false - direct reference)
  const allDevices = masterDevices;

  // Filter & attach customGroups with SHALLOW COPY:
  const filtered = [];
  for (const d of allDevices) {
    const key = `${d.source}:${d.id}`;
    const allCustomGroups = deviceGroupMap[key] || [];

    if (!isAdmin) {
      if (userGroups.length === 0) continue;
      const hasAccess = allCustomGroups.some((g) => userGroups.includes(g.id));
      if (!hasAccess) continue;
    }

    const visibleCustomGroups = allCustomGroups.filter((g) => isAdmin || userGroups.includes(g.id));

    // SHALLOW COPY BOUNDARY:
    filtered.push({
      ...d,
      customGroups: visibleCustomGroups,
      attributes: d.attributes ? { ...d.attributes } : {},
    });
  }

  // Sanitization
  if (!isAdmin) {
    return filtered.map((d) => {
      const copy = { ...d };
      delete copy.source;
      delete copy.group;
      return copy;
    });
  }
  return filtered;
}

// Handler for GET /api/positions with our proposed shallow-copy fix
function handleGetPositions(user) {
  const isAdmin = user.role === 'admin';
  const userGroups = user.groups || [];

  // Read from cache (useClones: false - direct reference)
  const cachedPositions = masterPositions;

  // SHALLOW COPY BOUNDARY:
  let positions = cachedPositions.map((p) => ({
    ...p,
    attributes: p.attributes ? { ...p.attributes } : {},
  }));

  if (!isAdmin) {
    if (userGroups.length === 0) {
      positions = [];
    } else {
      positions = positions.filter((p) => {
        const key = `${p.source}:${p.deviceId}`;
        const groups = deviceGroupMap[key] || [];
        return groups.some((g) => userGroups.includes(g.id));
      });
    }
    // Apply customer attribute sanitization
    for (let i = 0; i < positions.length; i++) {
      delete positions[i].source;
      positions[i].attributes = {}; // Masked
    }
  }

  return positions;
}

// ── EXECUTE REQUEST SEQUENCE ─────────────────────────────────

console.log('\n--- 1. REQUEST ADMIN (Awal) ---');
const devAdmin1 = handleGetDevices({ role: 'admin' });
const posAdmin1 = handleGetPositions({ role: 'admin' });
console.log(`Devices Count: ${devAdmin1.length} (Expected: 2) | IDs: ${devAdmin1.map((d) => d.id).join(', ')}`);
console.log(`Device 101 Source: ${devAdmin1[0].source} (Expected: mspf) | Groups: ${devAdmin1[0].customGroups.map((g) => g.id).join(',')}`);
console.log(`Positions Count: ${posAdmin1.length} (Expected: 2) | Pos 101 Source: ${posAdmin1[0].source}`);

console.log('\n--- 2. REQUEST CUSTOMER A (Group [1] Saja) ---');
const devCustA = handleGetDevices({ role: 'customer', groups: [1] });
const posCustA = handleGetPositions({ role: 'customer', groups: [1] });
console.log(`Devices Count: ${devCustA.length} (Expected: 1) | IDs: ${devCustA.map((d) => d.id).join(', ')}`);
console.log(`Device 101 Source: ${devCustA[0].source} (Expected: undefined)`);
console.log(`Device 101 customGroups: ${JSON.stringify(devCustA[0].customGroups)} (Expected: only group 1)`);
console.log(`Positions Count: ${posCustA.length} (Expected: 1) | DeviceId: ${posCustA[0].deviceId} | Source: ${posCustA[0].source} (undefined)`);
const custAOk = devCustA.length === 1 && devCustA[0].id === 101 && devCustA[0].source === undefined && posCustA.length === 1 && posCustA[0].deviceId === 101;
console.log(`-> Status Customer A: ${custAOk ? '✅ PASSED' : '❌ FAILED'}`);

console.log('\n--- 3. REQUEST ADMIN (Pemeriksaan Kebocoran Setelah Customer A) ---');
const devAdmin2 = handleGetDevices({ role: 'admin' });
const posAdmin2 = handleGetPositions({ role: 'admin' });
console.log(`Devices Count: ${devAdmin2.length} (Expected: 2) | IDs: ${devAdmin2.map((d) => d.id).join(', ')}`);
console.log(`Device 101 Source: ${devAdmin2[0].source} (Expected: mspf)`);
console.log(`Device 101 customGroups: ${JSON.stringify(devAdmin2[0].customGroups)} (Expected: intact with group 1)`);
console.log(`Position 101 Source: ${posAdmin2[0].source} (Expected: mspf) | Fuel: ${posAdmin2[0].attributes?.fuel} (Expected: 80)`);
const adminLeakCheck = devAdmin2.length === 2 && devAdmin2[0].source === 'mspf' && posAdmin2[0].source === 'mspf' && posAdmin2[0].attributes?.fuel === 80;
console.log(`-> Status Integritas Admin: ${adminLeakCheck ? '✅ PASSED (Tidak Bocor!)' : '❌ FAILED (Terkontaminasi!)'}`);

console.log('\n--- 4. REQUEST CUSTOMER B (Group [2] Saja) ---');
const devCustB = handleGetDevices({ role: 'customer', groups: [2] });
const posCustB = handleGetPositions({ role: 'customer', groups: [2] });
console.log(`Devices Count: ${devCustB.length} (Expected: 1) | IDs: ${devCustB.map((d) => d.id).join(', ')} (Expected ID: 102)`);
console.log(`Device 102 Source: ${devCustB[0].source} (Expected: undefined)`);
console.log(`Device 102 customGroups: ${JSON.stringify(devCustB[0].customGroups)} (Expected: only group 2)`);
console.log(`Positions Count: ${posCustB.length} (Expected: 1) | DeviceId: ${posCustB[0].deviceId} (Expected: 102)`);
const custBOk = devCustB.length === 1 && devCustB[0].id === 102 && devCustB[0].source === undefined && posCustB.length === 1 && posCustB[0].deviceId === 102;
console.log(`-> Status Customer B: ${custBOk ? '✅ PASSED (Terisolasi dari Customer A & Admin)' : '❌ FAILED'}`);

console.log('\n--- 5. INTEGRITAS MASTER CACHE DI MEMORI ---');
console.log('Master Device 101 in Cache:', masterDevices[0]);
console.log('Master Position 101 in Cache:', masterPositions[0]);
const masterPristine =
  masterDevices[0].source === 'mspf' &&
  masterDevices[0].customGroups === undefined && // never mutated into master cache!
  masterPositions[0].source === 'mspf' &&
  masterPositions[0].attributes.fuel === 80;

console.log(`-> Status Cache Utama: ${masterPristine ? '✅ 100% IMMUTABLE & TIDAK TERMUTASI' : '❌ CORRUPTED'}`);
console.log('='.repeat(75));
