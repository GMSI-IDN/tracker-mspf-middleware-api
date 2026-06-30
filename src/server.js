const http = require('http');
const app = require('./app');
const config = require('./config');
const { setupWebSocket } = require('./websocket');
const { logger } = require('./middleware/logger');
const db = require('./db');

const server = http.createServer(app);

setupWebSocket(server);

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
