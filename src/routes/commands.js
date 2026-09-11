const express = require('express');
const { body, query } = require('express-validator');
const createError = require('http-errors');
const traccar = require('../services/traccar');
const mspf = require('../services/mspf');
const deviceRouter = require('../services/deviceRouter');
const validate = require('../middleware/validate');
const db = require('../db');
const cache = require('../services/cache');
const { sanitizeLogs } = require('../utils/sanitizer');
const { setEngineDesired, deriveEngineControl } = require('../utils/engineControl');

const router = express.Router();

const TRACCAR_ACTIVATION_MAP = {
  ACTIVE: { type: 'engineResume', description: 'Engine on / resume' },
  INACTIVE: { type: 'engineStop', description: 'Engine off / stop' },
};

const ENGINE_RESUME_TYPES = new Set(['engineResume', 'activate', 'ACTIVE']);
const ENGINE_STOP_TYPES = new Set(['engineStop', 'deactivate', 'INACTIVE']);
const RESTRICTED_CUT_COMMANDS = new Set(['engineStop', 'deactivate', 'INACTIVE']);

// ponytail: binary capability check ceiling: flat boolean flags only -> upgrade path: CASL or custom policy engine if attribute-based rules needed
function canCutEngine(user) {
  if (user?.role === 'admin') return true;
  const perms = typeof user?.permissions === 'string' ? JSON.parse(user.permissions || '{}') : (user?.permissions || {});
  return Boolean(perms.canCutEngine);
}

async function verifyDeviceAccess(user, deviceId, source) {
  if (user?.role === 'admin') return true;
  const userGroups = user?.groups || [];
  if (!userGroups.length) return false;
  const dg = await db('device_groups')
    .where({ device_id: deviceId, source })
    .whereIn('group_id', userGroups)
    .first();
  return Boolean(dg);
}

