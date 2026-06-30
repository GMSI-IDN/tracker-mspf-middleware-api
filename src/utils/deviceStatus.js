const STALE_MS = 24 * 3600 * 1000;

function calcRunningStatus(ignition, speed, lastUpdate) {
  if (lastUpdate) {
    const age = Date.now() - new Date(lastUpdate).getTime();
    if (age > STALE_MS) return 'UNKNOWN';
  }
  if (ignition === undefined || speed === undefined) return 'UNKNOWN';
  if (ignition && speed > 0) return 'RUN';
  if (ignition && speed === 0) return 'IDLING';
  if (!ignition && speed === 0) return 'STOP';
  if (!ignition && speed > 0) return 'TOWING';
  return 'UNKNOWN';
}

function deriveRunningStatus(attributes, speed, lastUpdate) {
  const ignition = attributes?.ignition;

  if (lastUpdate) {
    const age = Date.now() - new Date(lastUpdate).getTime();
    if (age > STALE_MS && attributes?.running) return 'UNKNOWN';
  }

  if (attributes?.running && attributes.running !== 'UNKNOWN') {
    return attributes.running;
  }

  return calcRunningStatus(ignition, speed, lastUpdate);
}

module.exports = { calcRunningStatus, deriveRunningStatus };
