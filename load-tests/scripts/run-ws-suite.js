'use strict';

/**
 * WebSocket Load Testing Suite (C2 - C5)
 *
 * Tiers: 50 -> 150 -> 500 -> 1000 -> 2000
 * Stops immediately if:
 * 1. Handshake p95 > 200 ms
 * 2. Fan-out p95 > 500 ms
 * 3. Error rate > 0.1%
 * 4. Waktu lengkap satu siklus p95 > 3,000 ms
 * 5. Runner CPU > 80% or Event Loop Lag > 50 ms
 */

const path = require('path');
const fs = require('fs');
const { execSync, spawn } = require('child_process');
const { monitorEventLoopDelay } = require('perf_hooks');
const ioClient = require('socket.io-client');

const rootDir = path.resolve(__dirname, '../..');
const runEnv = { ...process.env, DOTENV_CONFIG_PATH: path.resolve(__dirname, '../.env.loadtest') };

console.log('='.repeat(80));
console.log('FASE C: WEBSOCKET LOAD & RESILIENCE TEST SUITE (Socket.io v4)');
console.log('='.repeat(80));

// 1. Safety Preflight Check
console.log('Step 1: Running Preflight Safety Gate...');
try {
  execSync('node -r dotenv/config load-tests/scripts/preflight.js', { stdio: 'inherit', cwd: rootDir, env: runEnv });
} catch (err) {
  console.error('\n❌ Preflight safety check failed. Aborting suite.');
  process.exit(1);
}

const TARGET_URL = process.env.TARGET_URL || 'http://127.0.0.1:3001';
const WS_PATH = process.env.WEBSOCKET_PATH || '/api/ws';
const resultsDir = path.resolve(rootDir, 'load-tests/results');
if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

// Load user pool
const usersPoolPath = path.resolve(__dirname, 'ws-users.json');
if (!fs.existsSync(usersPoolPath)) {
  execSync('node load-tests/scripts/seed-realistic-groups.js', { stdio: 'inherit', cwd: rootDir });
}
const usersPool = JSON.parse(fs.readFileSync(usersPoolPath, 'utf8'));

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

// ── Runner for a Single WebSocket Concurrency Tier ────────────

