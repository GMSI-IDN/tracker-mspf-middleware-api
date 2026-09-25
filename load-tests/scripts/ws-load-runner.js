'use strict';

/**
 * WebSocket Load Testing Harness for Socket.io v4
 *
 * Measures:
 * 1. Handshake latency (p50, p95, p99)
 * 2. Fan-out latency across clients (first client vs last client receiving same cycle)
 * 3. Disconnect and error rates
 * 4. Runner CPU and event loop delay
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { monitorEventLoopDelay } = require('perf_hooks');
const ioClient = require('socket.io-client');

// 1. Safety Preflight Check
const rootDir = path.resolve(__dirname, '../..');
const runEnv = { ...process.env, DOTENV_CONFIG_PATH: path.resolve(__dirname, '../.env.loadtest') };
console.log('='.repeat(75));
console.log('WEBSOCKET LOAD TEST RUNNER (Socket.io v4)');
console.log('='.repeat(75));
console.log('Step 1: Running Preflight Safety Gate...');
try {
  execSync('node -r dotenv/config load-tests/scripts/preflight.js', { stdio: 'inherit', cwd: rootDir, env: runEnv });
} catch (err) {
  console.error('\n❌ Preflight safety check failed. Aborting WebSocket load test.');
  process.exit(1);
}

// 2. Load Configuration
const TARGET_URL = process.env.TARGET_URL || 'http://127.0.0.1:3001';
const WS_PATH = process.env.WEBSOCKET_PATH || '/api/ws';
const TARGET_CONNECTIONS = parseInt(process.env.WS_CONNECTIONS || process.argv[2], 10) || 10;
const DURATION_SEC = parseInt(process.env.WS_DURATION || process.argv[3], 10) || 30;
const RAMP_UP_SEC = parseInt(process.env.WS_RAMP_UP || process.argv[4], 10) || 5;

// Load user pool
const usersPoolPath = path.resolve(__dirname, 'ws-users.json');
if (!fs.existsSync(usersPoolPath)) {
  console.log('Users pool not found. Generating realistic user pool...');
  execSync('node load-tests/scripts/seed-realistic-groups.js', { stdio: 'inherit', cwd: rootDir });
}
const usersPool = JSON.parse(fs.readFileSync(usersPoolPath, 'utf8'));

console.log(`\nConfiguring WebSocket Test:`);
console.log(`- Target URL:            ${TARGET_URL}${WS_PATH}`);
console.log(`- Target Connections:    ${TARGET_CONNECTIONS} sockets`);
console.log(`- Test Duration:         ${DURATION_SEC} seconds`);
console.log(`- Ramp-up Window:        ${RAMP_UP_SEC} seconds`);
console.log(`- User Pool Available:   ${usersPool.length} realistic users`);

// Metrics Storage
const handshakeTimes = [];
const fanOutDeltas = [];
const cycleEvents = new Map(); // key: "deviceId:time" -> { first: timestamp, last: timestamp, count: number }
let errorCount = 0;
let disconnectCount = 0;
let positionEventsCount = 0;
let statusEventsCount = 0;

const sockets = [];
const loopMonitor = monitorEventLoopDelay({ resolution: 20 });
loopMonitor.enable();

// Runner CPU sampling
const runnerCpuSamples = [];
const cpuInterval = setInterval(() => {
  try {
    const out = execSync(`ps -p ${process.pid} -o %cpu --no-headers`, { encoding: 'utf8' }).trim();
    const val = parseFloat(out);
    if (!isNaN(val)) runnerCpuSamples.push(val);
  } catch {}
}, 2000);

// Helper percentile
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

// Function to connect a single client
function connectClient(index) {
  const user = usersPool[index % usersPool.length];
  const connectStartTime = Date.now();

  const socket = ioClient(TARGET_URL, {
    path: WS_PATH,
    auth: { token: user.token },
    transports: ['polling', 'websocket'], // Mirrors frontend transport configuration
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
    timeout: 10000,
  });

  socket.on('connect', () => {
    const handshakeDuration = Date.now() - connectStartTime;
    handshakeTimes.push(handshakeDuration);
  });

  socket.on('connect_error', () => {
    errorCount++;
  });

  socket.on('disconnect', (reason) => {
    if (reason !== 'io client disconnect') {
      disconnectCount++;
    }
  });

  socket.on('position', (data) => {
    positionEventsCount++;
    const now = Date.now();
    const cycleKey = `${data.deviceId}:${data.deviceTime || data.serverTime || 'sync'}`;
    const existing = cycleEvents.get(cycleKey);
    // If no existing record, or if existing record is from a previous cycle (> 3 seconds ago)
    if (!existing || (now - existing.first) > 3000) {
      cycleEvents.set(cycleKey, { first: now, last: now, count: 1 });
    } else {
      existing.last = now;
      existing.count++;
      const delta = existing.last - existing.first;
      fanOutDeltas.push(delta);
    }
  });

  socket.on('device-status', () => {
    statusEventsCount++;
  });

  sockets.push(socket);
}

// Start connecting sockets over the ramp-up period
console.log(`\nConnecting ${TARGET_CONNECTIONS} clients over ${RAMP_UP_SEC}s...`);
const intervalBetweenClientsMs = (RAMP_UP_SEC * 1000) / TARGET_CONNECTIONS;
let connectedCount = 0;

const connectTimer = setInterval(() => {
  if (connectedCount < TARGET_CONNECTIONS) {
    connectClient(connectedCount);
    connectedCount++;
  } else {
    clearInterval(connectTimer);
    console.log(`All ${TARGET_CONNECTIONS} clients initiated. Holding connection for ${DURATION_SEC}s...`);
  }
}, Math.max(1, intervalBetweenClientsMs));

// Completion after test duration
setTimeout(() => {
  clearInterval(cpuInterval);
  loopMonitor.disable();

  console.log('\n' + '='.repeat(75));
  console.log(`WEBSOCKET TEST FINISHED — GENERATING METRICS SUMMARY`);
  console.log('='.repeat(75));

  // Compute metrics
  const handshakeStats = getPercentiles(handshakeTimes);
  const fanOutStats = getPercentiles(fanOutDeltas);
  const totalEvents = positionEventsCount + statusEventsCount;
  const errorRatePct = TARGET_CONNECTIONS > 0 ? ((errorCount + disconnectCount) / TARGET_CONNECTIONS) * 100 : 0;

  const loopLagP95 = (loopMonitor.percentile(95) || 0) / 1e6;
  const loopLagP99 = (loopMonitor.percentile(99) || 0) / 1e6;

  const avgRunnerCpu = runnerCpuSamples.length ? (runnerCpuSamples.reduce((a, b) => a + b, 0) / runnerCpuSamples.length).toFixed(1) : 'N/A';
  const maxRunnerCpu = runnerCpuSamples.length ? Math.max(...runnerCpuSamples).toFixed(1) : 'N/A';

  console.log(`\n1. KONEKSI & HANDSHAKE:`);
  console.log(`   - Connected Sockets:    ${handshakeTimes.length} / ${TARGET_CONNECTIONS} (${((handshakeTimes.length / TARGET_CONNECTIONS) * 100).toFixed(1)}%)`);
  console.log(`   - Handshake Latency:    p50: ${handshakeStats.p50}ms | p95: ${handshakeStats.p95}ms | p99: ${handshakeStats.p99}ms (Target: p95 < 200ms)`);
  console.log(`   - Handshake Target:     ${handshakeStats.p95 < 200 ? '✅ LOLOS' : '❌ MELEBIHI TARGET'}`);

  console.log(`\n2. BROADCAST & FAN-OUT:`);
  console.log(`   - Total Events Received: positions: ${positionEventsCount} | device-status: ${statusEventsCount}`);
  console.log(`   - Fan-Out Delivery Delta: p50: ${fanOutStats.p50}ms | p95: ${fanOutStats.p95}ms | p99: ${fanOutStats.p99}ms (Target: p95 < 500ms)`);
  console.log(`   - Fan-Out Target:       ${fanOutStats.p95 < 500 ? '✅ LOLOS' : '❌ MELEBIHI TARGET'}`);

  console.log(`\n3. STABILITAS & ERROR RATE:`);
  console.log(`   - Connection Errors:    ${errorCount}`);
  console.log(`   - Disconnects:          ${disconnectCount}`);
  console.log(`   - Total Error Rate:     ${errorRatePct.toFixed(3)}% (Target: < 0.1%)`);
  console.log(`   - Error Rate Target:    ${errorRatePct < 0.1 ? '✅ LOLOS' : '❌ MELEBIHI TARGET'}`);

  console.log(`\n4. RUNNER LOAD TESTER HEALTH:`);
  console.log(`   - Runner Event Loop Lag: p95: ${loopLagP95.toFixed(2)}ms | p99: ${loopLagP99.toFixed(2)}ms`);
  console.log(`   - Runner CPU Usage:     Avg ${avgRunnerCpu}% | Max ${maxRunnerCpu}%`);

  // Disconnect all sockets
  for (const s of sockets) {
    s.disconnect();
  }

  // Save report JSON
  const resultsDir = path.resolve(rootDir, 'load-tests/results');
  const reportData = {
    timestamp: new Date().toISOString(),
    scenario: `C-WS-${TARGET_CONNECTIONS}`,
    connections: TARGET_CONNECTIONS,
    durationSec: DURATION_SEC,
    handshake: handshakeStats,
    fanOut: fanOutStats,
    errors: { errorCount, disconnectCount, errorRatePct },
    runner: { loopLagP95, loopLagP99, avgRunnerCpu, maxRunnerCpu },
  };
  const reportFile = path.resolve(resultsDir, `ws-test-${TARGET_CONNECTIONS}vu-${Date.now()}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(reportData, null, 2), 'utf8');
  console.log(`\nSaved test metrics to ${reportFile}`);
  console.log('='.repeat(75));

  process.exit(0);
}, (DURATION_SEC + 2) * 1000);
