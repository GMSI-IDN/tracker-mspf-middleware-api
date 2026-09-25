#!/usr/bin/env node
'use strict';

/**
 * Bukti kelengkapan MCCS worker dengan MOCK_MCCS_DELAY_MS=500.
 *
 * Menjalankan runMccsSyncOnce() berulang dengan mock API delay 500ms,
 * lalu melaporkan: time-to-100%, max age, req/s, stale count.
 *
 * Jalankan: node load-tests/scripts/prove-mccs-coverage.js
 */

process.env.LOG_LEVEL = 'warn';

const DEVICE_COUNT = parseInt(process.env.MOCK_DEVICE_COUNT || '1109', 10);
const MCCS_DELAY_MS = parseInt(process.env.MOCK_MCCS_DELAY_MS || '500', 10);
const CHUNK_SIZE = 50;
const INTERVAL_MS = 7000;
const EXPECTED_TICKS = Math.ceil(DEVICE_COUNT / CHUNK_SIZE);
const MAX_AGE_LIMIT_MS = 180000;

const origRequire = require('module').prototype.require;
const stubs = {
  '../services/traccar': { getPositions: async () => [], getDevices: async () => [] },
  '../services/foxlogger': { getPositions: async () => [], getDevices: async () => [], waitForInit: async () => {} },
  '../services/autoSync': { runAutoSync: async () => {} },
};
require('module').prototype.require = function(id) {
  if (stubs[id]) return stubs[id];
  return origRequire.call(this, id);
};

const cache = require('../../src/services/cache');
const mspf = require('../../src/services/mspf');

let callCount = 0;
const mockApi = {
  get: async (url) => {
    callCount++;
    await new Promise(r => setTimeout(r, MCCS_DELAY_MS));
    if (url.includes('/data/history')) {
      return { data: { data: [{ tid: 1, kph: 20, volt: 12.5 }] } };
    }
    return { data: {} };
  },
  interceptors: { response: { use: () => {} } },
};

function populateDevices(count) {
  const devices = [];
  for (let i = 1; i <= count; i++) {
    devices.push({ id: i, source: 'mspf', group: 'mspf_1' });
  }
  cache.set('devices:merged', devices, 6000);
}

async function runCycle(label) {
  console.log(`--- ${label} ---`);
  for (let i = 0; i < EXPECTED_TICKS; i++) {
    await mspf.runMccsSyncOnce();
    const stats = mspf.getMccsStats();
    if ((i + 1) % 5 === 0 || i === EXPECTED_TICKS - 1) {
      console.log(`  tick ${i + 1}/${EXPECTED_TICKS}: store=${stats.storeSize}, maxAge=${stats.maxAgeMs}ms, stale=${stats.staleCount}`);
    }
  }
  return mspf.getMccsStats();
}

async function main() {
  console.log(`\n=== MCCS Coverage Proof ===`);
  console.log(`Devices: ${DEVICE_COUNT}, Delay: ${MCCS_DELAY_MS}ms`);
  console.log(`Ticks/cycle: ${EXPECTED_TICKS}, Simulated cycle: ${(EXPECTED_TICKS * INTERVAL_MS / 1000).toFixed(0)}s`);
  console.log();

  mspf.resetMccsWorkerState();
  mspf.getApi = () => mockApi;
  populateDevices(DEVICE_COUNT);

  const startTime = Date.now();
  const stats1 = await runCycle('Cycle 1');
  const wallCycle1 = Date.now() - startTime;

  console.log(`\n  Time to 100%: ${stats1.timeToFullMs}ms (${(stats1.timeToFullMs / 1000).toFixed(1)}s)`);
  console.log(`  Max age: ${stats1.maxAgeMs}ms — ${stats1.maxAgeMs < MAX_AGE_LIMIT_MS ? '✅' : '❌'}`);
  console.log(`  Stale (>5min): ${stats1.staleCount} — ${stats1.staleCount === 0 ? '✅' : '❌'}`);
  console.log(`  Wall time: ${(wallCycle1 / 1000).toFixed(1)}s`);

  const stats2 = await runCycle('Cycle 2');

  console.log(`\n=== Summary ===`);
  console.log(`Time to 100% after startup: ${stats1.timeToFullMs}ms (${(stats1.timeToFullMs / 1000).toFixed(1)}s) — ${stats1.timeToFullMs > 0 && stats1.timeToFullMs < MAX_AGE_LIMIT_MS ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Max age (end cycle 1): ${stats1.maxAgeMs}ms — ${stats1.maxAgeMs < MAX_AGE_LIMIT_MS ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Max age (end cycle 2): ${stats2.maxAgeMs}ms — ${stats2.maxAgeMs < MAX_AGE_LIMIT_MS ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Stale count (cycle 2): ${stats2.staleCount} — ${stats2.staleCount === 0 ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Missing count (cycle 2): ${stats2.missingCount} — ${stats2.missingCount === 0 ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Store size: ${stats2.storeSize}/${DEVICE_COUNT} — ${stats2.storeSize === DEVICE_COUNT ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Total HTTP requests: ${callCount}`);

  const simulatedCycleSec = EXPECTED_TICKS * (INTERVAL_MS / 1000);
  console.log(`Simulated req/s to MSPF: ${(DEVICE_COUNT / simulatedCycleSec).toFixed(1)}`);

  const allPass = stats1.timeToFullMs > 0
    && stats1.timeToFullMs < MAX_AGE_LIMIT_MS
    && stats1.maxAgeMs < MAX_AGE_LIMIT_MS
    && stats2.maxAgeMs < MAX_AGE_LIMIT_MS
    && stats2.staleCount === 0
    && stats2.storeSize === DEVICE_COUNT;

  console.log(`\n${allPass ? '✅ ALL PASS' : '❌ SOME FAILURES'}`);

  mspf.resetMccsWorkerState();
  process.exit(allPass ? 0 : 1);
}

main().catch(err => {
  console.error('Proof script failed:', err);
  process.exit(1);
});
