const express = require('express');
const createError = require('http-errors');
const traccar = require('../services/traccar');
const mspf = require('../services/mspf');
const deviceRouter = require('../services/deviceRouter');
const cache = require('../services/cache');
const db = require('../db');
const { applyRules, enrichWithRules, getDeviceRules } = require('../services/customAttributes');

const router = express.Router();

let lastKnownMspfIds = null;

function filterActivePositions(positions) {
  const merged = cache.get('devices:merged');
  if (merged) {
    lastKnownMspfIds = new Set(merged.filter(d => d.source === 'mspf').map(d => d.id));
  }
  if (!lastKnownMspfIds || positions.length === 0) return positions;
  return positions.filter(p => lastKnownMspfIds.has(p.deviceId));
}

function normalizeTraccarPosition(p) {
  const pos = { ...p, source: 'traccar' };
  pos.voltage = pos.attributes?.power ?? undefined;
  pos.internalBattery = pos.attributes?.addr_IB ?? undefined;
  pos.batteryLevel = pos.attributes?.batteryLevel ?? undefined;
  pos.ignition = pos.attributes?.ignition ?? undefined;
  return pos;
}

function enrichPositionRootFields(pos) {
  const attr = pos.attributes || {};
  if (pos.voltage === undefined) pos.voltage = attr.voltage ?? attr.power ?? attr.volt ?? undefined;
  if (pos.internalBattery === undefined) pos.internalBattery = attr.addr_IB ?? undefined;
  if (pos.batteryLevel === undefined) pos.batteryLevel = attr.batteryLevel ?? undefined;
  if (pos.ignition === undefined) pos.ignition = attr.ignition ?? undefined;
  return pos;
}

async function applyCustomAttributes(positions, user) {
  if (!user) return;
  for (const pos of positions) {
    if (!pos.deviceId) continue;
    enrichPositionRootFields(pos);
    const rules = await getDeviceRules(pos.deviceId, pos.source);
    if (rules.length > 0) {
      if (user.role === 'admin') {
        enrichWithRules(pos, rules);
      } else {
        applyRules(pos, rules);
      }
    } else if (user.role !== 'admin') {
      pos.attributes = {};
    }
  }
}

router.get('/', async (req, res, next) => {
  try {
    const { deviceId, group, source, from, to, limit: reqLimit } = req.query;
    const limit = Math.min(parseInt(reqLimit, 10) || 100, 1000);

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
      } else {
        positions = from || to
          ? await mspf.getDeviceRoute(idNum, { from, to })
          : (await mspf.getPositions({ limit })).filter(p => p.deviceId === idNum);
      }
      await applyCustomAttributes(positions, req.user);
      return res.json(positions);
    }

    const [traccarResult, mspfResult] = await Promise.allSettled([
      traccar.getPositions({ limit }),
      mspf.getPositions({ limit }),
    ]);

    let positions = [];
    if (traccarResult.status === 'fulfilled') positions.push(...traccarResult.value.map(normalizeTraccarPosition));
    if (mspfResult.status === 'fulfilled') positions.push(...filterActivePositions(mspfResult.value));

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
      let positions = await mspf.getPositions({ limit: 5 });
      let filtered = positions.filter(p => p.deviceId === idNum);
      await applyCustomAttributes(filtered, req.user);
      return res.json(filtered);
    }

    const [traccarResult, mspfResult] = await Promise.allSettled([
      traccar.getPositions(),
      mspf.getPositions({ limit: 100 }),
    ]);

    let positions = [];
    if (traccarResult.status === 'fulfilled') positions.push(...traccarResult.value.map(normalizeTraccarPosition));
    if (mspfResult.status === 'fulfilled') positions.push(...mspfResult.value);

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