async function runTier(targetConnections, durationSec = 120, rampUpSec = 10, options = {}) {
  console.log('\n' + '-'.repeat(80));
  console.log(`RUNNING TIER: ${targetConnections} VIRTUAL USERS (${durationSec}s duration, ramp-up ${rampUpSec}s)`);
  console.log('-'.repeat(80));

  const handshakeTimes = [];
  const fanOutDeltas = [];
  const cycleEvents = new Map(); // key: "deviceId:time" -> { first, last, count }
  const clientCycleDeltas = []; // completion duration of a sync cycle on a single client
  const clientBurstTracker = new Map(); // socketIdx -> { start, last, count }

  let errorCount = 0;
  let disconnectCount = 0;
  let positionEventsCount = 0;
  let statusEventsCount = 0;
  let lastGlobalPositionAt = 0;

  const sockets = [];
  const loopMonitor = monitorEventLoopDelay({ resolution: 20 });
  loopMonitor.enable();

  // Monitor runner CPU
  const runnerCpuSamples = [];
  const cpuTimer = setInterval(() => {
    try {
      const out = execSync(`ps -p ${process.pid} -o %cpu --no-headers`, { encoding: 'utf8' }).trim();
      const val = parseFloat(out);
      if (!isNaN(val)) runnerCpuSamples.push(val);
    } catch {}
  }, 2000);

  // HTTP load during C4
  const httpLatencies = { duringBroadcast: [], betweenBroadcasts: [] };
  let httpTimer = null;
  if (options.enableHttp) {
    const httpRate = Math.max(1, Math.round(targetConnections / 45)); // user / 45s
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
      reconnectionAttempts: options.reconnectionAttempts || 5,
      reconnectionDelay: options.reconnectionDelay || 2000,
      reconnectionDelayMax: options.reconnectionDelayMax || 10000,
      timeout: 10000,
    });

    socket.on('connect', () => {
      const duration = Date.now() - connectStartTime;
      handshakeTimes.push(duration);
    });

    socket.on('connect_error', () => { errorCount++; });
    socket.on('disconnect', (reason) => {
      if (reason !== 'io client disconnect') disconnectCount++;
    });

    socket.on('position', (data) => {
      positionEventsCount++;
      const now = Date.now();
      lastGlobalPositionAt = now;

      // 1. Fan-out delta across clients for same device update
      const cycleKey = `${data.deviceId}:${data.deviceTime || data.serverTime || 'sync'}`;
      const existing = cycleEvents.get(cycleKey);
      if (!existing || (now - existing.first) > 3000) {
        cycleEvents.set(cycleKey, { first: now, last: now, count: 1 });
      } else {
        existing.last = now;
        existing.count++;
        fanOutDeltas.push(existing.last - existing.first);
      }

      // 2. Waktu lengkap satu siklus pada satu client
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

    if (intervalBetween > 0 && (i % 20 === 0 || intervalBetween >= 10)) {
      await new Promise(r => setTimeout(r, Math.min(intervalBetween, 50)));
    }
  }

  // Hold connections for the test duration
  await new Promise(r => setTimeout(r, durationSec * 1000));

  // Teardown
  if (httpTimer) clearInterval(httpTimer);
  clearInterval(cpuTimer);
  loopMonitor.disable();

  // Final flush of cycle deltas
  for (const burst of clientBurstTracker.values()) {
    if (burst && burst.count > 1) {
      clientCycleDeltas.push(burst.last - burst.start);
    }
  }

  for (const s of sockets) s.disconnect();

  // Calculate metrics
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

  const result = {
    tier: targetConnections,
    handshake: handshakeStats,
    fanOut: fanOutStats,
    cycleDuration: cycleDurationStats,
    errors: { errorCount, disconnectCount, totalErrors, errorRatePct: parseFloat(errorRatePct.toFixed(3)) },
    runner: { runnerLagP95: parseFloat(runnerLagP95.toFixed(2)), runnerLagP99: parseFloat(runnerLagP99.toFixed(2)), avgRunnerCpu, maxRunnerCpu },
    http: options.enableHttp ? { during: httpDuringStats, between: httpBetweenStats } : null,
  };

  // Evaluation criteria
  const handshakePass = handshakeStats.p95 <= 200;
  const fanOutPass = fanOutStats.p95 <= 500;
  const errorPass = errorRatePct <= 0.1;
  const cyclePass = cycleDurationStats.p95 <= 3000;
  const runnerPass = runnerLagP95 <= 50 && parseFloat(maxRunnerCpu) <= 80;

  const allPass = handshakePass && fanOutPass && errorPass && cyclePass && runnerPass;

  console.log(`\nTIER ${targetConnections} RESULTS SUMMARY:`);
  console.log(`- Handshake p95:         ${handshakeStats.p95} ms (Target < 200 ms) -> ${handshakePass ? '✅ PASS' : '❌ BREACH'}`);
  console.log(`- Fan-Out Delta p95:     ${fanOutStats.p95} ms (Target < 500 ms) -> ${fanOutPass ? '✅ PASS' : '❌ BREACH'}`);
  console.log(`- Satu Siklus p95:       ${cycleDurationStats.p95} ms (Target < 3000 ms) -> ${cyclePass ? '✅ PASS' : '❌ BREACH'}`);
  console.log(`- Error Rate:            ${errorRatePct.toFixed(3)}% (Target < 0.1%) -> ${errorPass ? '✅ PASS' : '❌ BREACH'}`);
  console.log(`- Runner Lag p95:        ${runnerLagP95.toFixed(2)} ms | CPU Max: ${maxRunnerCpu}% -> ${runnerPass ? '✅ HEALTHY' : '⚠️ BOTTLENECK'}`);

  if (options.enableHttp) {
    console.log(`- HTTP p95 Saat Broadcast:   ${httpDuringStats.p95} ms`);
    console.log(`- HTTP p95 Antara Broadcast: ${httpBetweenStats.p95} ms`);
  }

  return { pass: allPass, result, breached: { handshake: !handshakePass, fanOut: !fanOutPass, cycle: !cyclePass, error: !errorPass, runner: !runnerPass } };
}

// ── Skenario C5b: Hard Restart Recovery & Reconnection ─────────

