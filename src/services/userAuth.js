const db = require('../db');
const cache = require('./cache');

function parsePermissions(raw) {
  if (!raw) return { canCutEngine: false };
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return { canCutEngine: false };
  }
}

function parseGroups(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function getUserAuthStatus(userId) {
  if (!userId) return null;
  const cacheKey = `user:auth:${userId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const user = await db('users')
    .where({ id: userId })
    .select('id', 'role', 'groups', 'permissions', 'is_active', 'token_version')
    .first();
  if (!user) return null;

  const status = {
    isActive: user.is_active !== undefined ? Boolean(user.is_active) : true,
    tokenVersion: user.token_version || 1,
    role: user.role,
    groups: parseGroups(user.groups),
    permissions: parsePermissions(user.permissions),
  };
  cache.set(cacheKey, status, 60);
  return status;
}

function invalidateUserAuthStatus(userId) {
  if (!userId) return;
  cache.del(`user:auth:${userId}`);
}

function setUserAuthStatus(userId, status) {
  if (!userId) return;
  cache.set(`user:auth:${userId}`, status, 60);
}

module.exports = {
  getUserAuthStatus,
  invalidateUserAuthStatus,
  setUserAuthStatus,
};
