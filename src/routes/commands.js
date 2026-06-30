const express = require('express');
const { body } = require('express-validator');
const createError = require('http-errors');
const traccar = require('../services/traccar');
const mspf = require('../services/mspf');
const deviceRouter = require('../services/deviceRouter');
const validate = require('../middleware/validate');

const router = express.Router();

const TRACCAR_ACTIVATION_MAP = {
  ACTIVE: { type: 'engineResume', description: 'Engine on / resume' },
  INACTIVE: { type: 'engineStop', description: 'Engine off / stop' },
};

router.post('/',
  body('deviceId').notEmpty().withMessage('deviceId is required'),
  body('type').notEmpty().withMessage('type is required'),
  validate,
  async (req, res, next) => {
    try {
      const { deviceId, type, data = {}, group, source } = req.body;
      const idNum = parseInt(deviceId, 10);

      let devSource = source;
      if (group) { const p = deviceRouter.resolveGroup(group); if (p) devSource = p.source; }
      if (!devSource) devSource = deviceRouter.getSourceByDeviceId(idNum);
      if (!devSource) throw createError(404, 'Device not found', { code: 'ERR_NOT_FOUND' });

      if (devSource === 'traccar') {
        const result = await traccar.sendCommand({ deviceId: idNum, type, ...data });
        return res.json({ success: true, message: 'Command sent', deviceId: idNum, commandType: type, source: 'traccar', data: result });
      }
      const result = await mspf.activateDevice(idNum, type === 'activate' ? 'ACTIVE' : 'INACTIVE');
      res.json({ success: true, message: 'Command sent', deviceId: idNum, commandType: type, source: 'mspf', data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/types/:deviceId', async (req, res, next) => {
  try {
    const deviceId = parseInt(req.params.deviceId, 10);
    const { group, source } = req.query;
    let devSource = source;
    if (group) { const p = deviceRouter.resolveGroup(group); if (p) devSource = p.source; }
    if (!devSource) devSource = deviceRouter.getSourceByDeviceId(deviceId);
    if (!devSource) throw createError(404, 'Device not found', { code: 'ERR_NOT_FOUND' });

    if (devSource === 'traccar') {
      const types = await traccar.getCommandTypes({ deviceId });
      return res.json({ types, source: 'traccar' });
    }
    res.json({ types: ['activate', 'deactivate'], source: 'mspf' });
  } catch (err) {
    next(err);
  }
});

router.put('/:deviceId/activation',
  body('desiredStatus').isIn(['ACTIVE', 'INACTIVE']).withMessage('desiredStatus must be ACTIVE or INACTIVE'),
  validate,
  async (req, res, next) => {
    try {
      const deviceId = parseInt(req.params.deviceId, 10);
      const { desiredStatus, group, source } = req.body;

      let devSource = source;
      if (group) { const p = deviceRouter.resolveGroup(group); if (p) devSource = p.source; }
      if (!devSource) devSource = deviceRouter.getSourceByDeviceId(deviceId);
      if (!devSource) throw createError(404, 'Device not found', { code: 'ERR_NOT_FOUND' });

      if (devSource === 'mspf') {
        const result = await mspf.activateDevice(deviceId, desiredStatus);
        return res.json({ success: true, deviceId, desiredStatus, source: 'mspf', data: result });
      }
      const cmd = TRACCAR_ACTIVATION_MAP[desiredStatus];
      const result = await traccar.sendCommand({ deviceId, type: cmd.type });
      res.json({ success: true, deviceId, desiredStatus, commandType: cmd.type, source: 'traccar', data: result });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
