const { validationResult } = require('express-validator');
const createError = require('http-errors');

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const msg = errors.array().map((e) => e.msg).join('; ');
    return next(createError(400, msg, { code: 'ERR_VALIDATION' }));
  }
  next();
}

module.exports = validate;
