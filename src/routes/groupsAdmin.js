const express = require('express');
const { body } = require('express-validator');
const createError = require('http-errors');
const db = require('../db');
const validate = require('../middleware/validate');

const router = express.Router();

function normalizeGroup(g) {
  return { id: g.id, name: g.name, description: g.description, createdAt: g.created_at };
}

router.get('/', async (req, res, next) => {
  try {
    const groups = await db('groups').select('*');
    res.json({ groups: groups.map(normalizeGroup) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const group = await db('groups').where({ id: req.params.id }).first();
    if (!group) throw createError(404, 'Group not found', { code: 'ERR_NOT_FOUND' });
    res.json(normalizeGroup(group));
  } catch (err) {
    next(err);
  }
});

router.post('/',
  body('name').notEmpty().withMessage('name is required'),
  validate,
  async (req, res, next) => {
    try {
      const { name, description = '' } = req.body;
      const existing = await db('groups').where({ name }).first();
      if (existing) throw createError(409, 'Group name already exists', { code: 'ERR_CONFLICT' });

      const [result] = await db('groups').insert({ name, description }).returning('id');
      res.status(201).json({ id: result?.id || result, name, description });
    } catch (err) {
      next(err);
    }
  }
);

router.put('/:id',
  body('name').optional().notEmpty(),
  validate,
  async (req, res, next) => {
    try {
      const group = await db('groups').where({ id: req.params.id }).first();
      if (!group) throw createError(404, 'Group not found', { code: 'ERR_NOT_FOUND' });

      const updates = {};
      if (req.body.name !== undefined) updates.name = req.body.name;
      if (req.body.description !== undefined) updates.description = req.body.description;
      if (Object.keys(updates).length > 0) await db('groups').where({ id: req.params.id }).update(updates);

      res.json(normalizeGroup({ ...group, ...updates }));
    } catch (err) {
      next(err);
    }
  }
);

router.delete('/:id', async (req, res, next) => {
  try {
    const group = await db('groups').where({ id: req.params.id }).first();
    if (!group) throw createError(404, 'Group not found', { code: 'ERR_NOT_FOUND' });
    await db('groups').where({ id: req.params.id }).del();
    res.json({ message: 'Group deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