// ponytail: single table command_logs ceiling: >10M rows/month -> upgrade path: time-series partitioning or stream to ClickHouse/OpenSearch
async function logCommand({
  req,
  deviceId,
  deviceName = null,
  source,
  commandType,
  payload = null,
  confirmed = false,
  reason = null,
  status,
  errorMessage = null,
}) {
  try {
    const user = req?.user;
    const ip = req?.ip || req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || null;
    await db('command_logs').insert({
      user_id: user?.id ?? null,
      username: user?.username ?? 'anonymous',
      role: user?.role ?? 'unknown',
      device_id: deviceId,
      device_name: deviceName,
      source,
      command_type: commandType,
      payload: payload ? (typeof payload === 'string' ? payload : JSON.stringify(payload)) : null,
      confirmed: Boolean(confirmed),
      reason: reason || null,
      status,
      error_message: errorMessage ? String(errorMessage).slice(0, 1000) : null,
      ip_address: ip,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    req?.log?.error?.(`Failed to write command_log: ${err.message}`);
  }
}

router.get('/logs', async (req, res, next) => {
  try {
    const { deviceId, source, userId, status, commandType, from, to, offset = 0, limit = 50 } = req.query;
    const offsetNum = Math.max(0, parseInt(offset, 10) || 0);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const isAdmin = req.user?.role === 'admin';

    let allowedDeviceMap = null;
    if (!isAdmin) {
      const userGroups = req.user?.groups || [];
      if (!userGroups.length) {
        return res.json({ logs: [], total: 0, offset: offsetNum, limit: limitNum });
      }
      const dgs = await db('device_groups')
        .whereIn('group_id', userGroups)
        .select('device_id', 'source');
      if (!dgs.length) {
        return res.json({ logs: [], total: 0, offset: offsetNum, limit: limitNum });
      }
      allowedDeviceMap = dgs;
    }

    const baseQuery = db('command_logs');

    if (!isAdmin && allowedDeviceMap) {
      baseQuery.where(function () {
        for (const dg of allowedDeviceMap) {
          this.orWhere({ device_id: dg.device_id, source: dg.source });
        }
      });
    }

    if (deviceId) baseQuery.where('device_id', parseInt(deviceId, 10));
    if (source) baseQuery.where('source', source);
    if (isAdmin && userId) baseQuery.where('user_id', parseInt(userId, 10));
    if (status) baseQuery.where('status', status.toUpperCase());
    if (commandType) baseQuery.where('command_type', commandType);
    if (from) baseQuery.where('created_at', '>=', from);
    if (to) baseQuery.where('created_at', '<=', to);

    const totalRes = await baseQuery.clone().count({ count: '*' }).first();
    const total = totalRes ? parseInt(totalRes.count || totalRes['count(*)'] || 0, 10) : 0;

    const logs = await baseQuery
      .orderBy('created_at', 'desc')
      .offset(offsetNum)
      .limit(limitNum);

    const formatted = logs.map(l => ({
      id: l.id,
      userId: l.user_id,
      username: l.username,
      role: l.role,
      deviceId: l.device_id,
      deviceName: l.device_name,
      source: l.source,
      commandType: l.command_type,
      payload: l.payload ? JSON.parse(l.payload) : null,
      confirmed: Boolean(l.confirmed),
      reason: l.reason,
      status: l.status,
      errorMessage: l.error_message,
      ipAddress: l.ip_address,
      createdAt: l.created_at,
    }));

    const outputLogs = sanitizeLogs(formatted, isAdmin);
    res.json({ logs: outputLogs, total, offset: offsetNum, limit: limitNum });
  } catch (err) {
    next(err);
  }
});

router.post('/',
  body('deviceId').notEmpty().withMessage('deviceId is required'),
  body('type').notEmpty().withMessage('type is required'),
  body('confirm').optional().isBoolean().withMessage('confirm must be a boolean'),
  body('reason').optional().isString().withMessage('reason must be a string'),
  validate,
  async (req, res, next) => {
    try {
      const { deviceId, type, data = {}, group, source, confirm, reason } = req.body;
      const idNum = parseInt(deviceId, 10);

      let devSource = source;
      if (group) { const p = deviceRouter.resolveGroup(group); if (p) devSource = p.source; }
      if (!devSource) devSource = deviceRouter.getSourceByDeviceId(idNum);
      if (!devSource) throw createError(404, 'Device not found', { code: 'ERR_NOT_FOUND' });

      if (devSource === 'foxlogger') {
        throw createError(400, 'Remote commands are not supported for FoxLogger devices', { code: 'ERR_NOT_SUPPORTED' });
      }

      // 1. Verify device access for customer
      const hasAccess = await verifyDeviceAccess(req.user, idNum, devSource);
      if (!hasAccess) {
        await logCommand({
          req,
          deviceId: idNum,
          source: devSource,
          commandType: type,
          payload: data,
          confirmed: Boolean(confirm),
          reason,
          status: 'REJECTED',
          errorMessage: 'Forbidden: You do not have access to this device',
        });
        throw createError(403, 'Forbidden: You do not have access to this device', { code: 'ERR_FORBIDDEN' });
      }

      // 2. Engine cut capability check
      const isCutEngine = RESTRICTED_CUT_COMMANDS.has(type);
      if (isCutEngine && !canCutEngine(req.user)) {
        await logCommand({
          req,
          deviceId: idNum,
          source: devSource,
          commandType: type,
          payload: data,
          confirmed: Boolean(confirm),
          reason,
          status: 'REJECTED',
          errorMessage: 'Forbidden: You do not have permission to stop vehicle engine',
        });
        throw createError(403, 'Forbidden: You do not have permission to stop vehicle engine', { code: 'ERR_FORBIDDEN' });
      }

      // 3. Safety Notice & Confirmation check for engine cut
      if (isCutEngine && confirm !== true) {
        return res.status(422).json({
          success: false,
          code: 'WARN_CONFIRMATION_REQUIRED',
          requiresConfirmation: true,
          message: 'Confirmation required: Stopping vehicle engine carries safety risks. Set confirm: true to proceed.',
          safetyNotice: 'Kendaraan hanya dapat dimatikan saat kondisi aman. Pastikan konfirmasi disetujui.',
          deviceId: idNum,
          commandType: type,
        });
      }

      // 4. Debounce check
      // ponytail: in-memory debounce ceiling: multi-instance node cluster -> upgrade path: Redis redlock / SET NX
      const debounceKey = `debounce:cmd:${devSource}:${idNum}`;
      if (cache.get(debounceKey)) {
        throw createError(429, 'A command was recently sent to this device. Please wait a few seconds.', { code: 'ERR_RATE_LIMIT' });
      }
      cache.set(debounceKey, true, 5);

      try {
        let result;
        if (devSource === 'traccar') {
          const traccarType = ENGINE_RESUME_TYPES.has(type)
            ? 'engineResume'
            : (ENGINE_STOP_TYPES.has(type) ? 'engineStop' : type);
          result = await traccar.sendCommand({ deviceId: idNum, type: traccarType, ...data });
        } else {
          if (ENGINE_RESUME_TYPES.has(type)) {
            result = await mspf.activateDevice(idNum, 'ACTIVE');
          } else if (ENGINE_STOP_TYPES.has(type)) {
            result = await mspf.activateDevice(idNum, 'INACTIVE');
          } else {
            throw createError(400, `Command type '${type}' is not supported for this device`, { code: 'ERR_NOT_SUPPORTED' });
          }
        }

        await logCommand({
          req,
          deviceId: idNum,
          source: devSource,
          commandType: type,
          payload: data,
          confirmed: Boolean(confirm),
          reason,
          status: 'SUCCESS',
        });

        let engineControl = null;
        if (ENGINE_STOP_TYPES.has(type)) {
          setEngineDesired(idNum, devSource, 'INACTIVE');
          engineControl = { desired: 'INACTIVE', state: 'DEACTIVATING', isApplied: false, lastAppliedAt: null };
        } else if (ENGINE_RESUME_TYPES.has(type)) {
          setEngineDesired(idNum, devSource, 'ACTIVE');
          engineControl = { desired: 'ACTIVE', state: 'ACTIVATING', isApplied: false, lastAppliedAt: null };
        }

        const isAdmin = req.user?.role === 'admin';
        res.json({
          success: true,
          message: 'Command sent',
          deviceId: idNum,
          commandType: type,
          ...(isAdmin ? { source: devSource } : {}),
          ...(engineControl ? { engineControl } : {}),
          data: result,
        });
      } catch (err) {
        await logCommand({
          req,
          deviceId: idNum,
          source: devSource,
          commandType: type,
          payload: data,
          confirmed: Boolean(confirm),
          reason,
          status: 'FAILED',
          errorMessage: err.message,
        });
        throw err;
      }
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

    const isAdmin = req.user?.role === 'admin';

    if (devSource === 'foxlogger') {
      return res.json({ types: [], ...(isAdmin ? { source: 'foxlogger' } : {}) });
    }

    const hasAccess = await verifyDeviceAccess(req.user, deviceId, devSource);
    if (!hasAccess) throw createError(403, 'Forbidden: You do not have access to this device', { code: 'ERR_FORBIDDEN' });

    let types;
    if (devSource === 'traccar') {
      types = await traccar.getCommandTypes({ deviceId });
    } else {
      types = ['engineResume', 'engineStop', 'activate', 'deactivate'];
    }

    // Filter out engine cut commands if user does not have permission
    if (!canCutEngine(req.user)) {
      types = (types || []).filter(t => !RESTRICTED_CUT_COMMANDS.has(t));
    }

    res.json({ types, ...(isAdmin ? { source: devSource } : {}) });
  } catch (err) {
    next(err);
  }
});

router.put('/:deviceId/activation',
  body('desiredStatus').isIn(['ACTIVE', 'INACTIVE']).withMessage('desiredStatus must be ACTIVE or INACTIVE'),
  body('confirm').optional().isBoolean().withMessage('confirm must be a boolean'),
  body('reason').optional().isString().withMessage('reason must be a string'),
  validate,
  async (req, res, next) => {
    try {
      const deviceId = parseInt(req.params.deviceId, 10);
      const { desiredStatus, group, source, confirm, reason } = req.body;

      let devSource = source;
      if (group) { const p = deviceRouter.resolveGroup(group); if (p) devSource = p.source; }
      if (!devSource) devSource = deviceRouter.getSourceByDeviceId(deviceId);
      if (!devSource) throw createError(404, 'Device not found', { code: 'ERR_NOT_FOUND' });

      if (devSource === 'foxlogger') {
        throw createError(400, 'Remote commands are not supported for FoxLogger devices', { code: 'ERR_NOT_SUPPORTED' });
      }

      // 1. Verify device access for customer
      const hasAccess = await verifyDeviceAccess(req.user, deviceId, devSource);
      if (!hasAccess) {
        await logCommand({
          req,
          deviceId,
          source: devSource,
          commandType: desiredStatus,
          payload: { desiredStatus },
          confirmed: Boolean(confirm),
          reason,
          status: 'REJECTED',
          errorMessage: 'Forbidden: You do not have access to this device',
        });
        throw createError(403, 'Forbidden: You do not have access to this device', { code: 'ERR_FORBIDDEN' });
      }

      // 2. Engine cut capability check for INACTIVE
      const isCutEngine = (desiredStatus === 'INACTIVE');
      if (isCutEngine && !canCutEngine(req.user)) {
        await logCommand({
          req,
          deviceId,
          source: devSource,
          commandType: desiredStatus,
          payload: { desiredStatus },
          confirmed: Boolean(confirm),
          reason,
          status: 'REJECTED',
          errorMessage: 'Forbidden: You do not have permission to stop vehicle engine',
        });
        throw createError(403, 'Forbidden: You do not have permission to stop vehicle engine', { code: 'ERR_FORBIDDEN' });
      }

      // 3. Safety Notice & Confirmation check
      if (isCutEngine && confirm !== true) {
        return res.status(422).json({
          success: false,
          code: 'WARN_CONFIRMATION_REQUIRED',
          requiresConfirmation: true,
          message: 'Confirmation required: Stopping vehicle engine carries safety risks. Set confirm: true to proceed.',
          safetyNotice: 'Kendaraan hanya dapat dimatikan saat kondisi aman. Pastikan konfirmasi disetujui.',
          deviceId,
          desiredStatus,
        });
      }

      // 4. Debounce check
      // ponytail: in-memory debounce ceiling: multi-instance node cluster -> upgrade path: Redis redlock / SET NX
      const debounceKey = `debounce:cmd:${devSource}:${deviceId}`;
      if (cache.get(debounceKey)) {
        throw createError(429, 'A command was recently sent to this device. Please wait a few seconds.', { code: 'ERR_RATE_LIMIT' });
      }
      cache.set(debounceKey, true, 5);

      try {
        let result;
        let commandType;
        if (devSource === 'mspf') {
          commandType = desiredStatus;
          result = await mspf.activateDevice(deviceId, desiredStatus);
        } else {
          const cmd = TRACCAR_ACTIVATION_MAP[desiredStatus];
          commandType = cmd.type;
          result = await traccar.sendCommand({ deviceId, type: cmd.type });
        }

        await logCommand({
          req,
          deviceId,
          source: devSource,
          commandType,
          payload: { desiredStatus },
          confirmed: Boolean(confirm),
          reason,
          status: 'SUCCESS',
        });

        let engineControl = null;
        if (desiredStatus === 'INACTIVE') {
          setEngineDesired(deviceId, devSource, 'INACTIVE');
          engineControl = { desired: 'INACTIVE', state: 'DEACTIVATING', isApplied: false, lastAppliedAt: null };
        } else if (desiredStatus === 'ACTIVE') {
          setEngineDesired(deviceId, devSource, 'ACTIVE');
          engineControl = { desired: 'ACTIVE', state: 'ACTIVATING', isApplied: false, lastAppliedAt: null };
        }

        const isAdmin = req.user?.role === 'admin';
        res.json({
          success: true,
          deviceId,
          desiredStatus,
          commandType: devSource === 'traccar' ? TRACCAR_ACTIVATION_MAP[desiredStatus].type : desiredStatus,
          ...(isAdmin ? { source: devSource } : {}),
          ...(engineControl ? { engineControl } : {}),
          data: result,
        });
      } catch (err) {
        await logCommand({
          req,
          deviceId,
          source: devSource,
          commandType: desiredStatus,
          payload: { desiredStatus },
          confirmed: Boolean(confirm),
          reason,
          status: 'FAILED',
          errorMessage: err.message,
        });
        throw err;
      }
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
