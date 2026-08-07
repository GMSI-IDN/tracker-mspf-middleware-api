const express = require('express');
const bcrypt = require('bcryptjs');
const { body } = require('express-validator');
const createError = require('http-errors');
const db = require('../db');
const config = require('../config');
const { isValidTimeZone } = require('../utils/timestamp');
const validate = require('../middleware/validate');

const router = express.Router();

function effectiveTimezone(user) {
  return user.timezone || config.timezone.default;
}

router.get('/', async (req, res, next) => {
  try {
    const users = await db('users').select('id', 'username', 'role', 'groups', 'timezone', 'created_at');
    res.json(users.map(u => ({
      id: u.id, username: u.username, role: u.role,
      groups: JSON.parse(u.groups || '[]'), timezone: effectiveTimezone(u), createdAt: u.created_at,
    })));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const user = await db('users').where({ id: req.params.id }).first();
    if (!user) throw createError(404, 'User not found', { code: 'ERR_NOT_FOUND' });
    res.json({
      id: user.id, username: user.username, role: user.role,
      groups: JSON.parse(user.groups || '[]'), timezone: effectiveTimezone(user), createdAt: user.created_at,
    });
  } catch (err) {
    next(err);
  }
});

router.put('/:id',
  body('username').optional().notEmpty().withMessage('Username cannot be empty'),
  body('password').optional().notEmpty().isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('role').optional().isIn(['admin', 'customer']).withMessage('Role must be admin or customer'),
  body('groups').optional().isArray().withMessage('Groups must be an array'),
  body('timezone').optional().custom(v => isValidTimeZone(v)).withMessage('Invalid timezone'),
  validate,
  async (req, res, next) => {
    try {
      const user = await db('users').where({ id: req.params.id }).first();
      if (!user) throw createError(404, 'User not found', { code: 'ERR_NOT_FOUND' });

      const updates = {};
      if (req.body.username !== undefined) updates.username = req.body.username;
      if (req.body.password !== undefined) updates.password_hash = bcrypt.hashSync(req.body.password, 10);
      if (req.body.role !== undefined) updates.role = req.body.role;
      if (req.body.groups !== undefined) updates.groups = JSON.stringify(req.body.groups);
      if (req.body.timezone !== undefined) updates.timezone = req.body.timezone;

      await db('users').where({ id: req.params.id }).update(updates);

      const updated = await db('users').where({ id: req.params.id }).first();
      res.json({
        id: updated.id, username: updated.username, role: updated.role,
        groups: JSON.parse(updated.groups || '[]'), timezone: effectiveTimezone(updated),
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post('/',
  body('username').notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('role').optional().isIn(['admin', 'customer']).withMessage('Role must be admin or customer'),
  body('groups').optional().isArray().withMessage('Groups must be an array'),
  body('timezone').notEmpty().withMessage('Timezone is required')
    .custom(v => isValidTimeZone(v)).withMessage('Invalid timezone'),
  validate,
  async (req, res, next) => {
    try {
      const { username, password, role = 'customer', groups = [], timezone } = req.body;

      const existing = await db('users').where({ username }).first();
      if (existing) throw createError(409, 'Username already exists', { code: 'ERR_CONFLICT' });

      const hash = bcrypt.hashSync(password, 10);
      const [result] = await db('users').insert({ username, password_hash: hash, role, groups: JSON.stringify(groups), timezone }).returning('id');
      res.status(201).json({ id: result?.id || result, username, role, groups, timezone });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
