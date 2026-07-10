const express = require('express');
const createError = require('http-errors');
const traccar = require('../services/traccar');
const mspf = require('../services/mspf');
const deviceRouter = require('../services/deviceRouter');
const cache = require('../services/cache');
const db = require('../db');
const { applyRules, enrichWithRules, getDeviceRules } = require('../services/customAttributes');

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
      if (!devSource) throw createError(404, 'Device not found', { code: 'ERR_NOT_FOUND' });

      if (req.user.role !== 'admin' && req.user.groups?.length > 0) {
        const dg = await db('device_groups').where({ device_id: idNum, source: devSource }).whereIn('group_id', req.user.groups).first();
        if (!dg) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
      }

      let positions;
      if (devSource === 'traccar') {
        const data = await traccar.getPositions({ deviceId: idNum, from, to, limit });
        positions = data.map(normalizeTraccarPosition);
      } else if (from || to) {
        positions = await mspf.getDeviceRoute(idNum, { from, to });
      } else {
        positions = (cache.get('positions:merged') || []).filter(p => p.deviceId === idNum && p.source === 'mspf');
      }
      await applyCustomAttributes(positions, req.user);
      return res.json(positions);
    }

    let positions = cache.get('positions:merged') || [];
    const userGroups = req.user.groups || [];
    if (req.user.role !== 'admin' && userGroups.length > 0) {
      const mappings = await db('device_groups').whereIn('group_id', userGroups).select('device_id', 'source');
      const allowed = new Set(mappings.map(m => `${m.source}:${m.device_id}`));
      positions = positions.filter(p => allowed.has(`${p.source}:${p.deviceId}`));
    }

    await applyCustomAttributes(positions, req.user);
    res.json(positions);
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
      if (!devSource) throw createError(404, 'Device not found', { code: 'ERR_NOT_FOUND' });

      if (req.user.role !== 'admin' && req.user.groups?.length > 0) {
        const dg = await db('device_groups').where({ device_id: idNum, source: devSource }).whereIn('group_id', req.user.groups).first();
        if (!dg) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
      }

      if (devSource === 'traccar') {
        const data = await traccar.getPositions({ deviceId: idNum });
        return res.json((data || []).map(normalizeTraccarPosition));
      }
      const positions = (cache.get('positions:merged') || []).filter(p => p.deviceId === idNum && p.source === 'mspf');
      await applyCustomAttributes(positions, req.user);
      return res.json(positions);
    }

    let positions = cache.get('positions:merged') || [];
    const userGroups = req.user.groups || [];
    if (req.user.role !== 'admin' && userGroups.length > 0) {
      const mappings = await db('device_groups').whereIn('group_id', userGroups).select('device_id', 'source');
      const allowed = new Set(mappings.map(m => `${m.source}:${m.device_id}`));
      positions = positions.filter(p => allowed.has(`${p.source}:${p.deviceId}`));
    }

    await applyCustomAttributes(positions, req.user);
    res.json(positions);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