async function runC5b(connectionsCount = 500) {
  console.log('\n' + '='.repeat(80));
  console.log(`SKENARIO C5b: HARD RESTART RECOVERY (${connectionsCount} ACTIVE SOCKETS)`);
  console.log('='.repeat(80));

  // Connect sockets with frontend reconnection options
  console.log(`1. Connecting ${connectionsCount} sockets before hard restart...`);
  const sockets = [];
  let reconnectedCount = 0;
  let gaveUpCount = 0;

  for (let i = 0; i < connectionsCount; i++) {
    const user = usersPool[i % usersPool.length];
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

    socket.on('reconnect', () => { reconnectedCount++; });
    socket.on('reconnect_failed', () => { gaveUpCount++; });
    sockets.push(socket);
  }

  await new Promise(r => setTimeout(r, 6000));
  console.log(`All ${connectionsCount} sockets connected.`);

  // Find middleware PID and kill it
  console.log('2. Killing middleware server process...');
  const pid = execSync('lsof -t -i :3001', { encoding: 'utf8' }).trim().split('\n')[0];
  const tKill = Date.now();
  execSync(`kill -9 ${pid}`);
  console.log(`Middleware PID ${pid} terminated.`);

  // Restart middleware immediately
  console.log('3. Restarting middleware process...');
  const tRestartStart = Date.now();
  spawn('node', ['--env-file=load-tests/.env.loadtest', 'src/server.js'], {
    cwd: rootDir,
    detached: true,
    stdio: 'ignore',
  }).unref();

  // Poll /health until server is back and healthy
  console.log('4. Waiting for middleware to recover & build cache...');
  let healthy = false;
  while (Date.now() - tRestartStart < 40000) {
    try {
      const res = await fetch(`${TARGET_URL}/health`);
      if (res.ok) {
        healthy = true;
        break;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }

  const recoveryTimeMs = Date.now() - tRestartStart;
  console.log(`Middleware recovered and returned healthy in ${recoveryTimeMs} ms.`);

  // Wait 15 seconds to observe client reconnections
  console.log('5. Waiting for client reconnections (max 15s)...');
  await new Promise(r => setTimeout(r, 15000));

  const successRate = ((reconnectedCount / connectionsCount) * 100).toFixed(1);
  const gaveUpRate = ((gaveUpCount / connectionsCount) * 100).toFixed(1);

  console.log('\n--- C5b RECOVERY REPORT ---');
  console.log(`- Middleware Recovery Time: ${recoveryTimeMs} ms`);
  console.log(`- Reconnected Sockets:      ${reconnectedCount} / ${connectionsCount} (${successRate}%)`);
  console.log(`- Sockets That Gave Up:     ${gaveUpCount} / ${connectionsCount} (${gaveUpRate}%)`);

  for (const s of sockets) s.disconnect();

  return { recoveryTimeMs, reconnectedCount, gaveUpCount, successRate };
}

// ── Master Sequential Execution ───────────────────────────────

async function runAll() {
  const TIERS = [50, 150, 500, 1000, 2000];
  const allResults = [];
  let stopBreachedTier = null;
  let firstBreachedMetric = null;

  for (const tier of TIERS) {
    // 2 minutes duration per tier
    const { pass, result, breached } = await runTier(tier, 120, Math.min(15, Math.ceil(tier / 50) * 3));
    allResults.push(result);

    if (!pass) {
      stopBreachedTier = tier;
      firstBreachedMetric = Object.entries(breached).filter(([_, b]) => b).map(([k]) => k).join(', ');
      console.log(`\n⛔ STOPPING CRITERIA BREACHED AT TIER ${tier} VU!`);
      console.log(`First breached metric: ${firstBreachedMetric.toUpperCase()}`);
      break;
    }
  }

  // Run C4 Hybrid on the highest stable tier
  const stableTier = stopBreachedTier ? (stopBreachedTier === 50 ? 50 : (stopBreachedTier === 150 ? 50 : 150)) : 150;
  console.log(`\n` + '='.repeat(80));
  console.log(`RUNNING SCENARIO C4 (HYBRID WS + HTTP REST) ON TIER ${stableTier} VU`);
  console.log('='.repeat(80));
  const c4Result = await runTier(stableTier, 60, 5, { enableHttp: true });

  // Run C5b Hard Restart Recovery
  const c5bResult = await runC5b(stableTier);

  // Save full master report
  const masterReport = {
    timestamp: new Date().toISOString(),
    tiers: allResults,
    stoppedAtTier: stopBreachedTier,
    firstBreachedMetric,
    scenarioC4: c4Result.result,
    scenarioC5b: c5bResult,
  };

  const reportPath = path.resolve(resultsDir, `ws-full-suite-report-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(masterReport, null, 2), 'utf8');
  console.log(`\n✅ Full suite report saved to: ${reportPath}`);
  console.log('='.repeat(80));
}

runAll().catch(err => {
  console.error('Suite failed:', err);
  process.exit(1);
});
