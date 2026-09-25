'use strict';

/**
 * 45-Minute Soak Test (150 Concurrent WebSocket Connections)
 *
 * Runs for 45 minutes. Logs memory (Heap & RSS) and socket health every minute.
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const ioClient = require('socket.io-client');

const TARGET_URL = process.env.TARGET_URL || 'http://127.0.0.1:3001';
const WS_PATH = process.env.WEBSOCKET_PATH || '/api/ws';
const CONNECTIONS = 150;
const DURATION_MINUTES = 45;
const DURATION_MS = DURATION_MINUTES * 60 * 1000;

const rootDir = path.resolve(__dirname, '../..');
const resultsDir = path.resolve(rootDir, 'load-tests/results');
if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

const usersPool = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'ws-users.json'), 'utf8'));

// Find Middleware PID
let middlewarePid = null;
try {
  middlewarePid = execSync('lsof -t -i :3001', { encoding: 'utf8' }).trim().split('\n')[0];
} catch {}

const logFile = path.resolve(resultsDir, 'soak-150vu-45m.log');
const jsonOutputFile = path.resolve(resultsDir, 'soak-150vu-45m.json');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(logFile, line + '\n', 'utf8');
}

log(`=== STARTING 45-MINUTE SOAK TEST (${CONNECTIONS} Sockets) ===`);
log(`Target: ${TARGET_URL}${WS_PATH} | Middleware PID: ${middlewarePid || 'Unknown'}`);

const sockets = [];
let errorCount = 0;
let disconnectCount = 0;
let totalPositionsReceived = 0;

for (let i = 0; i < CONNECTIONS; i++) {
  const user = usersPool[i % usersPool.length];
  const socket = ioClient(TARGET_URL, {
    path: WS_PATH,
    auth: { token: user.token },
    transports: ['polling', 'websocket'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
  });

  socket.on('connect_error', () => { errorCount++; });
  socket.on('disconnect', (reason) => {
    if (reason !== 'io client disconnect') disconnectCount++;
  });
  socket.on('position', () => { totalPositionsReceived++; });

  sockets.push(socket);
}

log(`All ${CONNECTIONS} sockets initiated. Monitoring every minute for ${DURATION_MINUTES} minutes...`);

const metricsHistory = [];
const startTime = Date.now();
let minuteCounter = 0;

const monitorInterval = setInterval(() => {
  minuteCounter++;
  const elapsedMinutes = ((Date.now() - startTime) / 60000).toFixed(1);

  // Measure middleware RSS / memory if PID available
  let middlewareRssMb = 'N/A';
  if (middlewarePid) {
    try {
      const out = execSync(`ps -p ${middlewarePid} -o rss --no-headers`, { encoding: 'utf8' }).trim();
      const rssKb = parseInt(out, 10);
      if (!isNaN(rssKb)) middlewareRssMb = (rssKb / 1024).toFixed(1);
    } catch {}
  }

  // Measure runner memory
  const runnerMem = process.memoryUsage();
  const runnerHeapMb = (runnerMem.heapUsed / 1024 / 1024).toFixed(1);
  const runnerRssMb = (runnerMem.rss / 1024 / 1024).toFixed(1);

  const entry = {
    minute: minuteCounter,
    elapsedMinutes,
    middlewareRssMb: middlewareRssMb !== 'N/A' ? parseFloat(middlewareRssMb) : null,
    runnerHeapMb: parseFloat(runnerHeapMb),
    runnerRssMb: parseFloat(runnerRssMb),
    connectedSockets: sockets.filter(s => s.connected).length,
    totalPositionsReceived,
    disconnectCount,
    errorCount,
  };

  metricsHistory.push(entry);
  log(`Minute ${minuteCounter}/${DURATION_MINUTES} | Middleware RSS: ${middlewareRssMb} MB | Runner Heap: ${runnerHeapMb} MB | Active Sockets: ${entry.connectedSockets}/${CONNECTIONS} | Disconnects: ${disconnectCount}`);

  // Flush JSON progress snapshot
  fs.writeFileSync(jsonOutputFile, JSON.stringify({
    status: 'IN_PROGRESS',
    startTime: new Date(startTime).toISOString(),
    durationMinutes: DURATION_MINUTES,
    connections: CONNECTIONS,
    history: metricsHistory,
  }, null, 2), 'utf8');

  if (minuteCounter >= DURATION_MINUTES) {
    clearInterval(monitorInterval);
    log('=== 45-MINUTE SOAK TEST COMPLETED ===');

    for (const s of sockets) s.disconnect();

    fs.writeFileSync(jsonOutputFile, JSON.stringify({
      status: 'COMPLETED',
      startTime: new Date(startTime).toISOString(),
      endTime: new Date().toISOString(),
      durationMinutes: DURATION_MINUTES,
      connections: CONNECTIONS,
      history: metricsHistory,
    }, null, 2), 'utf8');

    process.exit(0);
  }
}, 60000);
