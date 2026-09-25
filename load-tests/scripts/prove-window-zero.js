'use strict';

/**
 * Proof Test 2b: Jendela "/0" & Thundering Herd Rebuild saat devices:merged Expired
 *
 * Menguji:
 * 1. Apakah customer dengan dynamic group sync menerima 0 kendaraan di /api/positions saat devices:merged expired.
 * 2. Berapa kali rebuild paralel terpicu saat ada 5 request bersamaan saat cache expired.
 */

const cache = require('../../src/services/cache');
const { getAllowedDeviceKeys } = require('../../src/services/groupMembership');
const db = require('../../src/db');

async function testWindowZero() {
  console.log('='.repeat(75));
  console.log('BUKTI 2b: JENDELA "/0" & MULTIPLE PARALLEL REBUILDS SAAT CACHE EXPIRED');
  console.log('='.repeat(75));

  await db.waitForMigration();

  // Setup: Master cache positions terisi 1.200 unit
  const dummyPositions = [];
  for (let i = 1; i <= 1200; i++) {
    dummyPositions.push({
      deviceId: i,
      source: i <= 90 ? 'traccar' : 'mspf',
      latitude: -6.2,
      longitude: 106.8,
    });
  }
  cache.set('positions:merged', dummyPositions, 30);

  // Setup: Grup 1 disinkronisasi dari MSPF BC 1 via group_sync_rules
  await db('group_sync_rules').delete();
  await db('group_sync_rules').insert({
    middleware_group_id: 1,
    source: 'mspf',
    source_group_id: 'mspf_1',
    source_group_name: 'BC 1',
  });

  // KONDISI NORMAL: devices:merged masih aktif di cache
  const activeDevices = [];
  for (let i = 1; i <= 1200; i++) {
    activeDevices.push({
      id: i,
      source: i <= 90 ? 'traccar' : 'mspf',
      group: i <= 90 ? 'traccar_1' : 'mspf_1',
      attributes: { bcId: 1 },
    });
  }
  cache.set('devices:merged', activeDevices, 120);

  const keysNormal = await getAllowedDeviceKeys([1]);
  console.log(`1. Kondisi Normal (devices:merged ada di cache):`);
  console.log(`   - Allowed Keys untuk Customer Group 1: ${keysNormal.size} unit kendaraan`);

  // KONDISI JENDELA "/0": devices:merged expired / kosong
  cache.del('devices:merged');
  console.log(`\n2. Kondisi Jendela "/0" (devices:merged expired / cache.del):`);
  const keysZero = await getAllowedDeviceKeys([1]);
  console.log(`   - Allowed Keys untuk Customer Group 1: ${keysZero.size} unit kendaraan`);

  // Evaluasi filter posisi
  const rawPositions = cache.get('positions:merged') || [];
  const filteredPositions = rawPositions.filter(p => keysZero.has(`${p.source}:${p.deviceId}`));
  console.log(`   - Posisi yang dikembalikan ke Customer: ${filteredPositions.length} unit (padahal cache positions ada ${rawPositions.length} unit!)`);
  console.log(`   -> Apakah customer kehilangan 100% kendaraan? ${filteredPositions.length === 0 ? '🚨 YA! DATA LENYAP (0 KENDARAAN)' : 'TIDAK'}`);

  // 3. Test Multi-Rebuild (Tanpa Single-Flight Mutex)
  console.log(`\n3. Menguji Rebuild Thundering Herd (5 request simultan saat cache miss):`);
  let upstreamFetchCount = 0;
  async function mockUpstreamFetch() {
    upstreamFetchCount++;
    await new Promise(r => setTimeout(r, 100)); // Simulasi latency upstream
    return [{ id: 101, name: 'Rebuilt Unit' }];
  }

  // Meniru persis fungsi getOrBuildDeviceCache() di src/routes/devices.js
  async function simulatedGetOrBuild() {
    let merged = cache.get('devices:merged');
    if (!merged) {
      const fetched = await mockUpstreamFetch();
      merged = fetched;
      cache.set('devices:merged', merged, 120);
    }
    return merged;
  }

  // 5 request datang bersamaan saat cache kosong
  upstreamFetchCount = 0;
  await Promise.all([
    simulatedGetOrBuild(),
    simulatedGetOrBuild(),
    simulatedGetOrBuild(),
    simulatedGetOrBuild(),
    simulatedGetOrBuild(),
  ]);

  console.log(`   - Jumlah request masuk: 5 request`);
  console.log(`   - Jumlah pemanggilan HTTP ke server upstream: ${upstreamFetchCount} kali`);
  console.log(`   -> Apakah terjadi duplicate redundant rebuilds? ${upstreamFetchCount === 5 ? '🚨 YA! 5x REBUILD REDUNDAN (Ketiadaan Single-Flight)' : 'TIDAK'}`);
  console.log('='.repeat(75));

  await db.destroy();
}

testWindowZero().catch(console.error);
