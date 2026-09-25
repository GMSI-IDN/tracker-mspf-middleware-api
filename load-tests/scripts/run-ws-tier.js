'use strict';

const path = require('path');
const fs = require('fs');
const { execSync, spawn } = require('child_process');
const { monitorEventLoopDelay } = require('perf_hooks');
const ioClient = require('socket.io-client');

const targetConnections = parseInt(process.argv[2], 10) || 50;
const durationSec = parseInt(process.argv[3], 10) || 120;
const rampUpSec = parseInt(process.argv[4], 10) || 15;
const isC4 = process.argv.includes('--c4');

const TARGET_URL = process.env.TARGET_URL || 'http://127.0.0.1:3001';
const WS_PATH = process.env.WEBSOCKET_PATH || '/api/ws';
const rootDir = path.resolve(__dirname, '../..');
const resultsDir = path.resolve(rootDir, 'load-tests/results');
const usersPool = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'ws-users.json'), 'utf8'));

console.log('='.repeat(80));
console.log(`RUNNING WS TIER: ${targetConnections} VIRTUAL USERS (${durationSec}s duration, ramp-up ${rampUpSec}s)${isC4 ? ' [HYBRID C4 ACTIVE]' : ''}`);
console.log('='.repeat(80));

function getPercentiles(arr) {
  if (!arr || arr.length === 0) return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, mean: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.50)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return {
    p50: parseFloat(p50.toFixed(2)),
    p95: parseFloat(p95.toFixed(2)),
    p99: parseFloat(p99.toFixed(2)),
    min: parseFloat(min.toFixed(2)),
    max: parseFloat(max.toFixed(2)),
    mean: parseFloat(mean.toFixed(2)),
  };
}

