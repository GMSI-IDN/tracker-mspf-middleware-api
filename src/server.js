'use strict';

const http = require('http');
const app = require('./app');
const config = require('./config');
const { setupWebSocket, emitPosition, emitStatusFor } = require('./websocket');
const { startPositionSync, setEmitHooks } = require('./services/positionSync');
const mspf = require('./services/mspf');
const { getOrBuildDeviceCache } = require('./services/deviceCache');
const { logger } = require('./middleware/logger');
const { startEventLoopMonitor } = require('./utils/eventLoopMonitor');
const db = require('./db');

async function buildDeviceCache() {
  const merged = await getOrBuildDeviceCache();
  logger.info(`Device cache built: ${merged.length} devices`);
  return merged;
}

const server = http.createServer(app);

setupWebSocket(server);
startEventLoopMonitor();

setEmitHooks({
  onPosition: (item) => emitPosition(item),
  onStatus: (payload) => emitStatusFor(payload),
});

buildDeviceCache().then(() => {
  startPositionSync();
  mspf.startMccsWorker?.();
  const { runAutoSync } = require('./services/autoSync');
  Promise.resolve(runAutoSync?.()).catch(() => {});
});

server.listen(config.port, () => {
  logger.info(`API Gateway running on port ${config.port}`);
  logger.info(`Environment: ${config.env}`);
  logger.info(`Database driver: ${config.dbDriver}`);
  logger.info(`WebSocket path: ${config.websocket.path}`);
});

function shutdown(signal) {
  logger.info(`${signal} received. Shutting down gracefully...`);
  mspf.stopMccsWorker?.();
  server.close(() => {
    db.destroy().then(() => {
      logger.info('Server closed.');
      process.exit(0);
    });
  });
  setTimeout(() => {
    logger.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
