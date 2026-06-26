const express = require('express');
const createError = require('http-errors');
const traccar = require('../services/traccar');
const mspf = require('../services/mspf');
const deviceRouter = require('../services/deviceRouter');
const { applyRules, enrichWithRules, getDeviceRules } = require('../services/customAttributes');

const router = express.Router();

function normalizeTraccarPosition(p) {
  return { ...p, source: 'traccar' };
}

async function applyCustomAttributes(positions, user) {
  if (!user) return;
  for (const pos of positions) {
    if (!pos.deviceId) continue;
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

router.get('/route', async (req, res, next) => {
  try {
    const { deviceId, group, source, from, to } = req.query;
    if (!deviceId) throw createError(400, 'deviceId is required', { code: 'ERR_VALIDATION' });

    const idNum = parseInt(deviceId, 10);
    let devSource = source;
    if (group) { const p = deviceRouter.resolveGroup(group); if (p) devSource = p.source; }
    if (!devSource) devSource = deviceRouter.getSourceByDeviceId(idNum);
    if (!devSource) {
      const [t, m] = await Promise.allSettled([
        traccar.getDevices({ id: idNum }),
        mspf.getDevice(idNum),
      ]);
      if (t.status === 'fulfilled' && t.value?.[0]) {
        devSource = 'traccar';
        deviceRouter.setSourceByDeviceId(idNum, 'traccar');
      } else if (m.status === 'fulfilled' && m.value?.id) {
        devSource = 'mspf';
        deviceRouter.setSourceByDeviceId(idNum, 'mspf');
      } else {
        throw createError(404, 'Device not found', { code: 'ERR_NOT_FOUND' });
      }
    }

    let positions;
    if (devSource === 'traccar') {
      const data = await traccar.getPositions({ deviceId: idNum, from, to });
      positions = data.map(normalizeTraccarPosition);
    } else {
      positions = await mspf.getDeviceRoute(idNum, { from, to });
    }

    await applyCustomAttributes(positions, req.user);
    res.json(positions);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
