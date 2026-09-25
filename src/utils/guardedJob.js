'use strict';

function guardedJob({ name, timeoutMs, jobFn }) {
  if (!name || typeof name !== 'string') throw new TypeError('guardedJob: name is required');
  if (typeof timeoutMs !== 'number' || timeoutMs <= 0) throw new TypeError('guardedJob: timeoutMs must be a positive number');
  if (typeof jobFn !== 'function') throw new TypeError('guardedJob: jobFn must be a function');

  let currentRunId = null;
  let startedAt = 0;

  async function run(...args) {
    if (currentRunId !== null) {
      const elapsed = Date.now() - startedAt;
      if (elapsed < timeoutMs) {
        const { logger } = require('../middleware/logger');
        logger.warn(`[${name}] previous run still in progress (${elapsed}ms), skipping tick`);
        return { status: 'skipped', reason: 'already_running' };
      }
      const { logger } = require('../middleware/logger');
      logger.error(`[${name}] previous run timed out after ${elapsed}ms! Watchdog releasing lock.`);
      currentRunId = null;
    }

    const runId = Symbol(name);
    currentRunId = runId;
    startedAt = Date.now();

    let watchdogTimer = null;
    let wasOwner = false;

    try {
      watchdogTimer = setTimeout(() => {
        if (currentRunId === runId) {
          const { logger } = require('../middleware/logger');
          logger.error(`[${name}] watchdog fired after ${timeoutMs}ms! Releasing lock for next run.`);
          currentRunId = null;
        }
      }, timeoutMs);
      if (watchdogTimer.unref) watchdogTimer.unref();

      const result = await jobFn(() => currentRunId === runId, ...args);

      wasOwner = currentRunId === runId;
      return wasOwner
        ? { status: 'completed', result }
        : { status: 'stale', result };
    } catch (err) {
      wasOwner = currentRunId === runId;
      return wasOwner
        ? { status: 'error', error: err }
        : { status: 'stale_error', error: err };
    } finally {
      if (wasOwner) {
        if (watchdogTimer) clearTimeout(watchdogTimer);
        const duration = Date.now() - startedAt;
        currentRunId = null;
        const { logger } = require('../middleware/logger');
        logger.info(`[${name}] completed in ${duration}ms`);
      }
    }
  }

  run.isRunning = () => currentRunId !== null;
  run.getElapsed = () => (currentRunId !== null ? Date.now() - startedAt : 0);
  run.reset = () => { currentRunId = null; startedAt = 0; };

  return run;
}

module.exports = { guardedJob };
