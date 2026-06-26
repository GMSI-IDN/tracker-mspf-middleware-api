const express = require('express');
const { body } = require('express-validator');
const createError = require('http-errors');
const db = require('../db');
const cache = require('../services/cache');
const validate = require('../middleware/validate');

const router = express.Router();

function normalizeRule(r) {
  return {
    id: r.id, groupId: r.group_id, groupName: r.group_name,
    name: r.name, sourceField: r.source_field, mode: r.mode,
    formula: r.formula, defaultVisible: !!r.default_visible,
    enabled: !!r.enabled, priority: r.priority, createdAt: r.created_at,
  };
}

router.get('/available-fields', async (req, res, next) => {
  try {
    const merged = cache.get('devices:merged') || [];
    const fieldMap = {};
    for (const d of merged) {
      if (!d.attributes) continue;
      for (const [key, val] of Object.entries(d.attributes)) {
        if (!fieldMap[key]) {
          fieldMap[key] = { name: key, type: typeof val, sources: [] };
        }
        if (!fieldMap[key].sources.includes(d.source)) {
          fieldMap[key].sources.push(d.source);
        }
      }
    }
    const fields = Object.values(fieldMap).sort((a, b) => a.name.localeCompare(b.name));
    res.json({ fields });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const { groupId } = req.query;
    let query = db('custom_attribute_rules')
      .join('groups', 'custom_attribute_rules.group_id', 'groups.id')
      .select('custom_attribute_rules.*', 'groups.name as group_name')
      .orderBy('custom_attribute_rules.group_id')
      .orderBy('custom_attribute_rules.priority');
    if (groupId) query = query.where('custom_attribute_rules.group_id', groupId);
    const rules = await query;
    res.json({ rules: rules.map(normalizeRule) });
  } catch (err) {
    next(err);
  }
});

router.post('/',
  body('groupId').isInt().withMessage('groupId is required'),
  body('name').notEmpty().withMessage('name is required'),
  body('mode').isIn(['passthrough', 'rename', 'compute']).withMessage('mode must be passthrough, rename, or compute'),
  validate,
  async (req, res, next) => {
    try {
      const { groupId, name, sourceField, mode, formula, defaultVisible = true, enabled = true, priority = 0 } = req.body;

      const group = await db('groups').where({ id: groupId }).first();
      if (!group) throw createError(404, 'Group not found', { code: 'ERR_NOT_FOUND' });

      const [result] = await db('custom_attribute_rules').insert({
        group_id: groupId, name, source_field: sourceField || null,
        mode, formula: formula || null,
        default_visible: defaultVisible, enabled, priority,
      }).returning('id');

      res.status(201).json({
        id: result?.id || result, groupId, name, sourceField, mode, formula, defaultVisible, enabled, priority,
      });
    } catch (err) {
      next(err);
    }
  }
);

router.put('/:id',
  async (req, res, next) => {
    try {
      const rule = await db('custom_attribute_rules').where({ id: req.params.id }).first();
      if (!rule) throw createError(404, 'Rule not found', { code: 'ERR_NOT_FOUND' });

      const updates = {};
      if (req.body.name !== undefined) updates.name = req.body.name;
      if (req.body.source_field !== undefined) updates.source_field = req.body.source_field;
      if (req.body.mode !== undefined) updates.mode = req.body.mode;
      if (req.body.formula !== undefined) updates.formula = req.body.formula;
      if (req.body.default_visible !== undefined) updates.default_visible = req.body.default_visible;
      if (req.body.enabled !== undefined) updates.enabled = req.body.enabled;
      if (req.body.priority !== undefined) updates.priority = req.body.priority;

      await db('custom_attribute_rules').where({ id: req.params.id }).update(updates);
      const updated = { ...rule, ...updates };
      res.json(normalizeRule(updated));
    } catch (err) {
      next(err);
    }
  }
);

router.delete('/:id', async (req, res, next) => {
  try {
    const rule = await db('custom_attribute_rules').where({ id: req.params.id }).first();
    if (!rule) throw createError(404, 'Rule not found', { code: 'ERR_NOT_FOUND' });
    await db('custom_attribute_rules').where({ id: req.params.id }).del();
    res.json({ message: 'Rule deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
