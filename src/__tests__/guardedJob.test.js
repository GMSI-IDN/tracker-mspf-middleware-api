'use strict';

const { guardedJob } = require('../utils/guardedJob');

const silentLogger = {
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
};
jest.mock('../middleware/logger', () => ({ logger: silentLogger }));

describe('guardedJob — reusable concurrency guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('executes job and returns completed status with result', async () => {
    const run = guardedJob({
      name: 'test',
      timeoutMs: 5000,
      jobFn: async () => 42,
    });
    const result = await run();
    expect(result).toEqual({ status: 'completed', result: 42 });
  });

  test('passes args through to jobFn after isActive', async () => {
    const run = guardedJob({
      name: 'test',
      timeoutMs: 5000,
      jobFn: async (isActive, a, b) => a + b,
    });
    const result = await run(3, 7);
    expect(result).toEqual({ status: 'completed', result: 10 });
  });

  test('skips second call while first is running', async () => {
    let resolve;
    const run = guardedJob({
      name: 'test',
      timeoutMs: 5000,
      jobFn: async () => new Promise(r => { resolve = r; }),
    });
    const p1 = run();
    const p2 = run();
    const r2 = await p2;
    expect(r2).toEqual({ status: 'skipped', reason: 'already_running' });
    resolve('done');
    const r1 = await p1;
    expect(r1.status).toBe('completed');
  });

  test('isActive returns true during execution, false after', async () => {
    let capturedIsActive;
    const run = guardedJob({
      name: 'test',
      timeoutMs: 5000,
      jobFn: async (isActive) => { capturedIsActive = isActive(); },
    });
    expect(run.isRunning()).toBe(false);
    await run();
    expect(capturedIsActive).toBe(true);
    expect(run.isRunning()).toBe(false);
  });

  test('lock released after error — next run succeeds', async () => {
    let attempt = 0;
    const run = guardedJob({
      name: 'test',
      timeoutMs: 5000,
      jobFn: async () => {
        attempt++;
        if (attempt === 1) throw new Error('boom');
        return 'ok';
      },
    });
    const r1 = await run();
    expect(r1.status).toBe('error');
    expect(r1.error.message).toBe('boom');
    const r2 = await run();
    expect(r2).toEqual({ status: 'completed', result: 'ok' });
  });

  test('stale run result after watchdog is reported as stale', async () => {
    jest.useFakeTimers();
    try {
      const resolvers = [];
      const run = guardedJob({
        name: 'test',
        timeoutMs: 100,
        jobFn: async () => new Promise(r => { resolvers.push(r); }),
      });

      const p1 = run();
      await jest.advanceTimersByTimeAsync(150);
      expect(run.isRunning()).toBe(false);

      const p2 = run();
      resolvers[1]('fresh-value');
      const r2 = await p2;
      expect(r2.status).toBe('completed');
      expect(r2.result).toBe('fresh-value');

      resolvers[0]('stale-value');
      const r1 = await p1;
      expect(r1.status).toBe('stale');
      expect(r1.result).toBe('stale-value');
    } finally {
      jest.useRealTimers();
    }
  });

  test('stale run finally does not release lock held by active run', async () => {
    jest.useFakeTimers();
    try {
      let resolve1;
      const run = guardedJob({
        name: 'test',
        timeoutMs: 100,
        jobFn: async (isActive, label) => {
          if (label === 'hung') return new Promise(r => { resolve1 = r; });
          return new Promise(r => setTimeout(() => r('run2-done'), 50));
        },
      });

      const p1 = run('hung');
      await jest.advanceTimersByTimeAsync(150);

      const p2 = run('run2');
      expect(run.isRunning()).toBe(true);

      resolve1('stale');
      const r1 = await p1;
      expect(r1.status).toBe('stale');
      expect(run.isRunning()).toBe(true);

      await jest.advanceTimersByTimeAsync(100);
      const r2 = await p2;
      expect(r2.status).toBe('completed');
      expect(r2.result).toBe('run2-done');
    } finally {
      jest.useRealTimers();
    }
  });

  test('getElapsed returns 0 when not running', () => {
    const run = guardedJob({
      name: 'test',
      timeoutMs: 5000,
      jobFn: async () => {},
    });
    expect(run.getElapsed()).toBe(0);
  });

  test('monotonic clock: Date.now() jumping forward does not cause premature timeout or false elapsed', async () => {
    jest.useFakeTimers();
    const realDateNow = Date.now;
    let clockOffset = 0;
    Date.now = jest.fn(() => realDateNow() + clockOffset);

    try {
      let resolveJob;
      const run = guardedJob({
        name: 'test-jump-forward',
        timeoutMs: 5000,
        jobFn: async () => new Promise(r => { resolveJob = r; }),
      });

      const p1 = run();
      expect(run.isRunning()).toBe(true);

      // Advance timers by 500ms
      await jest.advanceTimersByTimeAsync(500);

      // Simulate wall-clock jumping 1 hour into the future (e.g. NTP or WSL2 jump)
      clockOffset = 3600 * 1000;

      // Elapsed should be based on performance.now() (~500ms), NOT 1 hour (3600500ms)!
      const elapsed = run.getElapsed();
      expect(elapsed).toBeLessThan(1000);
      expect(elapsed).toBeGreaterThanOrEqual(100);

      // Second call during this time: should be skipped as already_running (< 5000ms), NOT timed out!
      const p2 = run();
      const r2 = await p2;
      expect(r2).toEqual({ status: 'skipped', reason: 'already_running' });

      resolveJob('done');
      const r1 = await p1;
      expect(r1.status).toBe('completed');
    } finally {
      Date.now = realDateNow;
      jest.useRealTimers();
    }
  });

  test('monotonic clock: Date.now() jumping backward does not produce negative duration', async () => {
    jest.useFakeTimers();
    const realDateNow = Date.now;
    let clockOffset = 0;
    Date.now = jest.fn(() => realDateNow() + clockOffset);

    try {
      let resolveJob;
      const run = guardedJob({
        name: 'test-jump-backward',
        timeoutMs: 5000,
        jobFn: async () => new Promise(r => { resolveJob = r; }),
      });

      const p1 = run();
      await jest.advanceTimersByTimeAsync(500);

      // Simulate wall-clock jumping 1 hour into the past
      clockOffset = -3600 * 1000;

      // Elapsed must stay positive and accurate (~500ms), NOT negative (-3,599,500ms)
      expect(run.getElapsed()).toBeGreaterThanOrEqual(100);
      expect(run.getElapsed()).toBeLessThan(1000);

      resolveJob('ok');
      const r1 = await p1;
      expect(r1.status).toBe('completed');

      // Verify logger logged positive duration
      const infoCalls = silentLogger.info.mock.calls.map(([msg]) => msg);
      const completionLog = infoCalls.find(msg => typeof msg === 'string' && msg.includes('[test-jump-backward] completed in'));
      expect(completionLog).toBeDefined();
      expect(completionLog).toMatch(/completed in \d+ms/);
      expect(completionLog).not.toMatch(/completed in -\d+/);
    } finally {
      Date.now = realDateNow;
      jest.useRealTimers();
    }
  });

  test('throws on invalid parameters', () => {
    expect(() => guardedJob({ timeoutMs: 5000, jobFn: async () => {} })).toThrow(TypeError);
    expect(() => guardedJob({ name: 'x', timeoutMs: -1, jobFn: async () => {} })).toThrow(TypeError);
    expect(() => guardedJob({ name: 'x', timeoutMs: 5000 })).toThrow(TypeError);
  });
});
