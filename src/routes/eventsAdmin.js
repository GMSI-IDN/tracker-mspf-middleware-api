// ponytail: single endpoint batch event configs upsert ceiling: >500 event types in a single payload -> upgrade path: paginated admin event management
const express = require('express');
const createError = require('http-errors');
const db = require('../db');
const eventConfigService = require('../services/eventConfig');

const router = express.Router();

router.get('/catalog', async (req, res, next) => {
  try {
    const catalog = await eventConfigService.getEventCatalog();
    res.json({ catalog, total: catalog.length });
  } catch (err) {
    next(err);
  }
});

router.get('/configs', async (req, res, next) => {
  try {
    const configs = await eventConfigService.getSavedConfigs();
    res.json({ configs, total: configs.length });
  } catch (err) {
    next(err);
  }
});

router.put('/configs', async (req, res, next) => {
  try {
    const { configs } = req.body;
    if (!Array.isArray(configs) || configs.length === 0) {
      throw createError(400, 'configs must be a non-empty array', { code: 'ERR_VALIDATION' });
    }

    const validLevels = ['danger', 'warning', 'info', 'success'];
    for (const c of configs) {
      if (!c.source || !c.eventKey || !c.eventType) {
        throw createError(400, 'source, eventKey, and eventType are required for each config item', { code: 'ERR_VALIDATION' });
      }
      if (c.level && !validLevels.includes(String(c.level).toLowerCase())) {
        throw createError(400, `level must be one of: ${validLevels.join(', ')}`, { code: 'ERR_VALIDATION' });
      }
    }

    await eventConfigService.upsertBatchEventConfigs(configs);
    const updated = await eventConfigService.getSavedConfigs();
    res.json({ success: true, updatedCount: configs.length, configs: updated });
  } catch (err) {
    next(err);
  }
});

router.delete('/configs/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const deleted = await db('event_configs').where({ id }).del();
    if (!deleted) throw createError(404, 'Event config not found', { code: 'ERR_NOT_FOUND' });
    await eventConfigService.loadConfigCache(true);
    res.json({ success: true, message: 'Event config reset to default' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
