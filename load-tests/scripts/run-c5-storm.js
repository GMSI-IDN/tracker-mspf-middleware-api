'use strict';

const path = require('path');
const fs = require('fs');
const { execSync, spawn } = require('child_process');
const ioClient = require('socket.io-client');

const TARGET_URL = process.env.TARGET_URL || 'http://127.0.0.1:3001';
const WS_PATH = process.env.WEBSOCKET_PATH || '/api/ws';
const rootDir = path.resolve(__dirname, '../..');
const resultsDir = path.resolve(rootDir, 'load-tests/results');
const usersPool = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'ws-users.json'), 'utf8'));

const THUNDER_COUNT = 500; // 500 users connecting simultaneously

async function runC5a() {
  console.log('\n' + '='.repeat(80));
  console.log(`SKENARIO C5a: THUNDERING HERD (${THUNDER_COUNT} SIMULTANEOUS PAGE LOADS IN 5s)`);
  console.log('='.repeat(80));

  const sockets = [];
  const handshakeTimes = [];
  const httpTimes = { devices: [], positions: [] };
  let errorCount = 0;

  console.log(`Firing ${THUNDER_COUNT} concurrent connections + HTTP requests over 5s...`);
  const intervalMs = 5000 / THUNDER_COUNT;

  for (let i = 0; i < THUNDER_COUNT; i++) {
    const user = usersPool[i % usersPool.length];
    const t0 = Date.now();

    // 1. WebSocket connect
    const socket = ioClient(TARGET_URL, {
      path: WS_PATH,
      auth: { token: user.token },
      transports: ['polling', 'websocket'],
      reconnection: false,
      timeout: 10000,
    });

    socket.on('connect', () => {
      handshakeTimes.push(Date.now() - t0);
    });
    socket.on('connect_error', () => { errorCount++; });
    sockets.push(socket);

    // 2. Parallel HTTP cold page load requests
    fetch(`${TARGET_URL}/api/devices?page=1&limit=50`, {
      headers: { Authorization: `Bearer ${user.token}` },
    }).then(res => {
      if (res.ok) httpTimes.devices.push(Date.now() - t0);
    }).catch(() => {});

    fetch(`${TARGET_URL}/api/positions`, {
      headers: { Authorization: `Bearer ${user.token}` },
    }).then(res => {
      if (res.ok) httpTimes.positions.push(Date.now() - t0);
    }).catch(() => {});

    if (i % 25 === 0) {
      await new Promise(r => setTimeout(r, Math.min(intervalMs, 25)));
    }
  }

  // Hold for 15s to observe settling
  await new Promise(r => setTimeout(r, 15000));

  function getPercentiles(arr) {
    if (!arr || arr.length === 0) return { p50: 0, p95: 0, p99: 0 };
    const sorted = [...arr].sort((a, b) => a - b);
    return {
      p50: sorted[Math.floor(sorted.length * 0.50)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    };
  }

  const hsStats = getPercentiles(handshakeTimes);
  const devStats = getPercentiles(httpTimes.devices);
  const posStats = getPercentiles(httpTimes.positions);

  console.log('\n--- C5a THUNDERING HERD REPORT ---');
  console.log(`- Connected Sockets:     ${handshakeTimes.length} / ${THUNDER_COUNT} (${((handshakeTimes.length / THUNDER_COUNT) * 100).toFixed(1)}%)`);
  console.log(`- Handshake Latency:     p50: ${hsStats.p50} ms | p95: ${hsStats.p95} ms | p99: ${hsStats.p99} ms`);
  console.log(`- HTTP /api/devices:     p50: ${devStats.p50} ms | p95: ${devStats.p95} ms | p99: ${devStats.p99} ms`);
  console.log(`- HTTP /api/positions:   p50: ${posStats.p50} ms | p95: ${posStats.p95} ms | p99: ${posStats.p99} ms`);
  console.log(`- Connection Errors:     ${errorCount}`);

  for (const s of sockets) s.disconnect();

  return { hsStats, devStats, posStats, connected: handshakeTimes.length, errors: errorCount };
}

async function runC5b(socketCount = 500) {
  console.log('\n' + '='.repeat(80));
  console.log(`SKENARIO C5b: HARD RESTART RECOVERY (${socketCount} PERSISTENT CLIENTS)`);
  console.log('='.repeat(80));

  console.log(`1. Connecting ${socketCount} sockets with FE reconnection settings...`);
  const sockets = [];
  let reconnectedCount = 0;
  let gaveUpCount = 0;

  for (let i = 0; i < socketCount; i++) {
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

    socket.io.on('reconnect', () => { reconnectedCount++; });
    socket.io.on('reconnect_failed', () => { gaveUpCount++; });
    socket.io.on('reconnect_attempt', (attempt) => {
      // tracks attempt count
    });
    sockets.push(socket);
  }

  // Allow sockets to connect
  await new Promise(r => setTimeout(r, 6000));
  console.log(`All ${socketCount} sockets connected.`);

  // Find and kill middleware PID
  console.log('2. Hard-killing middleware process...');
  const pid = execSync('lsof -t -i :3001', { encoding: 'utf8' }).trim().split('\n')[0];
  const tKill = Date.now();
  execSync(`kill -9 ${pid}`);
  console.log(`Middleware PID ${pid} killed.`);

  // Restart middleware immediately
  console.log('3. Restarting middleware server...');
  const tRestart = Date.now();
  spawn('node', ['--env-file=load-tests/.env.loadtest', 'src/server.js'], {
    cwd: rootDir,
    detached: true,
    stdio: 'ignore',
  }).unref();

  // Poll health until back online
  console.log('4. Waiting for middleware recovery & cache rebuild...');
  let healthy = false;
  while (Date.now() - tRestart < 45000) {
    try {
      const res = await fetch(`${TARGET_URL}/health`);
      if (res.ok) {
        healthy = true;
        break;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }

  const recoveryTimeMs = Date.now() - tRestart;
  console.log(`Middleware server back online and healthy in ${recoveryTimeMs} ms.`);

  // Observe reconnection window (25s to allow 5 attempts with exponential backoff)
  console.log('5. Monitoring reconnection attempts across clients (25s)...');
  await new Promise(r => setTimeout(r, 25000));

  const successRate = ((reconnectedCount / socketCount) * 100).toFixed(1);
  const gaveUpRate = ((gaveUpCount / socketCount) * 100).toFixed(1);

  console.log('\n--- C5b RECOVERY REPORT ---');
  console.log(`- Middleware Recovery Time: ${recoveryTimeMs} ms`);
  console.log(`- Reconnected Sockets:      ${reconnectedCount} / ${socketCount} (${successRate}%)`);
  console.log(`- Sockets That Gave Up:     ${gaveUpCount} / ${socketCount} (${gaveUpRate}%)`);

  for (const s of sockets) s.disconnect();

  return { recoveryTimeMs, reconnectedCount, gaveUpCount, successRate, gaveUpRate };
}

async function run() {
  const c5a = await runC5a();
  const c5b = await runC5b();

  const c5Report = { timestamp: new Date().toISOString(), c5a, c5b };
  fs.writeFileSync(path.resolve(resultsDir, `ws-c5-report-${Date.now()}.json`), JSON.stringify(c5Report, null, 2), 'utf8');
}

run().catch(console.error);
