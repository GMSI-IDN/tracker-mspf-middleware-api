const express = require('express');
const bcrypt = require('bcryptjs');
const { body } = require('express-validator');
const createError = require('http-errors');
const db = require('../db');
const config = require('../config');
const { isValidTimeZone } = require('../utils/timestamp');
const { invalidateUserAuthStatus } = require('../services/userAuth');
const { disconnectUserSockets, refreshUserSockets } = require('../websocket');
const validate = require('../middleware/validate');

const router = express.Router();

function effectiveTimezone(user) {
  return user.timezone || config.timezone.default;
}

// ponytail: JSON column permissions ceiling: no cross-user relational queries on permissions -> upgrade path: relational role_permissions table if dynamic roles grow
function parsePermissions(raw) {
  if (!raw) return { canCutEngine: false };
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return { canCutEngine: false };
  }
}

function formatUser(u) {
  return {
    id: u.id,
    username: u.username,
    email: u.email || null,
    firstName: u.first_name || null,
    lastName: u.last_name || null,
    role: u.role,
    isActive: u.is_active !== undefined ? Boolean(u.is_active) : true,
    tokenVersion: u.token_version || 1,
    groups: JSON.parse(u.groups || '[]'),
    timezone: effectiveTimezone(u),
    permissions: parsePermissions(u.permissions),
    createdAt: u.created_at,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const users = await db('users').select('*');
    res.json(users.map(formatUser));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const user = await db('users').where({ id: req.params.id }).first();
    if (!user) throw createError(404, 'User not found', { code: 'ERR_NOT_FOUND' });
    res.json(formatUser(user));
  } catch (err) {
    next(err);
  }
});

