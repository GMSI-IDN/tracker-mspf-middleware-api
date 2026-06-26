const express = require('express');
const { body } = require('express-validator');
const createError = require('http-errors');
const db = require('../db');
const cache = require('../services/cache');
const traccar = require('../services/traccar');
const mspf = require('../services/mspf');
const validate = require('../middleware/validate');

async function deviceExists(deviceId, source) {
  const merged = cache.get('devices:merged');
  if (merged) {
    const found = merged.find(d => d.id === deviceId && d.source === source);
    if (found) return true;
  }
  try {
    if (source === 'traccar') {
      const data = await traccar.getDevices({ id: deviceId });
      return data && data.length > 0;
    }
    await mspf.getDevice(deviceId);
    return true;
  } catch {
    return false;
  }
}

async function validateDevicesExist(rows) {
  const results = await Promise.allSettled(
    rows.map(r => deviceExists(r.device_id, r.source))
  );
  const invalid = [];
  for (let i = 0; i < rows.length; i++) {
    if (results[i].status !== 'fulfilled' || !results[i].value) {
      invalid.push(`${rows[i].source}:${rows[i].device_id}`);
    }
  }
  return invalid;
}

function getDeviceName(deviceId, source) {
  const merged = require('../services/cache').get('devices:merged') || [];
  const dev = merged.find(d => d.id === deviceId && d.source === source);
  return dev?.name || `${source}:${deviceId}`;
}

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { groupId } = req.query;
    let query = db('device_groups').select('*');
    if (groupId) query = query.where({ group_id: groupId });
    const rows = await query;
    const enriched = rows.map(r => ({
      id: r.id,
      deviceId: r.device_id,
      source: r.source,
      groupId: r.group_id,
      deviceName: getDeviceName(r.device_id, r.source),
      createdAt: r.created_at,
    }));
    res.json({ deviceGroups: enriched });
  } catch (err) {
    next(err);
  }
});

router.post('/',
  body('deviceId').notEmpty().withMessage('deviceId is required'),
  body('source').isIn(['traccar', 'mspf']).withMessage('source must be traccar or mspf'),
  body('groupId').isInt().withMessage('groupId must be an integer'),
  validate,
  async (req, res, next) => {
    try {
      const { deviceId, source, groupId } = req.body;
      const group = await db('groups').where({ id: groupId }).first();
      if (!group) throw createError(404, 'Group not found', { code: 'ERR_NOT_FOUND' });

      const exists = await deviceExists(deviceId, source);
      if (!exists) throw createError(400, `Device ${source}:${deviceId} not found in backend`, { code: 'ERR_VALIDATION' });

      const existing = await db('device_groups').where({ device_id: deviceId, source, group_id: groupId }).first();
      if (existing) throw createError(409, 'Mapping already exists', { code: 'ERR_CONFLICT' });

      const [result] = await db('device_groups').insert({ device_id: deviceId, source, group_id: groupId }).returning('id');
      const deviceName = getDeviceName(deviceId, source);
      res.status(201).json({ id: result?.id || result, deviceId, deviceName, source, groupId });
    } catch (err) {
      next(err);
    }
  }
);

router.post('/batch',
  body('groupId').isInt().withMessage('groupId is required'),
  body('devices').isArray({ min: 1 }).withMessage('devices array is required'),
  validate,
  async (req, res, next) => {
    try {
      const { groupId, devices } = req.body;
      const group = await db('groups').where({ id: groupId }).first();
      if (!group) throw createError(404, 'Group not found', { code: 'ERR_NOT_FOUND' });

      const rows = devices.map(d => ({
        device_id: d.deviceId ?? d.device_id,
        source: d.source,
        group_id: groupId,
      }));

      const invalid = rows.filter(r => !r.source || !r.device_id);
      if (invalid.length > 0) throw createError(400, 'Each device must have deviceId and source', { code: 'ERR_VALIDATION' });

      const invalidDevices = await validateDevicesExist(rows);
      if (invalidDevices.length > 0) {
        throw createError(400, `Devices not found in backend: ${invalidDevices.join(', ')}`, { code: 'ERR_VALIDATION' });
      }

      let inserted = 0;
      const insertedDevices = [];
      for (const row of rows) {
        try {
          await db('device_groups').insert(row).onConflict(['device_id', 'source', 'group_id']).ignore();
          inserted++;
          insertedDevices.push({
            deviceId: row.device_id,
            source: row.source,
            deviceName: getDeviceName(row.device_id, row.source),
          });
        } catch { /* skip duplicate */ }
      }

      res.status(201).json({ message: `${inserted} device(s) assigned to group ${groupId}`, devices: insertedDevices });
    } catch (err) {
      next(err);
    }
  }
);

router.delete('/:id', async (req, res, next) => {
  try {
    const row = await db('device_groups').where({ id: req.params.id }).first();
    if (!row) throw createError(404, 'Mapping not found', { code: 'ERR_NOT_FOUND' });
    await db('device_groups').where({ id: req.params.id }).del();
    res.json({ message: 'Mapping deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
