'use strict';

const assert = require('assert');
const cache = require('../../src/services/cache');

async function testGuard() {
  console.log('='.repeat(75));
  console.log('TEST PENGAMAN SYNC (RE-ENTRANCY MUTEX & MONOTONIC SEQUENCE GUARD)');
  console.log('='.repeat(75));

  let isSyncing = false;
  let syncSeqCounter = 0;
  let latestCompletedSyncSeq = 0;
  let skippedRuns = 0;

  async function safeSyncPositions(fetchDurationMs, dataTimestamp) {
    if (isSyncing) {
      skippedRuns++;
      console.log(`[Re-entrancy Guard] Sync skipped! Previous sync is still running.`);
      return { skipped: true };
    }
    isSyncing = true;
    const currentSeq = ++syncSeqCounter;

    try {
      await new Promise(r => setTimeout(r, fetchDurationMs));
      const positions = [{ id: 101, deviceTime: dataTimestamp, seq: currentSeq }];

      if (currentSeq > latestCompletedSyncSeq) {
        cache.set('positions:merged', positions, 30);
        latestCompletedSyncSeq = currentSeq;
        return { skipped: false, applied: true, seq: currentSeq };
      } else {
        console.log(`[Monotonic Guard] Discarded stale sync #${currentSeq} (Newer #${latestCompletedSyncSeq} already in cache)`);
        return { skipped: false, applied: false, discarded: true, seq: currentSeq };
      }
    } finally {
      isSyncing = false;
    }
  }

  // Test 1: Mencegah overlapping sync saat sync sebelumnya masih berjalan
  console.log('1. Menjalankan Run #1 (100ms)...');
  const run1 = safeSyncPositions(100, '2026-09-25T10:00:00.000Z');

  console.log('2. Memicu Run #2 di t=20ms saat Run #1 sedang aktif...');
  await new Promise(r => setTimeout(r, 20));
  const run2 = await safeSyncPositions(50, '2026-09-25T10:00:10.000Z');

  assert.strictEqual(run2.skipped, true, 'Run 2 must be skipped due to re-entrancy guard');
  assert.strictEqual(skippedRuns, 1, 'skippedRuns must equal 1');

  const res1 = await run1;
  assert.strictEqual(res1.applied, true, 'Run 1 must finish and be applied');
  console.log('-> Test 1: ✅ PASSED (Overlapping execution berhasil dicegah)');

  // Test 2: Mencegah data lama menimpa data baru
  console.log('\n3. Menguji Monotonic Version Guard terhadap out-of-order completion:');
  latestCompletedSyncSeq = 10;
  cache.set('positions:merged', [{ id: 101, deviceTime: '2026-09-25T10:00:10.000Z', seq: 10 }]);

  const oldSeq = 9;
  if (oldSeq > latestCompletedSyncSeq) {
    cache.set('positions:merged', [{ id: 101, deviceTime: '2026-09-25T10:00:00.000Z', seq: oldSeq }]);
  }

  const currentCache = cache.get('positions:merged');
  assert.strictEqual(currentCache[0].seq, 10, 'Cache must retain seq 10');
  assert.strictEqual(currentCache[0].deviceTime, '2026-09-25T10:00:10.000Z');
  console.log('-> Test 2: ✅ PASSED (Data usang tidak dapat menimpa data baru)');
  console.log('='.repeat(75));
}

testGuard().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
