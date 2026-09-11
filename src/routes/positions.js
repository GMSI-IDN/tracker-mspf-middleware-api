const express = require('express');
const createError = require('http-errors');
const traccar = require('../services/traccar');
const mspf = require('../services/mspf');
const foxlogger = require('../services/foxlogger');
const deviceRouter = require('../services/deviceRouter');
const cache = require('../services/cache');
const db = require('../db');
const { applyRules, enrichWithRules, getDeviceRules } = require('../services/customAttributes');
const { sanitizePositions } = require('../utils/sanitizer');
const { isDeviceAllowedForGroups, getAllowedDeviceKeys } = require('../services/groupMembership');

const router = express.Router();

function normalizeTraccarPosition(p) {
  const pos = { ...p, source: 'traccar' };
  pos.voltage = pos.attributes?.power ?? undefined;
  pos.internalBattery = pos.attributes?.addr_IB ?? undefined;
  pos.batteryLevel = pos.attributes?.batteryLevel ?? undefined;
  pos.ignition = pos.attributes?.ignition ?? undefined;
  return pos;
}

async function enrichPositions(positions, attrs) {
  if (!positions || positions.length === 0) return;
  for (const pos of positions) {
    const attr = pos.attributes || {};
    if (pos.voltage === undefined) pos.voltage = attr.voltage ?? attr.power ?? attr.volt ?? undefined;
    if (pos.internalBattery === undefined) pos.internalBattery = attr.addr_IB ?? attr.battery ?? undefined;
    if (pos.batteryLevel === undefined) pos.batteryLevel = attr.batteryLevel ?? undefined;
    if (pos.ignition === undefined) pos.ignition = attr.ignition ?? undefined;
  }
}

async function applyCustomAttributes(positions, user) {
  if (!user) return;
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    if (!pos.deviceId) continue;
    enrichPositions([pos], null);
    const rules = await getDeviceRules(pos.deviceId, pos.source);
    if (rules.length > 0) {
      const cloned = { ...pos, attributes: { ...pos.attributes } };
      if (user.role === 'admin') {
        enrichWithRules(cloned, rules);
      } else {
        applyRules(cloned, rules);
      }
      positions[i] = cloned;
    } else if (user.role !== 'admin') {
      positions[i] = { ...pos, attributes: {} };
    }
  }
}

router.get('/', async (req, res, next) => {
  try {
    const { deviceId, group, source, from, to } = req.query;

    if (deviceId) {
      const idNum = parseInt(deviceId, 10);
      let devSource = source;
      if (group) { const p = deviceRouter.resolveGroup(group); if (p) devSource = p.source; }
      if (!devSource) devSource = deviceRouter.getSourceByDeviceId(idNum);
      if (!devSource) devSource = deviceRouter.getSourceByDeviceId(deviceId);
      if (!devSource) throw createError(404, 'Device not found', { code: 'ERR_NOT_FOUND' });

      if (req.user.role !== 'admin') {
        if (!req.user.groups?.length) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
        const lookupId = devSource === 'foxlogger' ? deviceId : idNum;
        const allowed = await isDeviceAllowedForGroups(lookupId, devSource, req.user.groups);
        if (!allowed) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
      }

      let positions;
      if (devSource === 'traccar') {
        const data = await traccar.getPositions({ deviceId: idNum, from, to, limit });
        positions = data.map(normalizeTraccarPosition);
      } else if (devSource === 'foxlogger') {
        const data = await foxlogger.getPositions({ status: undefined });
        positions = (data || []).filter(p => p.deviceId === idNum);
      } else if (from || to) {
        positions = await mspf.getDeviceRoute(idNum, { from, to });
      } else {
        positions = (cache.get('positions:merged') || []).filter(p => p.deviceId === idNum && p.source === 'mspf');
      }
      await applyCustomAttributes(positions, req.user);
      return res.json(sanitizePositions(positions, req.user.role === 'admin'));
    }

    let positions = cache.get('positions:merged') || [];
    const userGroups = req.user.groups || [];
    if (req.user.role !== 'admin') {
      if (userGroups.length === 0) {
        positions = [];
      } else {
        const allowedKeys = await getAllowedDeviceKeys(userGroups);
        positions = positions.filter(p => allowedKeys.has(`${p.source}:${p.deviceId}`));
      }
    }

    await applyCustomAttributes(positions, req.user);
    res.json(sanitizePositions(positions, req.user.role === 'admin'));
  } catch (err) {
    next(err);
  }
});

router.get('/latest', async (req, res, next) => {
  try {
    const { deviceId, group, source } = req.query;

    if (deviceId) {
      const idNum = parseInt(deviceId, 10);
      let devSource = source;
      if (group) { const p = deviceRouter.resolveGroup(group); if (p) devSource = p.source; }
      if (!devSource) devSource = deviceRouter.getSourceByDeviceId(idNum);
      if (!devSource) devSource = deviceRouter.getSourceByDeviceId(deviceId);
      if (!devSource) throw createError(404, 'Device not found', { code: 'ERR_NOT_FOUND' });

      if (req.user.role !== 'admin') {
        if (!req.user.groups?.length) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
        const lookupId = devSource === 'foxlogger' ? deviceId : idNum;
        const allowed = await isDeviceAllowedForGroups(lookupId, devSource, req.user.groups);
        if (!allowed) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
      }

      if (devSource === 'traccar') {
        const data = await traccar.getPositions({ deviceId: idNum });
        const positions = (data || []).map(normalizeTraccarPosition);
        return res.json(sanitizePositions(positions, req.user.role === 'admin'));
      }
      if (devSource === 'foxlogger') {
        const data = await foxlogger.getPositions({ status: undefined });
        const positions = (data || []).filter(p => p.deviceId === idNum);
        await applyCustomAttributes(positions, req.user);
        return res.json(sanitizePositions(positions, req.user.role === 'admin'));
      }
      const positions = (cache.get('positions:merged') || []).filter(p => p.deviceId === idNum && p.source === 'mspf');
      await applyCustomAttributes(positions, req.user);
      return res.json(sanitizePositions(positions, req.user.role === 'admin'));
    }

    let positions = cache.get('positions:merged') || [];
    const userGroups = req.user.groups || [];
    if (req.user.role !== 'admin') {
      if (userGroups.length === 0) {
        positions = [];
      } else {
        const allowedKeys = await getAllowedDeviceKeys(userGroups);
        positions = positions.filter(p => allowedKeys.has(`${p.source}:${p.deviceId}`));
      }
    }

    await applyCustomAttributes(positions, req.user);
    res.json(sanitizePositions(positions, req.user.role === 'admin'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
