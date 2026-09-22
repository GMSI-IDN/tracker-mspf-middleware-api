// ponytail: engineControl state derivation ceiling: polling-based state reconciliation without hardware bi-directional ACK stream -> upgrade path: dedicated IoT device shadow / digital twin state engine
const cache = require('../services/cache');

const RECONCILE_TIMEOUT_MS = 60000;

function getEngineDesired(deviceId, source) {
  if (!deviceId || !source) return null;
  return cache.get(`engine:desired:${source}:${deviceId}`) || null;
}

function setEngineDesired(deviceId, source, desired, logId = null) {
  if (!deviceId || !source) return;
  cache.set(`engine:desired:${source}:${deviceId}`, {
    desired,
    updatedAt: new Date().toISOString(),
    transitionSeen: false,
    logId: logId || null,
  }, 86400); // 24h TTL
}

function clearEngineDesired(deviceId, source) {
  if (!deviceId || !source) return;
  cache.del(`engine:desired:${source}:${deviceId}`);
}

// ponytail: async command_log failure update ceiling: process crash before async DB update -> upgrade path: persistent transaction outbox / task queue
async function markCommandLogFailed(logId, errorMessage) {
  if (!logId) return;
  try {
    const db = require('../db');
    await db('command_logs').where({ id: logId }).update({
      status: 'FAILED',
      error_message: errorMessage ? String(errorMessage).slice(0, 1000) : 'Command execution aborted or rolled back by provider',
    });
  } catch {}
}

function updateMergedDeviceCache(deviceId, source, patch) {
  try {
    const merged = cache.get('devices:merged');
    if (!merged || !Array.isArray(merged)) return;
    const target = merged.find(d => d.id === deviceId && d.source === source);
    if (target) {
      if (patch.attributes) {
        target.attributes = { ...(target.attributes || {}), ...patch.attributes };
      }
      Object.assign(target, patch);
    }
  } catch {}
}

