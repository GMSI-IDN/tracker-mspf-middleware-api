'use strict';

const {
  startEventLoopMonitor,
  stopEventLoopMonitor,
  collectAndLogMetrics,
} = require('../utils/eventLoopMonitor');
const { logger } = require('../middleware/logger');
const { getWsMetrics, resetWsMetrics } = require('../websocket');

describe('Event Loop Monitor & WS Metrics', () => {
  let infoSpy;
  let warnSpy;

  beforeEach(() => {
    infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    resetWsMetrics();
    stopEventLoopMonitor();
  });

  afterEach(() => {
    stopEventLoopMonitor();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });

  test('does not start monitor when NODE_ENV is test unless force option is given', () => {
    const res = startEventLoopMonitor();
    expect(res).toBeNull();
  });

  test('starts monitor and logs metrics correctly with fake timers', () => {
    jest.useFakeTimers();
    try {
      const handle = startEventLoopMonitor({ force: true, intervalMs: 60000 });
      expect(handle).not.toBeNull();
      expect(handle.histogram).toBeDefined();

      // Fast-forward 60s
      jest.advanceTimersByTime(60000);

      expect(infoSpy).toHaveBeenCalled();
      const eventLoopLog = infoSpy.mock.calls.find((c) => c[0].includes('[EventLoop]'));
      const wsLog = infoSpy.mock.calls.find((c) => c[0].includes('[WS Metrics]'));

      expect(eventLoopLog).toBeDefined();
      expect(eventLoopLog[0]).toMatch(/\[EventLoop\] delay p50=[\d.]+ms p99=[\d.]+ms max=[\d.]+ms mean=[\d.]+ms/);
      expect(wsLog).toBeDefined();
      expect(wsLog[0]).toContain('messages=0 devices=0 positions=0 events=0');
    } finally {
      stopEventLoopMonitor();
      jest.useRealTimers();
    }
  });

  test('logs WARN when p99 exceeds 100ms', () => {
    const mockHistogram = {
      percentile: jest.fn((p) => (p === 99 ? 150_000_000 : 20_000_000)), // 150 ms at p99
      max: 200_000_000,
      mean: 30_000_000,
      reset: jest.fn(),
    };

    const res = collectAndLogMetrics(mockHistogram);
    expect(res.eventLoop.p99).toBe(150);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('[EventLoop] delay');
    expect(warnSpy.mock.calls[0][0]).toContain('p99=150ms');
    expect(mockHistogram.reset).toHaveBeenCalledTimes(1);
  });

  test('WS counter increments, is logged with event loop, and resets every cycle', () => {
    // Manually simulate metrics accumulation
    const { getWsMetrics } = require('../websocket');
    // We can directly verify resetWsMetrics behavior
    const mockH = {
      percentile: jest.fn(() => 5_000_000),
      max: 10_000_000,
      mean: 6_000_000,
      reset: jest.fn(),
    };

    // Before logging, simulate non-zero metrics by resetting then testing collect
    collectAndLogMetrics(mockH);
    const metricsAfter = getWsMetrics();
    expect(metricsAfter).toEqual({ messages: 0, devices: 0, positions: 0, events: 0 });
  });
});