async function execute() {
  const handshakeTimes = [];
  const fanOutDeltas = [];
  const cycleEvents = new Map();
  const clientCycleDeltas = [];
  const clientBurstTracker = new Map();

  let errorCount = 0;
  let disconnectCount = 0;
  let positionEventsCount = 0;
  let statusEventsCount = 0;
  let lastGlobalPositionAt = 0;

  const sockets = [];
  const loopMonitor = monitorEventLoopDelay({ resolution: 20 });
  loopMonitor.enable();

  const runnerCpuSamples = [];
  const cpuTimer = setInterval(() => {
    try {
      const out = execSync(`ps -p ${process.pid} -o %cpu --no-headers`, { encoding: 'utf8' }).trim();
      const val = parseFloat(out);
      if (!isNaN(val)) runnerCpuSamples.push(val);
    } catch {}
  }, 2000);

  // Hybrid C4 HTTP traffic
  const httpLatencies = { duringBroadcast: [], betweenBroadcasts: [] };
  let httpTimer = null;
  if (isC4) {
    const httpRate = Math.max(1, Math.round(targetConnections / 45));
    console.log(`[Hybrid C4] Spawning HTTP traffic at ~${httpRate} req/s...`);
    const intervalMs = Math.round(1000 / httpRate);
    const adminUser = usersPool.find(u => u.role === 'admin') || usersPool[0];

    httpTimer = setInterval(async () => {
      const isDuring = (Date.now() - lastGlobalPositionAt) < 2000;
      const targetEndpoint = Math.random() < 0.5 ? '/api/devices?page=1&limit=50' : '/api/positions';
      const t0 = Date.now();
      try {
        const res = await fetch(`${TARGET_URL}${targetEndpoint}`, {
          headers: { Authorization: `Bearer ${adminUser.token}` },
        });
        const elapsed = Date.now() - t0;
        if (res.ok) {
          if (isDuring) httpLatencies.duringBroadcast.push(elapsed);
          else httpLatencies.betweenBroadcasts.push(elapsed);
        }
      } catch {}
    }, intervalMs);
  }

  // Connect sockets
  const intervalBetween = (rampUpSec * 1000) / targetConnections;
  for (let i = 0; i < targetConnections; i++) {
    const user = usersPool[i % usersPool.length];
    const connectStartTime = Date.now();
    const socketIdx = i;

    const socket = ioClient(TARGET_URL, {
      path: WS_PATH,
      auth: { token: user.token },
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      timeout: 10000,
    });

    socket.on('connect', () => {
      handshakeTimes.push(Date.now() - connectStartTime);
    });

    socket.on('connect_error', () => { errorCount++; });
    socket.on('disconnect', (reason) => {
      if (reason !== 'io client disconnect') disconnectCount++;
    });

    socket.on('position', (data) => {
      positionEventsCount++;
      const now = Date.now();
      lastGlobalPositionAt = now;

      const cycleKey = `${data.deviceId}:${data.deviceTime || data.serverTime || 'sync'}`;
      const existing = cycleEvents.get(cycleKey);
      if (!existing || (now - existing.first) > 3000) {
        cycleEvents.set(cycleKey, { first: now, last: now, count: 1 });
      } else {
        existing.last = now;
        existing.count++;
        fanOutDeltas.push(existing.last - existing.first);
      }

      let burst = clientBurstTracker.get(socketIdx);
      if (!burst || (now - burst.last) > 3000) {
        if (burst && burst.count > 1) {
          clientCycleDeltas.push(burst.last - burst.start);
        }
        clientBurstTracker.set(socketIdx, { start: now, last: now, count: 1 });
      } else {
        burst.last = now;
        burst.count++;
      }
    });

    socket.on('device-status', () => { statusEventsCount++; });
    sockets.push(socket);

    if (intervalBetween > 0 && (i % 25 === 0 || intervalBetween >= 10)) {
      await new Promise(r => setTimeout(r, Math.min(intervalBetween, 50)));
    }
  }

  console.log(`Connecting finished. Holding connections for ${durationSec}s...`);
  await new Promise(r => setTimeout(r, durationSec * 1000));

  if (httpTimer) clearInterval(httpTimer);
  clearInterval(cpuTimer);
  loopMonitor.disable();

  for (const burst of clientBurstTracker.values()) {
    if (burst && burst.count > 1) clientCycleDeltas.push(burst.last - burst.start);
  }
  for (const s of sockets) s.disconnect();

  const handshakeStats = getPercentiles(handshakeTimes);
  const fanOutStats = getPercentiles(fanOutDeltas);
  const cycleDurationStats = getPercentiles(clientCycleDeltas);
  const totalErrors = errorCount + disconnectCount;
  const errorRatePct = targetConnections > 0 ? (totalErrors / targetConnections) * 100 : 0;

  const runnerLagP95 = (loopMonitor.percentile(95) || 0) / 1e6;
  const runnerLagP99 = (loopMonitor.percentile(99) || 0) / 1e6;
  const avgRunnerCpu = runnerCpuSamples.length ? (runnerCpuSamples.reduce((a, b) => a + b, 0) / runnerCpuSamples.length).toFixed(1) : 0;
  const maxRunnerCpu = runnerCpuSamples.length ? Math.max(...runnerCpuSamples).toFixed(1) : 0;

  const httpDuringStats = getPercentiles(httpLatencies.duringBroadcast);
  const httpBetweenStats = getPercentiles(httpLatencies.betweenBroadcasts);

  const handshakePass = handshakeStats.p95 <= 200;
  const fanOutPass = fanOutStats.p95 <= 500;
  const errorPass = errorRatePct <= 0.1;
  const cyclePass = cycleDurationStats.p95 <= 3000;
  const runnerPass = runnerLagP95 <= 50 && parseFloat(maxRunnerCpu) <= 80;

  console.log(`\nTIER ${targetConnections} RESULTS:`);
  console.log(`- Connected Sockets:    ${handshakeTimes.length} / ${targetConnections}`);
  console.log(`- Handshake p95:        ${handshakeStats.p95} ms (Target < 200 ms) -> ${handshakePass ? '✅ PASS' : '❌ BREACH'}`);
  console.log(`- Fan-Out Delta p95:    ${fanOutStats.p95} ms (Target < 500 ms) -> ${fanOutPass ? '✅ PASS' : '❌ BREACH'}`);
  console.log(`- Satu Siklus p95:      ${cycleDurationStats.p95} ms (Target < 3000 ms) -> ${cyclePass ? '✅ PASS' : '❌ BREACH'}`);
  console.log(`- Error Rate:           ${errorRatePct.toFixed(3)}% (Target < 0.1%) -> ${errorPass ? '✅ PASS' : '❌ BREACH'}`);
  console.log(`- Runner Lag p95:       ${runnerLagP95.toFixed(2)} ms | CPU Max: ${maxRunnerCpu}% -> ${runnerPass ? '✅ HEALTHY' : '⚠️ BOTTLENECK'}`);

  if (isC4) {
    console.log(`- HTTP p95 Saat Broadcast:   ${httpDuringStats.p95} ms`);
    console.log(`- HTTP p95 Antara Broadcast: ${httpBetweenStats.p95} ms`);
  }

  const outResult = {
    tier: targetConnections,
    handshake: handshakeStats,
    fanOut: fanOutStats,
    cycleDuration: cycleDurationStats,
    errors: { errorCount, disconnectCount, totalErrors, errorRatePct },
    runner: { runnerLagP95, runnerLagP99, avgRunnerCpu, maxRunnerCpu },
    http: isC4 ? { during: httpDuringStats, between: httpBetweenStats } : null,
    pass: handshakePass && fanOutPass && errorPass && cyclePass && runnerPass,
    breaches: { handshake: !handshakePass, fanOut: !fanOutPass, cycle: !cyclePass, error: !errorPass, runner: !runnerPass }
  };

  const outFile = path.resolve(resultsDir, `ws-tier-${targetConnections}-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(outResult, null, 2), 'utf8');
  console.log(`Saved result to ${outFile}`);
  console.log('='.repeat(80));

  process.exit(outResult.pass ? 0 : 2);
}

execute().catch(err => {
  console.error(err);
  process.exit(1);
});
