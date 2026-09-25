'use strict';

const path = require('path');
const fs = require('fs');
const ioClient = require('socket.io-client');

const TARGET_URL = process.env.TARGET_URL || 'http://127.0.0.1:3001';
const WS_PATH = process.env.WEBSOCKET_PATH || '/api/ws';
const usersPool = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'ws-users.json'), 'utf8'));

function getPercentiles(arr) {
  if (!arr || arr.length === 0) return { p50: 0, p95: 0, p99: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  return {
    p50: sorted[Math.floor(sorted.length * 0.50)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    p99: sorted[Math.floor(sorted.length * 0.99)],
  };
}

async function testC5a(userCount) {
  console.log('\n' + '='.repeat(80));
  console.log(`SKENARIO C5a (THUNDERING HERD): ${userCount} USERS IN 5 SECONDS`);
  console.log('='.repeat(80));

  const sockets = [];
  const handshakeTimes = [];
  const httpTimes = { devices: [], positions: [] };
  let errorCount = 0;

  const intervalMs = 5000 / userCount;
  console.log(`Spawning ${userCount} sockets + parallel HTTP (/api/devices & /api/positions) over 5s...`);

  for (let i = 0; i < userCount; i++) {
    const user = usersPool[i % usersPool.length];
    const t0 = Date.now();

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

    // Parallel HTTP cold page load requests
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

    await new Promise(r => setTimeout(r, Math.max(1, intervalMs)));
  }

  // Hold 10s to settle
  await new Promise(r => setTimeout(r, 10000));

  const hsStats = getPercentiles(handshakeTimes);
  const devStats = getPercentiles(httpTimes.devices);
  const posStats = getPercentiles(httpTimes.positions);

  const hsPass = hsStats.p95 <= 200;
  const devPass = devStats.p95 <= 800;
  const posPass = posStats.p95 <= 800;

  console.log(`\nRESULTS C5a (${userCount} USERS):`);
  console.log(`- Connected Sockets:     ${handshakeTimes.length} / ${userCount} (${((handshakeTimes.length / userCount) * 100).toFixed(1)}%)`);
  console.log(`- Handshake Latency:     p50: ${hsStats.p50} ms | p95: ${hsStats.p95} ms | p99: ${hsStats.p99} ms (Target < 200ms) -> ${hsPass ? '✅ PASS' : '❌ BREACH'}`);
  console.log(`- HTTP /api/devices:     p50: ${devStats.p50} ms | p95: ${devStats.p95} ms | p99: ${devStats.p99} ms (Target < 800ms) -> ${devPass ? '✅ PASS' : '❌ BREACH'}`);
  console.log(`- HTTP /api/positions:   p50: ${posStats.p50} ms | p95: ${posStats.p95} ms | p99: ${posStats.p99} ms (Target < 800ms) -> ${posPass ? '✅ PASS' : '❌ BREACH'}`);
  console.log(`- Connection Errors:     ${errorCount}`);

  for (const s of sockets) s.disconnect();
  await new Promise(r => setTimeout(r, 2000));

  return { userCount, hsStats, devStats, posStats, hsPass, devPass, posPass, errors: errorCount };
}

async function run() {
  const res50 = await testC5a(50);
  const res150 = await testC5a(150);

  const out = { timestamp: new Date().toISOString(), res50, res150 };
  fs.writeFileSync(path.resolve(__dirname, '../results/c5a-tiered-report.json'), JSON.stringify(out, null, 2), 'utf8');
}

run().catch(console.error);