router.put('/:id',
  body('username').optional().notEmpty().withMessage('Username cannot be empty'),
  body('email').optional().isEmail().withMessage('Invalid email format'),
  body('password').optional().notEmpty().isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('role').optional().isIn(['admin', 'customer']).withMessage('Role must be admin or customer'),
  body('groups').optional().isArray().withMessage('Groups must be an array'),
  body('permissions').optional().isObject().withMessage('Permissions must be an object'),
  body('timezone').optional().custom(v => isValidTimeZone(v)).withMessage('Invalid timezone'),
  body('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
  body('is_active').optional().isBoolean().withMessage('is_active must be a boolean'),
  validate,
  async (req, res, next) => {
    try {
      const user = await db('users').where({ id: req.params.id }).first();
      if (!user) throw createError(404, 'User not found', { code: 'ERR_NOT_FOUND' });

      const updates = {};
      if (req.body.username !== undefined) {
        const existing = await db('users').where({ username: req.body.username }).whereNot({ id: req.params.id }).first();
        if (existing) throw createError(409, 'Username already exists', { code: 'ERR_CONFLICT' });
        updates.username = req.body.username;
      }
      if (req.body.email !== undefined) {
        const cleanEmail = String(req.body.email).toLowerCase().trim();
        const existing = await db('users').where({ email: cleanEmail }).whereNot({ id: req.params.id }).first();
        if (existing) throw createError(409, 'Email already in use', { code: 'ERR_CONFLICT' });
        updates.email = cleanEmail;
      }

      const firstName = req.body.firstName !== undefined ? req.body.firstName : req.body.first_name;
      if (firstName !== undefined) updates.first_name = String(firstName).trim();
      const lastName = req.body.lastName !== undefined ? req.body.lastName : req.body.last_name;
      if (lastName !== undefined) updates.last_name = String(lastName).trim();

      let shouldRevokeTokens = false;

      const activeInput = req.body.isActive !== undefined ? req.body.isActive : req.body.is_active;
      if (activeInput !== undefined) {
        const activeBool = Boolean(activeInput);
        updates.is_active = activeBool;
        if (!activeBool) {
          shouldRevokeTokens = true;
        }
      }

      if (req.body.password !== undefined) {
        const confirm = req.body.confirmPassword !== undefined
          ? req.body.confirmPassword
          : (req.body.confirm_password !== undefined ? req.body.confirm_password : req.body.passwordConfirm);
        if (!confirm) {
          throw createError(400, 'Confirm password is required when updating password', { code: 'ERR_VALIDATION' });
        }
        if (req.body.password !== confirm) {
          throw createError(400, 'Password confirmation does not match', { code: 'ERR_VALIDATION' });
        }
        updates.password_hash = bcrypt.hashSync(req.body.password, 10);
        shouldRevokeTokens = true;
      }

      if (req.body.role !== undefined) updates.role = req.body.role;
      if (req.body.groups !== undefined) updates.groups = JSON.stringify(req.body.groups);
      if (req.body.permissions !== undefined) {
        const newPermStr = JSON.stringify(req.body.permissions);
        const oldPermStr = user.permissions || '{"canCutEngine":false}';
        updates.permissions = newPermStr;
        // Only revoke tokens if permissions actually changed value, not just because it was included in request payload
        if (newPermStr !== oldPermStr) {
          shouldRevokeTokens = true;
        }
      }
      if (req.body.timezone !== undefined) updates.timezone = req.body.timezone;

      if (shouldRevokeTokens) {
        updates.token_version = (user.token_version || 1) + 1;
      }

      if (Object.keys(updates).length > 0) {
        await db('users').where({ id: req.params.id }).update(updates);
        invalidateUserAuthStatus(req.params.id);
        if (shouldRevokeTokens) {
          disconnectUserSockets(req.params.id);
        } else if (req.body.groups !== undefined) {
          Promise.resolve(refreshUserSockets?.(req.params.id)).catch(() => {});
        }
      }

      const updated = await db('users').where({ id: req.params.id }).first();
      res.json(formatUser(updated));
    } catch (err) {
      next(err);
    }
  }
);

router.post('/',
  body('username').notEmpty().withMessage('Username is required'),
  body('email').notEmpty().withMessage('Email is required').isEmail().withMessage('Invalid email format'),
  body().custom((_, { req }) => {
    const firstName = req.body.firstName !== undefined ? req.body.firstName : req.body.first_name;
    if (!firstName || typeof firstName !== 'string' || !firstName.trim()) {
      throw new Error('First name is required');
    }
    const lastName = req.body.lastName !== undefined ? req.body.lastName : req.body.last_name;
    if (!lastName || typeof lastName !== 'string' || !lastName.trim()) {
      throw new Error('Last name is required');
    }
    return true;
  }),
  body('password').notEmpty().withMessage('Password is required')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body().custom((_, { req }) => {
    const confirm = req.body.confirmPassword !== undefined
      ? req.body.confirmPassword
      : (req.body.confirm_password !== undefined ? req.body.confirm_password : req.body.passwordConfirm);
    if (!confirm) {
      throw new Error('Confirm password is required');
    }
    if (confirm !== req.body.password) {
      throw new Error('Password confirmation does not match');
    }
    return true;
  }),
  body('role').optional().isIn(['admin', 'customer']).withMessage('Role must be admin or customer'),
  body('groups').optional().isArray().withMessage('Groups must be an array'),
  body('permissions').optional().isObject().withMessage('Permissions must be an object'),
  body('timezone').notEmpty().withMessage('Timezone is required')
    .custom(v => isValidTimeZone(v)).withMessage('Invalid timezone'),
  body('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
  body('is_active').optional().isBoolean().withMessage('is_active must be a boolean'),
  validate,
  async (req, res, next) => {
    try {
      const { username, email, password, role = 'customer', groups = [], timezone, permissions = { canCutEngine: false } } = req.body;
      const firstName = String(req.body.firstName !== undefined ? req.body.firstName : req.body.first_name).trim();
      const lastName = String(req.body.lastName !== undefined ? req.body.lastName : req.body.last_name).trim();
      const cleanEmail = String(email).toLowerCase().trim();
      const activeInput = req.body.isActive !== undefined ? req.body.isActive : req.body.is_active;
      const isActive = activeInput !== undefined ? Boolean(activeInput) : true;

      const existingUser = await db('users').where({ username }).first();
      if (existingUser) throw createError(409, 'Username already exists', { code: 'ERR_CONFLICT' });

      const existingEmail = await db('users').where({ email: cleanEmail }).first();
      if (existingEmail) throw createError(409, 'Email already in use', { code: 'ERR_CONFLICT' });

      const hash = bcrypt.hashSync(password, 10);
      const [result] = await db('users').insert({
        username,
        email: cleanEmail,
        first_name: firstName,
        last_name: lastName,
        password_hash: hash,
        role,
        groups: JSON.stringify(groups),
        timezone,
        is_active: isActive,
        token_version: 1,
        permissions: JSON.stringify(permissions),
      }).returning('id');

      res.status(201).json({
        id: result?.id || result,
        username,
        email: cleanEmail,
        firstName,
        lastName,
        role,
        groups,
        timezone,
        isActive,
        tokenVersion: 1,
        permissions,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
