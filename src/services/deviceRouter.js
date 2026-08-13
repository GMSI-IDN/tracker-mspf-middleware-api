const cache = require('./cache');

function getSourceByDeviceId(deviceId) {
  const strKey = `device:src:${deviceId}`;
  const cached = cache.get(strKey);
  if (cached) return cached;
  // Fallback: strip leading zeros for IMEI matching
  const stripped = String(deviceId).replace(/^0+/, '');
  if (stripped !== String(deviceId)) {
    const strippedKey = `device:src:${stripped}`;
    const found = cache.get(strippedKey);
    if (found) return found;
  }
  return null;
}

function setSourceByDeviceId(deviceId, source) {
  cache.set(`device:src:${deviceId}`, source, 300);
  // Also store alias without leading zeros for IMEI matching
  const stripped = String(deviceId).replace(/^0+/, '');
  if (stripped !== String(deviceId) && stripped.length > 0) {
    cache.set(`device:src:${stripped}`, source, 300);
  }
}

function buildDeviceMap(devices) {
  for (const d of devices) {
    setSourceByDeviceId(d.id, d.source);
  }
}

function getGroupSource(groupId) {
  const parts = groupId.split('_');
  if (parts.length !== 2) return null;
  return { source: parts[0], id: parseInt(parts[1], 10) };
}

function resolveGroup(groupId) {
  const parsed = getGroupSource(groupId);
  if (!parsed) return null;
  return parsed;
}

module.exports = {
  getSourceByDeviceId,
  setSourceByDeviceId,
  buildDeviceMap,
  resolveGroup,
};
