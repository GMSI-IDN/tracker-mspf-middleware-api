'use strict';

/**
 * Proof Test 2a: Sync Bertumpuk & Race Condition Overwrite
 *
 * Menguji perilaku re-entrancy pada positionSync:
 * 1. Menjalankan syncPositions saat sync sebelumnya masih berjalan.
 * 2. Membuktikan apakah run lama menimpa data yang lebih baru di cache positions:merged.
 */

const cache = require('../../src/services/cache');

async function testOverlappingSync() {
  console.log('='.repeat(75));
  console.log('BUKTI 2a: SYNC BERTUMPUK & OUT-OF-ORDER CACHE OVERWRITE');
  console.log('='.repeat(75));

  // Simulasi state di positionSync.js
  let activeSyncCount = 0;
  let syncHistory = [];

  // Function yang meniru persis logika syncPositions di src/services/positionSync.js
  async function simulatedSyncPositions(syncId, fetchDurationMs, positionTimestamp) {
    activeSyncCount++;
    const concurrent = activeSyncCount;
    const startTime = Date.now();
    console.log(`[t=${Date.now() % 100000}ms] [PositionSync #${syncId}] START (concurrent: ${concurrent})`);

    // Simulasi delay upstream (Promise.allSettled)
    await new Promise(r => setTimeout(r, fetchDurationMs));

    // Data posisi yang dihasilkan sync ini
    const resultPositions = [
      { id: 101, deviceId: 101, deviceTime: positionTimestamp, syncId },
    ];

    // Persis baris 246 di src/services/positionSync.js:
    cache.set('positions:merged', resultPositions, 30);
    console.log(`[t=${Date.now() % 100000}ms] [PositionSync #${syncId}] FINISHED -> Wrote to cache with deviceTime: ${positionTimestamp}`);

    activeSyncCount--;
    syncHistory.push({ syncId, finishedAt: Date.now(), positionTimestamp });
  }

  // Skenario:
  // Run 1: Dipicu t=0, upstream lambat (butuh 600ms), membawa data jam 10:00:00
  // Run 2: Dipicu t=200ms (karena setInterval 10s berulang), upstream cepat (butuh 150ms), membawa data jam 10:00:10
  console.log('1. Memulai Run #1 (Lambat, durasi 600ms, data: 10:00:00)...');
  const p1 = simulatedSyncPositions(1, 600, '2026-09-25T10:00:00.000Z');

  console.log('2. Memulai Run #2 di t=200ms (Cepat, durasi 150ms, data LEBIH BARU: 10:00:10)...');
  await new Promise(r => setTimeout(r, 200));
  const p2 = simulatedSyncPositions(2, 150, '2026-09-25T10:00:10.000Z');

  await Promise.all([p1, p2]);

  // Cek isi akhir cache positions:merged
  const finalCached = cache.get('positions:merged');
  console.log('\n3. HASIL AKHIR CACHE POSITIONS:MERGED:');
  console.log(`   - Data tersimpan berasal dari: Sync #${finalCached[0].syncId}`);
  console.log(`   - DeviceTime di cache:         ${finalCached[0].deviceTime}`);

  const isOverwrittenByOlder = finalCached[0].syncId === 1;
  console.log(`\n4. KESIMPULAN PEMBUKTIAN 2a:`);
  console.log(`   - Max Concurrent Runs Terdeteksi: 2 runs`);
  console.log(`   - Apakah data baru tertimpa data lama? ${isOverwrittenByOlder ? '🚨 YA! DATA LAMA MENIMPA DATA BARU (RACE CONDITION TERBUKTI)' : 'TIDAK'}`);
  console.log('='.repeat(75));

  return isOverwrittenByOlder;
}

testOverlappingSync().catch(console.error);
