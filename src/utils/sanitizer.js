// ponytail: shallow property deletion ceiling: deeply nested custom provider debug fields -> upgrade path: schema-based serializer (e.g. Zod/Joi view projections)

function sanitizeDevice(device, isAdmin) {
  if (isAdmin || !device) return device;
  const copy = { ...device };
  delete copy.source;
  delete copy.group;
  return copy;
}

function sanitizeDevices(devices, isAdmin) {
  if (isAdmin || !Array.isArray(devices)) return devices;
  return devices.map(d => sanitizeDevice(d, isAdmin));
}

function sanitizePosition(position, isAdmin) {
  if (isAdmin || !position) return position;
  const copy = { ...position };
  delete copy.source;
  return copy;
}

function sanitizePositions(positions, isAdmin) {
  if (isAdmin || !Array.isArray(positions)) return positions;
  return positions.map(p => sanitizePosition(p, isAdmin));
}

function sanitizeLog(log, isAdmin) {
  if (isAdmin || !log) return log;
  const copy = { ...log };
  delete copy.source;
  return copy;
}

function sanitizeLogs(logs, isAdmin) {
  if (isAdmin || !Array.isArray(logs)) return logs;
  return logs.map(l => sanitizeLog(l, isAdmin));
}

function sanitizeReportItem(item, isAdmin) {
  if (isAdmin || !item) return item;
  const copy = { ...item };
  delete copy.source;
  return copy;
}

function sanitizeReportItems(items, isAdmin) {
  if (isAdmin || !Array.isArray(items)) return items;
  return items.map(i => sanitizeReportItem(i, isAdmin));
}

module.exports = {
  sanitizeDevice,
  sanitizeDevices,
  sanitizePosition,
  sanitizePositions,
  sanitizeLog,
  sanitizeLogs,
  sanitizeReportItem,
  sanitizeReportItems,
};
