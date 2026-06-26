const cache = require('./cache');

function getSourceByDeviceId(deviceId) {
  return cache.get(`device:src:${deviceId}`);
}

function setSourceByDeviceId(deviceId, source) {
  cache.set(`device:src:${deviceId}`, source, 300);
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
