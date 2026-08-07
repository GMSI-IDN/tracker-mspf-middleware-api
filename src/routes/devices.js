const express = require('express');
const { body } = require('express-validator');
const createError = require('http-errors');
const traccar = require('../services/traccar');
const mspf = require('../services/mspf');
const foxlogger = require('../services/foxlogger');
const deviceRouter = require('../services/deviceRouter');
const db = require('../db');
const config = require('../config');
const validate = require('../middleware/validate');
const { logger } = require('../middleware/logger');
const { runAutoSync } = require('../services/autoSync');
const { applyRules, getDeviceRules } = require('../services/customAttributes');
const { statusTracker } = require('../utils/liveStatus');

const router = express.Router();

function overlayLiveStatus(devices) {
  if (!devices || devices.length === 0) return;
  for (const d of devices) {
    const s = statusTracker.getStatus(d.id, d.source);
    if (s) d.status = s;
  }
}

function normalizeTraccarDevice(d) {
  return {
    id: d.id, name: d.name, uniqueId: d.uniqueId,
    status: d.status || 'offline',
    phone: d.phone || undefined, model: d.model || undefined,
    source: 'traccar', group: `traccar_${d.groupId}`,
    lastUpdate: d.lastUpdate || (d.attributes?.motionTime ? new Date(d.attributes.motionTime).toISOString() : undefined),
    voltage: d.attributes?.power ?? undefined,
    internalBattery: d.attributes?.addr_IB ?? undefined,
    batteryLevel: d.attributes?.batteryLevel ?? undefined,
    ignition: d.attributes?.ignition ?? undefined,
    attributes: d.attributes || {},
  };
}

async function enrichMetadata(devices) {
  if (!devices || devices.length === 0) return;
  const bySource = {};
  for (const d of devices) {
    if (!bySource[d.source]) bySource[d.source] = [];
    bySource[d.source].push(d.id);
  }
  const rows = [];
  for (const [source, ids] of Object.entries(bySource)) {
    const r = await db('device_metadata').where({ source }).whereIn('device_id', ids);
    rows.push(...r);
  }
  const metaMap = {};
  for (const r of rows) {
    metaMap[`${r.source}:${r.device_id}`] = r.data;
  }
  for (const d of devices) {
    const raw = metaMap[`${d.source}:${d.id}`];
    if (raw) {
      try { d.metadata = JSON.parse(raw); } catch { d.metadata = {}; }
    } else {
      d.metadata = {};
    }
  }
}

