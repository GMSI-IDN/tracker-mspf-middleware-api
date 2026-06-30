const express = require('express');
const traccar = require('../services/traccar');
const mspf = require('../services/mspf');
const cache = require('../services/cache');
const db = require('../db');

const router = express.Router();

function getDevicesFromCache() {
  const merged = cache.get('devices:merged');
  return merged || [];
}

function summariseDevices(devices, allowedDevices) {
  let filtered = devices;
  if (allowedDevices) {
    filtered = devices.filter(d => allowedDevices.has(`${d.source}:${d.id}`));
  }
  const total = filtered.length;
  const online = filtered.filter(d => d.status === 'online').length;
  const offline = filtered.filter(d => d.status === 'offline').length;
  const bySource = {};
  for (const d of filtered) {
    if (!bySource[d.source]) bySource[d.source] = 0;
    bySource[d.source]++;
  }
  return { total, online, offline, bySource };
}

function summariseRunningStatus(devices, allowedDevices) {
  let filtered = devices;
  if (allowedDevices) {
    filtered = devices.filter(d => allowedDevices.has(`${d.source}:${d.id}`));
  }
  const counts = { RUN: 0, IDLING: 0, STOP: 0, TOWING: 0, UNKNOWN: 0 };
  for (const d of filtered) {
    const running = d.running || d.attributes?.running || (d.status === 'online' ? 'UNKNOWN' : 'STOP');
    counts[running] = (counts[running] || 0) + 1;
  }
  return counts;
}

router.get('/', async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const isAdmin = req.user.role === 'admin';
    const userGroups = req.user.groups || [];
    const devices = getDevicesFromCache();

    let allowedDevices = null;
    if (!isAdmin && userGroups.length > 0) {
      const dgs = await db('device_groups').whereIn('group_id', userGroups).select('device_id', 'source');
      allowedDevices = new Set(dgs.map(d => `${d.source}:${d.device_id}`));
    }

    const deviceStats = summariseDevices(devices, allowedDevices);
    const runningStatus = summariseRunningStatus(devices, allowedDevices);

    let summary = null;
    if (from) {
      const [traccarResult, mspfResult] = await Promise.allSettled([
        traccar.getReportSummary({ from, to: to || undefined }),
        mspf.getStatsSummary(),
      ]);

      let totalDistance = 0, totalFuel = 0, totalEngineHours = 0, totalDrivingHours = 0;

      if (traccarResult.status === 'fulfilled') {
        for (const s of traccarResult.value) {
          if (allowedDevices && !allowedDevices.has(`traccar:${s.deviceId}`)) continue;
          totalDistance += s.distance || 0;
          totalFuel += s.spentFuel || 0;
          totalEngineHours += s.engineHours || 0;
          totalDrivingHours += (s.duration || 0) / 3600;
        }
      }
      if (mspfResult.status === 'fulfilled') {
        const data = mspfResult.value?.data || [];
        for (const s of data) {
          if (allowedDevices && !allowedDevices.has(`mspf:${s.deviceId}`)) continue;
          totalDistance += (s.totalMileage || 0);
          totalDrivingHours += (s.totalDrivingTime || 0) / 3600;
        }
      }

      summary = {
        totalDistance: parseFloat(totalDistance.toFixed(1)),
        totalDrivingHours: parseFloat(totalDrivingHours.toFixed(1)),
        totalFuel: totalFuel > 0 ? parseFloat(totalFuel.toFixed(1)) : null,
        totalEngineHours: totalEngineHours > 0 ? Math.round(totalEngineHours) : null,
      };
    }

    let recentEvents = [];
    try {
      const eventFrom = from || new Date(Date.now() - 7 * 86400000).toISOString();
      const eventTo = to || new Date().toISOString();
      const data = await traccar.getReportEvents({ from: eventFrom, to: eventTo });
      for (const e of (data || [])) {
        if (allowedDevices && !allowedDevices.has(`traccar:${e.deviceId}`)) continue;
        recentEvents.push({
          name: e.type === 'geofenceEnter' || e.type === 'geofenceExit' ? null : e.type.replace(/([A-Z])/g, ' $1').trim().replace(/^./, s => s.toUpperCase()),
          eventTime: e.eventTime,
          status: null,
          deviceId: e.deviceId,
          source: 'traccar',
        });
        if (recentEvents.length >= 10) break;
      }
    } catch {}

    res.json({
      period: { from: from || null, to: to || new Date().toISOString() },
      devices: deviceStats,
      runningStatus,
      summary,
      recentEvents,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
