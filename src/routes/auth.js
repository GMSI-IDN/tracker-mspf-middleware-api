const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body } = require('express-validator');
const createError = require('http-errors');
const db = require('../db');
const config = require('../config');
const { authMiddleware } = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();

router.post('/login',
  body('username').notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required'),
  validate,
  async (req, res, next) => {
    try {
      await db.waitForMigration();
      const { username, password } = req.body;
      const user = await db('users').where({ username }).first();
      if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        throw createError(401, 'Invalid credentials', { code: 'ERR_UNAUTHORIZED' });
      }

      const groups = JSON.parse(user.groups || '[]');
      const timezone = user.timezone || config.timezone.default;
      const payload = { id: user.id, username: user.username, role: user.role, groups, timezone };
      const token = jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiry });
      res.json({ token, user: payload, expiresIn: config.jwt.expiry });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/me', authMiddleware, (req, res) => {
  const { id, username, role, groups, timezone } = req.user;
  res.json({ id, username, role, groups, timezone: timezone || config.timezone.default });
});

module.exports = router;