router.get('/', async (req, res, next) => {
  try {
    const { group, source, status, keyword, search, offset = 0, limit = 50 } = req.query;
    const userGroups = req.user.groups || [];
    const isAdmin = req.user.role === 'admin';
    const offsetNum = parseInt(offset, 10);
    const limitNum = Math.min(parseInt(limit, 10), 200);
    const q = keyword || search;

    if (group) {
      const groupId = parseInt(group, 10);
      const groupInfo = await db('groups').where({ id: groupId }).first();
      if (!groupInfo) throw createError(400, 'Invalid group ID', { code: 'ERR_VALIDATION' });
      if (!isAdmin && !userGroups.includes(groupId)) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });

      // Fetch device IDs from device_groups for this custom group
      const dgs = await db('device_groups').where({ group_id: groupId }).select('device_id', 'source');
      if (dgs.length === 0) return res.json({ devices: [], total: 0, offset: offsetNum, limit: limitNum });

      const devices = [];
      const traccarIds = dgs.filter(d => d.source === 'traccar').map(d => d.device_id);
      const mspfIds = dgs.filter(d => d.source === 'mspf').map(d => d.device_id);
      const foxIds = dgs.filter(d => d.source === 'foxlogger').map(d => d.device_id);

      if (traccarIds.length > 0) {
        for (const id of traccarIds) {
          try {
            const data = await traccar.getDevices({ id });
            if (data?.[0]) devices.push(normalizeTraccarDevice(data[0]));
          } catch {}
        }
      }

      if (mspfIds.length > 0) {
        try {
          const data = await mspf.getDevices({ limit: 200 });
          const matched = data.data.filter(d => mspfIds.includes(d.id));
          devices.push(...matched);
        } catch {}
      }

      if (foxIds.length > 0) {
        try {
          const data = await foxlogger.getDevices();
          const matched = data.data.filter(d => foxIds.includes(d.id) || foxIds.includes(d.uniqueId));
          devices.push(...matched);
        } catch {}
      }

      let filtered = devices;
      if (status) filtered = filtered.filter(d => d.status === status);
      if (q) filtered = filtered.filter(d => d.name?.toLowerCase().includes(q.toLowerCase()) || d.uniqueId?.toLowerCase().includes(q.toLowerCase()));

      const paged = filtered.slice(offsetNum, offsetNum + limitNum);
      await enrichMetadata(paged);
      overlayLiveStatus(paged);
      return res.json({ devices: paged, total: filtered.length, offset: offsetNum, limit: limitNum });
    }

    const cacheKey = 'devices:merged';
    let merged = require('../services/cache').get(cacheKey);

    if (!merged) {
      const [traccarResult, mspfResult, foxloggerResult] = await Promise.allSettled([
        traccar.getDevices({ all: true }),
        mspf.getDevices(),
        foxlogger.getDevices(),
      ]);

      merged = [];
      let traccarCount = 0, mspfCount = 0, foxCount = 0;
      if (traccarResult.status === 'fulfilled' && traccarResult.value) {
        const mapped = traccarResult.value.map(normalizeTraccarDevice);
        merged.push(...mapped);
        traccarCount = mapped.length;
      }
      if (mspfResult.status === 'fulfilled' && mspfResult.value.data) {
        merged.push(...mspfResult.value.data);
        mspfCount = mspfResult.value.data.length;
      }
      if (foxloggerResult.status === 'fulfilled' && foxloggerResult.value?.data) {
        merged.push(...foxloggerResult.value.data);
        foxCount = foxloggerResult.value.data.length;
      }

      logger.info(`Device cache built: ${traccarCount} Traccar + ${mspfCount} MSPF + ${foxCount} FoxLogger = ${merged.length} total`);

      merged.sort((a, b) => {
        const aId = String(a.id).padStart(20, '0');
        const bId = String(b.id).padStart(20, '0');
        if (aId !== bId) return aId < bId ? -1 : 1;
        if (a.source < b.source) return -1;
        if (a.source > b.source) return 1;
        return 0;
      });

      deviceRouter.buildDeviceMap(merged);
      require('../services/cache').set(cacheKey, merged, config.cache.ttl);
      runAutoSync();
    }

    let filtered = merged;
    if (!isAdmin) {
      if (userGroups.length === 0) {
        filtered = [];
      } else {
        const mappings = await db('device_groups').whereIn('group_id', userGroups).select('device_id', 'source');
        const allowed = new Set(mappings.map(m => `${m.source}:${m.device_id}`));
        filtered = merged.filter(d => allowed.has(`${d.source}:${d.id}`));
      }
    }
    if (source) filtered = filtered.filter(d => d.source === source);
    if (status) filtered = filtered.filter(d => d.status === status);
    if (q) filtered = filtered.filter(d => d.name?.toLowerCase().includes(q.toLowerCase()) || d.uniqueId?.toLowerCase().includes(q.toLowerCase()));

    const total = filtered.length;
    const paged = filtered.slice(offsetNum, offsetNum + limitNum);

    // Apply custom attributes per-device (non-admin only)
    if (!isAdmin && userGroups.length > 0) {
      for (const d of paged) {
        const rules = await getDeviceRules(d.id, d.source);
        if (rules.length > 0) {
          const cloned = { ...d, attributes: { ...d.attributes } };
          applyRules(cloned, rules);
          Object.assign(d, cloned);
        }
      }
    }

    // Enrich with custom groups
    if (paged.length > 0) {
      const ids = paged.map(d => d.id);
      const sources = [...new Set(paged.map(d => d.source))];
      const dgs = await db('device_groups')
        .whereIn('device_id', ids)
        .whereIn('source', sources)
        .join('groups', 'device_groups.group_id', 'groups.id')
        .select('device_groups.device_id', 'device_groups.source', 'groups.id as gid', 'groups.name as gname')
        .modify((qb) => { if (!isAdmin) { if (userGroups.length > 0) qb.whereIn('group_id', userGroups); else qb.where('group_id', -1); } });
      const map = {};
      for (const r of dgs) {
        const k = `${r.source}:${r.device_id}`;
        if (!map[k]) map[k] = [];
        map[k].push({ id: r.gid, name: r.gname });
      }
      for (const d of paged) d.customGroups = map[`${d.source}:${d.id}`] || [];
    }

    await enrichMetadata(paged);
    overlayLiveStatus(paged);
    res.json({ devices: paged, total, offset: offsetNum, limit: limitNum });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { group, source } = req.query;
    const deviceId = parseInt(req.params.id, 10);
    const userGroups = req.user.groups || [];
    const isAdmin = req.user.role === 'admin';
    const devSource = source || (group ? deviceRouter.resolveGroup(group)?.source : null) || deviceRouter.getSourceByDeviceId(deviceId);
    if (!devSource) throw createError(404, 'Device not found', { code: 'ERR_NOT_FOUND' });

    let device;
    if (devSource === 'traccar') {
      const data = await traccar.getDevices({ id: deviceId });
      if (!data[0]) throw createError(404, 'Device not found', { code: 'ERR_NOT_FOUND' });
      device = normalizeTraccarDevice(data[0]);
    } else if (devSource === 'foxlogger') {
      const rawId = req.params.id;
      const data = await foxlogger.getDevices();
      const found = data.data.find(d => d.uniqueId === rawId || String(d.id) === rawId);
      if (!found) throw createError(404, 'Device not found', { code: 'ERR_NOT_FOUND' });
      device = found;
    } else {
      const raw = await mspf.getDevice(deviceId);
      device = await mspf.enrichDevice(raw);
    }

    // Apply custom attributes per-device (non-admin only)
    if (!isAdmin) {
      const rules = await getDeviceRules(device.id, device.source);
      if (rules.length > 0) {
        const cloned = { ...device, attributes: { ...device.attributes } };
        applyRules(cloned, rules);
        Object.assign(device, cloned);
      }
    }

    // Enrich with custom groups
    const dgs = await db('device_groups')
      .where({ device_id: device.id, source: device.source })
      .join('groups', 'device_groups.group_id', 'groups.id')
      .select('groups.id as gid', 'groups.name as gname')
      .modify((qb) => { if (!isAdmin) { if (userGroups.length > 0) qb.whereIn('group_id', userGroups); else qb.where('group_id', -1); } });
    device.customGroups = dgs.map(r => ({ id: r.gid, name: r.gname }));
    await enrichMetadata([device]);
    overlayLiveStatus([device]);

    res.json(device);
  } catch (err) {
    next(err);
  }
});