function deriveEngineControl(device, sourceOverride) {
  const source = device?.source || sourceOverride;
  if (!device || source === 'foxlogger') return null;

  const deviceId = device.id ?? device.deviceId;
  const attrs = device.attributes || {};
  const cached = getEngineDesired(deviceId, source);
  const cachedDesired = cached?.desired || null;

  let desired = cachedDesired;
  let state = 'UNKNOWN';
  let isApplied = false;
  let lastAppliedAt = null;

  const elapsedMs = cached?.updatedAt ? Date.now() - new Date(cached.updatedAt).getTime() : 0;
  const isTimedOut = elapsedMs >= RECONCILE_TIMEOUT_MS;

  if (source === 'mspf') {
    const rawStatus = attrs.activationStatus || attrs.activationCurrentStatus || device.activationStatus;

    if (rawStatus === 'INACTIVE') {
      if (desired === 'ACTIVE') {
        if (cached?.transitionSeen) {
          // ponytail: provider rollback detection: activation aborted by provider (reverted from ACTIVATING to INACTIVE) -> upgrade path: Webhook-driven event sourcing
          state = 'INACTIVE';
          isApplied = true;
          desired = 'INACTIVE';
          lastAppliedAt = attrs.updatedAt || device.lastUpdate || null;
          markCommandLogFailed(cached.logId, 'Activation command aborted by provider (transition rolled back to INACTIVE)');
          clearEngineDesired(deviceId, source);
          updateMergedDeviceCache(deviceId, source, { attributes: { activationStatus: 'INACTIVE' } });
        } else if (isTimedOut) {
          state = 'INACTIVE';
          isApplied = true;
          desired = 'INACTIVE';
          lastAppliedAt = attrs.updatedAt || device.lastUpdate || null;
          markCommandLogFailed(cached.logId, 'Activation command timed out after 60s (device remained INACTIVE)');
          clearEngineDesired(deviceId, source);
          updateMergedDeviceCache(deviceId, source, { attributes: { activationStatus: 'INACTIVE' } });
        } else {
          state = 'ACTIVATING';
          isApplied = false;
        }
      } else {
        state = 'INACTIVE';
        isApplied = true;
        desired = 'INACTIVE';
        lastAppliedAt = attrs.updatedAt || device.lastUpdate || cached?.updatedAt || null;
        if (cached?.desired === 'INACTIVE') {
          clearEngineDesired(deviceId, source);
        }
      }
    } else if (rawStatus === 'DEACTIVATING') {
      state = 'DEACTIVATING';
      isApplied = false;
      desired = 'INACTIVE';
      if (cached && !cached.transitionSeen) {
        cached.transitionSeen = true;
        cache.set(`engine:desired:${source}:${deviceId}`, cached, 86400);
      }
    } else if (rawStatus === 'ACTIVATING') {
      state = 'ACTIVATING';
      isApplied = false;
      desired = 'ACTIVE';
      if (cached && !cached.transitionSeen) {
        cached.transitionSeen = true;
        cache.set(`engine:desired:${source}:${deviceId}`, cached, 86400);
      }
    } else if (rawStatus === 'ACTIVE') {
      if (desired === 'INACTIVE') {
        if (cached?.transitionSeen) {
          // ponytail: provider rollback detection: transitionSeen was true but status reverted to ACTIVE -> upgrade path: Webhook-driven event sourcing
          state = 'ACTIVE';
          isApplied = true;
          desired = 'ACTIVE';
          lastAppliedAt = attrs.updatedAt || device.lastUpdate || null;
          markCommandLogFailed(cached.logId, 'Command aborted by provider (transition rolled back to ACTIVE)');
          clearEngineDesired(deviceId, source);
          updateMergedDeviceCache(deviceId, source, { attributes: { activationStatus: 'ACTIVE' } });
        } else if (isTimedOut) {
          state = 'ACTIVE';
          isApplied = true;
          desired = 'ACTIVE';
          lastAppliedAt = attrs.updatedAt || device.lastUpdate || null;
          markCommandLogFailed(cached.logId, 'Command execution timed out after 60s (device remained ACTIVE)');
          clearEngineDesired(deviceId, source);
          updateMergedDeviceCache(deviceId, source, { attributes: { activationStatus: 'ACTIVE' } });
        } else {
          state = 'DEACTIVATING';
          isApplied = false;
        }
      } else {
        state = 'ACTIVE';
        isApplied = true;
        desired = desired || 'ACTIVE';
        lastAppliedAt = attrs.updatedAt || device.lastUpdate || cached?.updatedAt || null;
        if (cached?.desired === 'ACTIVE') {
          clearEngineDesired(deviceId, source);
        }
      }
    } else if (desired === 'INACTIVE') {
      if (isTimedOut) {
        const isEngineOff = attrs.ignition === false || device.ignition === false || device.status === 'offline' || attrs.running === 'OFF' || device.speed === 0;
        if (isEngineOff) {
          // ponytail: No-ACK GPS tracker heuristic: auto-reconciled after 60s timeout when ignition/speed is OFF -> upgrade path: dedicated IoT hardware ACK protocol
          state = 'INACTIVE';
          isApplied = true;
          lastAppliedAt = cached?.updatedAt || device.lastUpdate || null;
          clearEngineDesired(deviceId, source);
          updateMergedDeviceCache(deviceId, source, { attributes: { activationStatus: 'INACTIVE' } });
        } else {
          state = 'ACTIVE';
          isApplied = true;
          desired = 'ACTIVE';
          markCommandLogFailed(cached?.logId, 'Command execution timed out after 60s (device remained active)');
          clearEngineDesired(deviceId, source);
        }
      } else {
        state = 'DEACTIVATING';
        isApplied = false;
      }
    } else if (desired === 'ACTIVE') {
      if (cached?.transitionSeen) {
        state = 'INACTIVE';
        isApplied = true;
        desired = 'INACTIVE';
        lastAppliedAt = device.lastUpdate || null;
        markCommandLogFailed(cached?.logId, 'Activation command aborted by provider');
        clearEngineDesired(deviceId, source);
      } else if (isTimedOut) {
        state = 'ACTIVE';
        isApplied = true;
        lastAppliedAt = device.lastUpdate || cached?.updatedAt || null;
        clearEngineDesired(deviceId, source);
      } else {
        state = 'ACTIVE';
        isApplied = true;
        lastAppliedAt = device.lastUpdate || cached?.updatedAt || null;
      }
    } else {
      state = 'ACTIVE';
      isApplied = true;
      desired = 'ACTIVE';
      lastAppliedAt = device.lastUpdate || null;
    }
  } else if (source === 'traccar') {
    const isBlocked = attrs.blocked === true;

    if (isBlocked) {
      if (desired === 'ACTIVE') {
        if (isTimedOut) {
          // ponytail: Traccar resume timeout: blocked remained true after 60s -> upgrade path: SMS fallback or device protocol ACK
          state = 'INACTIVE';
          isApplied = true;
          desired = 'INACTIVE';
          lastAppliedAt = device.lastUpdate || null;
          markCommandLogFailed(cached?.logId, 'engineResume timed out after 60s (device remained blocked)');
          clearEngineDesired(deviceId, source);
          updateMergedDeviceCache(deviceId, source, { attributes: { blocked: true } });
        } else {
          state = 'ACTIVATING';
          isApplied = false;
        }
      } else {
        state = 'INACTIVE';
        isApplied = true;
        desired = desired || 'INACTIVE';
        lastAppliedAt = device.lastUpdate || cached?.updatedAt || null;
        if (cached?.desired === 'INACTIVE') {
          clearEngineDesired(deviceId, source);
        }
      }
    } else if (desired === 'INACTIVE') {
      if (isTimedOut) {
        const isEngineOff = attrs.ignition === false || device.ignition === false || device.status === 'offline' || attrs.running === 'OFF' || device.speed === 0;
        if (isEngineOff) {
          // ponytail: No-ACK GPS tracker heuristic: auto-reconciled after 60s timeout when ignition/speed is OFF -> upgrade path: dedicated IoT hardware ACK protocol
          state = 'INACTIVE';
          isApplied = true;
          lastAppliedAt = cached?.updatedAt || device.lastUpdate || null;
          clearEngineDesired(deviceId, source);
          updateMergedDeviceCache(deviceId, source, { attributes: { blocked: true } });
        } else {
          state = 'ACTIVE';
          isApplied = true;
          desired = 'ACTIVE';
          lastAppliedAt = device.lastUpdate || null;
          markCommandLogFailed(cached?.logId, 'Command execution timed out after 60s (device remained active)');
          clearEngineDesired(deviceId, source);
        }
      } else {
        state = 'DEACTIVATING';
        isApplied = false;
      }
    } else if (desired === 'ACTIVE') {
      state = 'ACTIVE';
      isApplied = true;
      lastAppliedAt = device.lastUpdate || cached?.updatedAt || null;
      if (cached?.desired === 'ACTIVE') {
        clearEngineDesired(deviceId, source);
      }
    } else {
      state = 'ACTIVE';
      isApplied = true;
      desired = 'ACTIVE';
      lastAppliedAt = device.lastUpdate || null;
    }
  }

  return {
    desired,
    state,
    isApplied,
    lastAppliedAt,
  };
}

module.exports = {
  deriveEngineControl,
  getEngineDesired,
  setEngineDesired,
  clearEngineDesired,
  markCommandLogFailed,
  updateMergedDeviceCache,
  RECONCILE_TIMEOUT_MS,
};
