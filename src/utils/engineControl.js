// ponytail: engineControl state derivation ceiling: polling-based state reconciliation without hardware bi-directional ACK stream -> upgrade path: dedicated IoT device shadow / digital twin state engine
const cache = require('../services/cache');

function getEngineDesired(deviceId, source) {
  if (!deviceId || !source) return null;
  return cache.get(`engine:desired:${source}:${deviceId}`) || null;
}

function setEngineDesired(deviceId, source, desired) {
  if (!deviceId || !source) return;
  cache.set(`engine:desired:${source}:${deviceId}`, {
    desired,
    updatedAt: new Date().toISOString(),
  }, 86400); // 24h TTL
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

  if (source === 'mspf') {
    const rawStatus = attrs.activationStatus || attrs.activationCurrentStatus || device.activationStatus;

    if (rawStatus === 'INACTIVE') {
      state = 'INACTIVE';
      isApplied = true;
      desired = desired || 'INACTIVE';
      lastAppliedAt = attrs.updatedAt || device.lastUpdate || cached?.updatedAt || null;
    } else if (rawStatus === 'DEACTIVATING') {
      state = 'DEACTIVATING';
      isApplied = false;
      desired = 'INACTIVE';
    } else if (rawStatus === 'ACTIVATING') {
      state = 'ACTIVATING';
      isApplied = false;
      desired = 'ACTIVE';
    } else if (rawStatus === 'ACTIVE') {
      if (desired === 'INACTIVE') {
        state = 'DEACTIVATING';
        isApplied = false;
      } else {
        state = 'ACTIVE';
        isApplied = true;
        desired = desired || 'ACTIVE';
        lastAppliedAt = attrs.updatedAt || device.lastUpdate || cached?.updatedAt || null;
      }
    } else if (desired === 'INACTIVE') {
      state = 'DEACTIVATING';
      isApplied = false;
    } else if (desired === 'ACTIVE') {
      state = 'ACTIVE';
      isApplied = true;
      lastAppliedAt = device.lastUpdate || cached?.updatedAt || null;
    } else {
      state = 'ACTIVE';
      isApplied = true;
      desired = 'ACTIVE';
      lastAppliedAt = device.lastUpdate || null;
    }
  } else if (source === 'traccar') {
    const isBlocked = attrs.blocked === true;

    if (isBlocked) {
      state = 'INACTIVE';
      isApplied = true;
      desired = desired || 'INACTIVE';
      lastAppliedAt = device.lastUpdate || cached?.updatedAt || null;
    } else if (desired === 'INACTIVE') {
      state = 'DEACTIVATING';
      isApplied = false;
    } else if (desired === 'ACTIVE') {
      state = 'ACTIVE';
      isApplied = true;
      lastAppliedAt = device.lastUpdate || cached?.updatedAt || null;
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
};