router.put('/:id/metadata',
  body('metadata').isObject().withMessage('metadata must be an object'),
  validate,
  async (req, res, next) => {
    try {
      const deviceId = parseInt(req.params.id, 10);
      const userGroups = req.user.groups || [];
      const isAdmin = req.user.role === 'admin';
      const devSource = req.body.source || req.query.source || deviceRouter.getSourceByDeviceId(deviceId);
      if (!devSource) throw createError(400, 'source is required', { code: 'ERR_VALIDATION' });

      if (!isAdmin) {
        if (!userGroups.length) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
        const dg = await db('device_groups').where({ device_id: deviceId, source: devSource }).whereIn('group_id', userGroups).first();
        if (!dg) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
      }

      await db('device_metadata')
        .insert({ device_id: deviceId, source: devSource, data: JSON.stringify(req.body.metadata), updated_at: new Date().toISOString() })
        .onConflict(['device_id', 'source'])
        .merge();

      res.json({ deviceId, source: devSource, metadata: req.body.metadata });
    } catch (err) {
      next(err);
    }
  }
);

router.delete('/:id/metadata', async (req, res, next) => {
  try {
    const deviceId = parseInt(req.params.id, 10);
    const userGroups = req.user.groups || [];
    const isAdmin = req.user.role === 'admin';
    const devSource = req.query.source || deviceRouter.getSourceByDeviceId(deviceId);
    if (!devSource) throw createError(400, 'source query param is required', { code: 'ERR_VALIDATION' });

    if (!isAdmin) {
      if (!userGroups.length) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
      const dg = await db('device_groups').where({ device_id: deviceId, source: devSource }).whereIn('group_id', userGroups).first();
      if (!dg) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
    }

    const deleted = await db('device_metadata').where({ device_id: deviceId, source: devSource }).delete();
    if (!deleted) throw createError(404, 'Metadata not found', { code: 'ERR_NOT_FOUND' });

    res.json({ deviceId, source: devSource, deleted: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
