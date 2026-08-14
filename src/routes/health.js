const express = require('express');
const traccar = require('../services/traccar');
const mspf = require('../services/mspf');
const foxlogger = require('../services/foxlogger');
const { logger } = require('../middleware/logger');

const router = express.Router();

router.get('/', (_req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

router.get('/detailed', async (req, res, next) => {
  try {
    const deps = [];

    try {
      await traccar.getHealth();
      deps.push({ name: 'traccar', status: 'healthy' });
    } catch {
      deps.push({ name: 'traccar', status: 'unhealthy' });
    }

    try {
      if (mspf.getApi) {
        const api = mspf.getApi();
        if (api) {
          await api.get('/v1/constants', { timeout: 5000 });
          deps.push({ name: 'mspf', status: 'healthy' });
        } else {
          deps.push({ name: 'mspf', status: 'unhealthy' });
        }
      } else {
        deps.push({ name: 'mspf', status: 'unknown' });
      }
    } catch {
      deps.push({ name: 'mspf', status: 'unhealthy' });
    }

    try {
      if (foxlogger.getApi) {
        const api = foxlogger.getApi();
        if (api) {
          await api.get('/geo-fences/0', { timeout: 5000 });
          deps.push({ name: 'foxlogger', status: 'healthy' });
        } else {
          deps.push({ name: 'foxlogger', status: 'unhealthy' });
        }
      } else {
        deps.push({ name: 'foxlogger', status: 'unknown' });
      }
    } catch {
      deps.push({ name: 'foxlogger', status: 'unhealthy' });
    }

    const allHealthy = deps.every(d => d.status === 'healthy');
    res.json({ status: allHealthy ? 'healthy' : 'degraded', dependencies: deps });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
