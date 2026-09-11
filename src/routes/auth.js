const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body } = require('express-validator');
const createError = require('http-errors');
const db = require('../db');
const config = require('../config');
const { authMiddleware } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { isValidTimeZone } = require('../utils/timestamp');
const { invalidateUserAuthStatus, setUserAuthStatus } = require('../services/userAuth');

const router = express.Router();

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

function formatUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email || null,
    firstName: user.first_name || null,
    lastName: user.last_name || null,
    role: user.role,
    isActive: user.is_active !== undefined ? Boolean(user.is_active) : true,
    tokenVersion: user.token_version || 1,
    groups: JSON.parse(user.groups || '[]'),
    timezone: user.timezone || config.timezone.default,
    permissions: parsePermissions(user.permissions),
  };
}

router.post('/login',
  body().custom((_, { req }) => {
    const identifier = req.body.username || req.body.email || req.body.login || req.body.identifier;
    if (!identifier || typeof identifier !== 'string' || !identifier.trim()) {
      throw new Error('Username or email is required');
    }
    return true;
  }),
  body('password').notEmpty().withMessage('Password is required'),
  validate,
  async (req, res, next) => {
    try {
      await db.waitForMigration();
      const { password } = req.body;
      const identifier = String(req.body.username || req.body.email || req.body.login || req.body.identifier || '').trim();

      const user = await db('users')
        .where(function () {
          this.where('username', identifier)
            .orWhere('email', identifier.toLowerCase());
        })
        .first();

      if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        throw createError(401, 'Invalid credentials', { code: 'ERR_UNAUTHORIZED' });
      }

      if (user.is_active !== undefined && !Boolean(user.is_active)) {
        throw createError(403, 'Account has been disabled. Please contact administrator', { code: 'ERR_ACCOUNT_DISABLED' });
      }

      const formatted = formatUser(user);
      setUserAuthStatus(user.id, { isActive: formatted.isActive, tokenVersion: formatted.tokenVersion });
      const token = jwt.sign(formatted, config.jwt.secret, { expiresIn: config.jwt.expiry });
      res.json({ token, user: formatted, expiresIn: config.jwt.expiry });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const user = await db('users').where({ id: req.user.id }).first();
    if (!user) throw createError(404, 'User not found', { code: 'ERR_NOT_FOUND' });
    res.json(formatUser(user));
  } catch (err) {
    next(err);
  }
});

router.put('/me',
  authMiddleware,
  body('timezone').optional().custom(v => isValidTimeZone(v)).withMessage('Invalid timezone'),
  body('password').optional().isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  validate,
  async (req, res, next) => {
    try {
      const user = await db('users').where({ id: req.user.id }).first();
      if (!user) throw createError(404, 'User not found', { code: 'ERR_NOT_FOUND' });

      const firstName = req.body.firstName !== undefined ? req.body.firstName : req.body.first_name;
      const lastName = req.body.lastName !== undefined ? req.body.lastName : req.body.last_name;
      const { timezone, password } = req.body;
      const confirmPassword = req.body.confirmPassword !== undefined
        ? req.body.confirmPassword
        : (req.body.confirm_password !== undefined ? req.body.confirm_password : req.body.passwordConfirm);

      if (password !== undefined) {
        if (!confirmPassword) {
          throw createError(400, 'Confirm password is required when updating password', { code: 'ERR_VALIDATION' });
        }
        if (password !== confirmPassword) {
          throw createError(400, 'Password confirmation does not match', { code: 'ERR_VALIDATION' });
        }
      }

      const updates = {};
      if (firstName !== undefined) updates.first_name = String(firstName).trim();
      if (lastName !== undefined) updates.last_name = String(lastName).trim();
      if (timezone !== undefined) updates.timezone = timezone;
      if (password !== undefined) {
        updates.password_hash = bcrypt.hashSync(password, 10);
        updates.token_version = (user.token_version || 1) + 1;
      }

      if (Object.keys(updates).length > 0) {
        await db('users').where({ id: req.user.id }).update(updates);
        invalidateUserAuthStatus(req.user.id);
      }

      const updated = await db('users').where({ id: req.user.id }).first();
      const formatted = formatUser(updated);
      setUserAuthStatus(req.user.id, { isActive: formatted.isActive, tokenVersion: formatted.tokenVersion });
      const token = jwt.sign(formatted, config.jwt.secret, { expiresIn: config.jwt.expiry });

      res.json({
        ...formatted,
        user: formatted,
        token,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
