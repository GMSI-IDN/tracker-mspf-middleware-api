const express = require('express');
const { body } = require('express-validator');
const createError = require('http-errors');
const db = require('../db');
const traccar = require('../services/traccar');
const mspf = require('../services/mspf');
const cache = require('../services/cache');
const validate = require('../middleware/validate');

const router = express.Router();

const SOURCE_CACHE_TTL = 300;

function normalizeGroup(g) {
  return { id: g.id, name: g.name, description: g.description, createdAt: g.created_at };
}

router.get('/sources', async (req, res, next) => {
  try {
    let sources = cache.get('admin:groupSources');
    if (sources) return res.json({ sources });

    const [traccarResult, mspfResult] = await Promise.allSettled([
      traccar.getGroups({ all: true }),
      mspf.waitForInit().then(() => mspf.getBcList()),
    ]);

    sources = [];
    if (traccarResult.status === 'fulfilled' && traccarResult.value) {
      for (const g of traccarResult.value) {
        sources.push({ id: `traccar_${g.id}`, name: g.name, source: 'traccar' });
      }
    }
    if (mspfResult.status === 'fulfilled' && mspfResult.value?.data) {
      for (const b of mspfResult.value.data) {
        sources.push({ id: `mspf_${b.id}`, name: b.name, source: 'mspf' });
      }
    }

    cache.set('admin:groupSources', sources, SOURCE_CACHE_TTL);
    res.json({ sources });
  } catch (err) {
    next(err);
  }
});

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
      if (req.body.name !== undefined) {
        const existing = await db('groups').where({ name: req.body.name }).whereNot({ id: req.params.id }).first();
        if (existing) throw createError(409, 'Group name already exists', { code: 'ERR_CONFLICT' });
        updates.name = req.body.name;
      }
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
