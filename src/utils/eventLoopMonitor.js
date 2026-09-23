const { monitorEventLoopDelay } = require('perf_hooks');
const { logger } = require('../middleware/logger');
const { resetWsMetrics } = require('../websocket');

let histogram = null;
let monitorTimer = null;

function collectAndLogMetrics(h) {
  if (!h) return null;

  const p50 = Number(((h.percentile(50) || 0) / 1e6).toFixed(2));
  const p99 = Number(((h.percentile(99) || 0) / 1e6).toFixed(2));
  const max = Number(((h.max || 0) / 1e6).toFixed(2));
  const meanRaw = h.mean;
  const mean = Number.isNaN(meanRaw) || !meanRaw ? 0 : Number((meanRaw / 1e6).toFixed(2));

  const logMsg = `[EventLoop] delay p50=${p50}ms p99=${p99}ms max=${max}ms mean=${mean}ms`;
  if (p99 > 100) {
    logger.warn(logMsg, { p50, p99, max, mean });
  } else {
    logger.info(logMsg, { p50, p99, max, mean });
  }

  // WS metrics logged together, then reset
  const ws = resetWsMetrics ? resetWsMetrics() : { messages: 0, devices: 0, positions: 0, events: 0 };
  logger.info(`[WS Metrics] messages=${ws.messages} devices=${ws.devices} positions=${ws.positions} events=${ws.events}`, ws);

  h.reset();
  return { eventLoop: { p50, p99, max, mean }, ws };
}

function startEventLoopMonitor(options = {}) {
  const isTest = process.env.NODE_ENV === 'test';
  if (isTest && !options.force) {
    return null;
  }

  if (monitorTimer) {
    return { histogram, timer: monitorTimer };
  }

  const resolution = options.resolution || 20;
  const intervalMs = options.intervalMs || 60000;

  histogram = monitorEventLoopDelay({ resolution });
  histogram.enable();

  monitorTimer = setInterval(() => {
    collectAndLogMetrics(histogram);
  }, intervalMs);

  if (monitorTimer.unref) {
    monitorTimer.unref();
  }

  return { histogram, timer: monitorTimer };
}

function stopEventLoopMonitor() {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
  if (histogram) {
    histogram.disable();
    histogram.reset();
    histogram = null;
  }
}

module.exports = {
  startEventLoopMonitor,
  stopEventLoopMonitor,
  collectAndLogMetrics,
};
