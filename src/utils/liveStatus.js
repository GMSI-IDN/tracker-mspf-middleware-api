const config = require('../config');

function toMs(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function resolveThresholds(source, meta, overrides = {}) {
  const perDevice = meta?.offlineThresholdMs
    || (meta?.reportIntervalMinutes ? meta.reportIntervalMinutes * 60 * 1000 * 2 : 0);
  const perGroup = overrides.perGroup || 0;
  const perType = overrides.perType || 0;
  const perSource = config.live.sourceThresholds[source] || 0;
  return {
    offlineMs: perDevice || perGroup || perType || perSource || config.live.offlineThresholdMs,
    onlineMs: config.live.onlineThresholdMs,
  };
}

function createStatusTracker() {
  const state = new Map();
  const emitChangeOnly = config.live.emitChangeOnly;
  const statusCooldownMs = config.live.statusCooldownMs;

  function stateKey(deviceId, source) {
    return `${source}:${deviceId}`;
  }

  function ensure(deviceId, source) {
    const k = stateKey(deviceId, source);
    let entry = state.get(k);
    if (!entry) {
      entry = {
        deviceId,
        source,
        lastKnownTime: 0,
        lastStatus: null,
        lastEmittedPosKey: null,
        lastStatusFlipAt: 0,
        seenOnce: false,
      };
      state.set(k, entry);
    }
    return entry;
  }

  function posKey(item) {
    return [item.latitude, item.longitude, item.speed, item.course, item.deviceTime, item.attributes?.ignition]
      .map(v => (v === null || v === undefined ? '' : String(v)))
      .join('|');
  }

  function notePosition(item, opts = {}) {
    const now = opts.now || Date.now();
    const offlineMs = opts.offlineMs || config.live.offlineThresholdMs;
    const onlineMs = opts.onlineMs || config.live.onlineThresholdMs;
    const entry = ensure(item.deviceId, item.source);
    const t = toMs(item.deviceTime);
    if (t > entry.lastKnownTime) entry.lastKnownTime = t;
    if (t > 0) entry.seenOnce = true;

    const pKey = posKey(item);
    let shouldEmitPos = true;
    if (emitChangeOnly) {
      shouldEmitPos = pKey !== entry.lastEmittedPosKey;
      if (shouldEmitPos) entry.lastEmittedPosKey = pKey;
    }

    const fresh = t > 0 && now - t <= onlineMs;
    let statusChanged = false;
    let status = entry.lastStatus;
    if (fresh && status !== 'online') {
      status = 'online';
      statusChanged = true;
      entry.lastStatus = 'online';
      entry.lastStatusFlipAt = now;
    } else if (!fresh && status === null) {
      status = now - entry.lastKnownTime <= offlineMs ? 'online' : 'offline';
      entry.lastStatus = status;
      if (status === 'online') entry.lastStatusFlipAt = now;
    }

    return { shouldEmitPos, status, statusChanged, fresh };
  }

  function evaluateStale(deviceId, source, lastKnownTime, opts = {}) {
    const now = opts.now || Date.now();
    const offlineMs = opts.offlineMs || config.live.offlineThresholdMs;
    const entry = ensure(deviceId, source);
    const t = toMs(lastKnownTime);
    if (t > entry.lastKnownTime) entry.lastKnownTime = t;
    if (t > 0) entry.seenOnce = true;

    if (!entry.seenOnce || entry.lastStatus !== 'online') return null;
    if (now - entry.lastKnownTime <= offlineMs) return null;
    if (now - entry.lastStatusFlipAt < statusCooldownMs) return null;

    entry.lastStatus = 'offline';
    entry.lastStatusFlipAt = now;
    return 'offline';
  }

  function setStatus(deviceId, source, status, lastKnownTime, opts = {}) {
    const now = opts.now || Date.now();
    const entry = ensure(deviceId, source);
    const t = toMs(lastKnownTime);
    if (t > entry.lastKnownTime) entry.lastKnownTime = t;
    if (t > 0) entry.seenOnce = true;
    entry.lastStatus = status;
    entry.lastStatusFlipAt = now;
    return entry.lastStatus;
  }

  function getStatus(deviceId, source) {
    return state.get(stateKey(deviceId, source))?.lastStatus || null;
  }

  function getLastKnownTime(deviceId, source) {
    return state.get(stateKey(deviceId, source))?.lastKnownTime || 0;
  }

  function snapshot(filter) {
    const out = [];
    for (const entry of state.values()) {
      if (!entry.lastStatus) continue;
      if (filter && !filter(`${entry.source}:${entry.deviceId}`)) continue;
      out.push({
        deviceId: entry.deviceId,
        source: entry.source,
        status: entry.lastStatus,
        lastKnownTime: entry.lastKnownTime,
      });
    }
    return out;
  }

  function heartbeatDevices() {
    const out = [];
    for (const entry of state.values()) {
      if (!entry.lastStatus) continue;
      out.push({
        deviceId: entry.deviceId,
        source: entry.source,
        status: entry.lastStatus,
        lastKnownTime: entry.lastKnownTime,
      });
    }
    return out;
  }

  function size() {
    return state.size;
  }

  function reset() {
    state.clear();
  }

  return {
    notePosition,
    evaluateStale,
    setStatus,
    getStatus,
    getLastKnownTime,
    snapshot,
    heartbeatDevices,
    size,
    reset,
    resolveThresholds,
  };
}

const statusTracker = createStatusTracker();

module.exports = { createStatusTracker, statusTracker, resolveThresholds, toMs };
