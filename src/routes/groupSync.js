const express = require('express');
const { body } = require('express-validator');
const createError = require('http-errors');
const db = require('../db');
const traccar = require('../services/traccar');
const mspf = require('../services/mspf');
const validate = require('../middleware/validate');

function normalizeRule(r) {
  return {
    id: r.id, middlewareGroupId: r.middleware_group_id,
    source: r.source, sourceGroupId: r.source_group_id,
    sourceGroupName: r.source_group_name, createdAt: r.created_at,
  };
}

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const rules = await db('group_sync_rules').select('*');
    res.json({ rules: rules.map(normalizeRule) });
  } catch (err) {
    next(err);
  }
});

router.post('/',
  body('middlewareGroupId').isInt().withMessage('middlewareGroupId is required'),
  body('source').isIn(['traccar', 'mspf']).withMessage('source must be traccar or mspf'),
  body('sourceGroupId').notEmpty().withMessage('sourceGroupId is required'),
  validate,
  async (req, res, next) => {
    try {
      const { middlewareGroupId, source, sourceGroupId } = req.body;

      const group = await db('groups').where({ id: middlewareGroupId }).first();
      if (!group) throw createError(404, 'Middleware group not found', { code: 'ERR_NOT_FOUND' });

      // Fetch name for the source group
      let sourceGroupName = '';
      try {
        const parts = sourceGroupId.split('_');
        const rawId = parseInt(parts[parts.length - 1], 10);
        if (source === 'traccar') {
          const groups = await traccar.getGroups({ all: true });
          const match = groups.find(g => g.id === rawId);
          if (match) sourceGroupName = match.name;
        } else {
          const bc = await mspf.getBc(rawId);
          if (bc) sourceGroupName = bc.name;
        }
      } catch {}

      const [result] = await db('group_sync_rules').insert({
        middleware_group_id: middlewareGroupId,
        source,
        source_group_id: sourceGroupId,
        source_group_name: sourceGroupName,
      }).returning('id');

      res.status(201).json({
        id: result?.id || result,
        middlewareGroupId,
        source,
        sourceGroupId,
        sourceGroupName,
      });
    } catch (err) {
      if (err.code === 'ERR_NOT_FOUND') return next(err);
      if (err.message?.includes('UNIQUE')) {
        return next(createError(409, 'Rule already exists', { code: 'ERR_CONFLICT' }));
      }
      next(err);
    }
  }
);

router.delete('/:id', async (req, res, next) => {
  try {
    const rule = await db('group_sync_rules').where({ id: req.params.id }).first();
    if (!rule) throw createError(404, 'Rule not found', { code: 'ERR_NOT_FOUND' });
    await db('group_sync_rules').where({ id: req.params.id }).del();
    res.json({ message: 'Rule deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
