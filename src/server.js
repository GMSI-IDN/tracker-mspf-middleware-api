const http = require('http');
const app = require('./app');
const config = require('./config');
const { setupWebSocket } = require('./websocket');
const { startPositionSync } = require('./services/positionSync');
const traccar = require('./services/traccar');
const mspf = require('./services/mspf');
const deviceRouter = require('./services/deviceRouter');
const cache = require('./services/cache');
const { logger } = require('./middleware/logger');
const db = require('./db');

async function buildDeviceCache() {
  const [traccarResult, mspfResult] = await Promise.allSettled([
    traccar.getDevices({ all: true }),
    mspf.waitForInit().then(() => mspf.getDevices()),
  ]);

  const merged = [];
  if (traccarResult.status === 'fulfilled' && traccarResult.value) {
    for (const d of traccarResult.value) merged.push({
      id: d.id, name: d.name, uniqueId: d.uniqueId,
      status: d.status || 'offline', source: 'traccar', group: `traccar_${d.groupId}`,
      voltage: d.attributes?.power ?? undefined,
      attributes: d.attributes || {},
    });
  }
  if (mspfResult.status === 'fulfilled' && mspfResult.value?.data) {
    merged.push(...mspfResult.value.data);
  }

  merged.sort((a, b) => {
    if (a.id !== b.id) return a.id - b.id;
    if (a.source < b.source) return -1;
    if (a.source > b.source) return 1;
    return 0;
  });

  deviceRouter.buildDeviceMap(merged);
  cache.set('devices:merged', merged, config.cache.ttl || 120);
  logger.info(`Device cache built: ${merged.length} devices`);
}

const server = http.createServer(app);

setupWebSocket(server);
buildDeviceCache().then(() => startPositionSync());

server.listen(config.port, () => {
  logger.info(`API Gateway running on port ${config.port}`);
  logger.info(`Environment: ${config.env}`);
  logger.info(`Database driver: ${config.dbDriver}`);
  logger.info(`WebSocket path: ${config.websocket.path}`);
});

function shutdown(signal) {
  logger.info(`${signal} received. Shutting down gracefully...`);
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
