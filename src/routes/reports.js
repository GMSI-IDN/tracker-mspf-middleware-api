const express = require('express');
const createError = require('http-errors');
const traccar = require('../services/traccar');
const mspf = require('../services/mspf');
const foxlogger = require('../services/foxlogger');
const deviceRouter = require('../services/deviceRouter');
const db = require('../db');
const cache = require('../services/cache');
const config = require('../config');
const { toUtcIso, toUtcDateStr, startOfDayIso } = require('../utils/timestamp');
const { buildSeries } = require('../utils/periodStats');
const { applyRules, enrichWithRules, getDeviceRules } = require('../services/customAttributes');
const { sanitizePositions, sanitizeReportItems } = require('../utils/sanitizer');

const router = express.Router();

function normalizeTraccarPosition(p) {
  return { ...p, source: 'traccar' };
}

async function applyCustomAttributes(positions, user) {
  if (!user) return;
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    if (!pos.deviceId) continue;
    const rules = await getDeviceRules(pos.deviceId, pos.source);
    if (rules.length > 0) {
      const cloned = { ...pos, attributes: { ...pos.attributes } };
      if (user.role === 'admin') {
        enrichWithRules(cloned, rules);
      } else {
        applyRules(cloned, rules);
      }
      positions[i] = cloned;
    } else if (user.role !== 'admin') {
      positions[i] = { ...pos, attributes: {} };
    }
  }
}

router.get('/route', async (req, res, next) => {
  try {
    const { deviceId, group, source, from, to } = req.query;
    if (!deviceId) throw createError(400, 'deviceId is required', { code: 'ERR_VALIDATION' });

    const userTimezone = req.user.timezone || config.timezone.default;
    const effectiveFrom = from || startOfDayIso(new Date(), userTimezone);
    const effectiveTo = to || new Date().toISOString();

    const idNum = parseInt(deviceId, 10);
    const idStr = deviceId;
    let devSource = source;
    if (group) { const p = deviceRouter.resolveGroup(group); if (p) devSource = p.source; }
    // Try integer ID first (Traccar/MSPF), then string ID (FoxLogger IMEI)
    if (!devSource && !isNaN(idNum)) devSource = deviceRouter.getSourceByDeviceId(idNum);
    if (!devSource) devSource = deviceRouter.getSourceByDeviceId(idStr);
    if (!devSource) {
      const [t, m, f] = await Promise.allSettled([
        traccar.getDevices({ id: isNaN(idNum) ? undefined : idNum }),
        mspf.getDevice(isNaN(idNum) ? undefined : idNum),
        foxlogger.waitForInit(3000).then(() => foxlogger.getDevices()).then(d => {
          const rawDeviceId = req.query.deviceId;
          return d.data.find(x =>
            x.uniqueId === rawDeviceId ||
            String(x.id) === rawDeviceId ||
            x.attributes?.vehicleUnit === rawDeviceId ||
            x.attributes?.simcard === rawDeviceId ||
            x.uniqueId.replace(/^0+/, '') === rawDeviceId.replace(/^0+/, '') ||
            String(x.id).replace(/^0+/, '') === rawDeviceId.replace(/^0+/, '')
          );
        }),
      ]);
      if (t.status === 'fulfilled' && t.value?.[0]) {
        devSource = 'traccar';
        deviceRouter.setSourceByDeviceId(idNum, 'traccar');
      } else if (m.status === 'fulfilled' && m.value?.id) {
        devSource = 'mspf';
        deviceRouter.setSourceByDeviceId(idNum, 'mspf');
      } else if (f.status === 'fulfilled' && f.value) {
        devSource = 'foxlogger';
        const foxId = String(f.value.id);
        deviceRouter.setSourceByDeviceId(foxId, 'foxlogger');
        deviceRouter.setSourceByDeviceId(idStr, 'foxlogger');
      } else {
        throw createError(404, 'Device not found', { code: 'ERR_NOT_FOUND' });
      }
    }

    if (req.user.role !== 'admin') {
      if (!req.user.groups?.length) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
      const deviceLookupId = devSource === 'foxlogger' ? deviceId : idNum;
      const dg = await db('device_groups').where({ device_id: deviceLookupId, source: devSource }).whereIn('group_id', req.user.groups).first();
      if (!dg) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
    }

    if (devSource === 'mspf' && effectiveFrom && effectiveTo) {
      const fromMs = new Date(effectiveFrom).getTime();
      const toMs = new Date(effectiveTo).getTime();
      if (toMs - fromMs > 7 * 24 * 3600 * 1000) {
        throw createError(400, 'Date range max 7 days for MSPF devices', { code: 'ERR_VALIDATION' });
      }
    }

    let positions;
    if (devSource === 'traccar') {
      const data = await traccar.getReportRoute({ deviceId: idNum, from: effectiveFrom, to: effectiveTo });
      positions = data.map(normalizeTraccarPosition);
    } else if (devSource === 'foxlogger') {
      const foxId = req.query.deviceId;
      const data = await foxlogger.getDeviceRoute(foxId, { from: effectiveFrom, to: effectiveTo, user_id: foxlogger.getUserId() });
      positions = (data || []).map(p => ({ ...p, source: 'foxlogger' }));
    } else {
      positions = await mspf.getDeviceRoute(idNum, { from: effectiveFrom, to: effectiveTo });
    }

    positions = (positions || []).sort((a, b) => (new Date(a.deviceTime).getTime() || 0) - (new Date(b.deviceTime).getTime() || 0));

    await applyCustomAttributes(positions, req.user);
    res.json(sanitizePositions(positions, req.user.role === 'admin'));
  } catch (err) {
    next(err);
  }
});

function normalizeTraccarStop(stop) {
  return {
    startTime: toUtcIso(stop.startTime),
    endTime: toUtcIso(stop.endTime),
    duration: stop.duration,
    latitude: stop.lat,
    longitude: stop.lon,
    address: stop.address || null,
  };
}

function normalizeMspfParking(deviceId, parking) {
  const durationSeconds = Math.round((parking.parkingTime || 0) * 60);
  const startTime = toUtcIso(parking.parkingStartTime);
  const endTime = startTime ? new Date(new Date(startTime).getTime() + durationSeconds * 1000).toISOString() : null;
  return {
    startTime,
    endTime,
    duration: durationSeconds,
    latitude: parking.position?.lat ?? null,
    longitude: parking.position?.lon ?? null,
    address: null,
  };
}

router.get('/parking', async (req, res, next) => {
  try {
    const { deviceId, group, from, to } = req.query;
    if (!deviceId) throw createError(400, 'deviceId is required', { code: 'ERR_VALIDATION' });
    if (!from) throw createError(400, 'from is required', { code: 'ERR_VALIDATION' });

    const idNum = parseInt(deviceId, 10);
    let devSource = group ? deviceRouter.resolveGroup(group)?.source : null;
    if (!devSource) devSource = deviceRouter.getSourceByDeviceId(idNum);
    if (!devSource) {
      const [t, m, f] = await Promise.allSettled([
        traccar.getDevices({ id: idNum }),
        mspf.getDevice(idNum),
        foxlogger.waitForInit(3000).then(() => foxlogger.getDevices()).then(d => d.data.find(x => x.uniqueId === req.query.deviceId || String(x.id) === req.query.deviceId)),
      ]);
      if (t.status === 'fulfilled' && t.value?.[0]) {
        devSource = 'traccar';
        deviceRouter.setSourceByDeviceId(idNum, 'traccar');
      } else if (m.status === 'fulfilled' && m.value?.id) {
        devSource = 'mspf';
        deviceRouter.setSourceByDeviceId(idNum, 'mspf');
      } else if (f.status === 'fulfilled' && f.value) {
        devSource = 'foxlogger';
        deviceRouter.setSourceByDeviceId(idNum, 'foxlogger');
      } else {
        throw createError(404, 'Device not found', { code: 'ERR_NOT_FOUND' });
      }
    }

    if (req.user.role !== 'admin') {
      if (!req.user.groups?.length) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
      const dg = await db('device_groups').where({ device_id: idNum, source: devSource }).whereIn('group_id', req.user.groups).first();
      if (!dg) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
    }

    let parking;
    if (devSource === 'traccar') {
      const data = await traccar.getReportStops({ deviceId: idNum, from, to });
      parking = (data || [])
        .filter(s => !s.engineHours || s.engineHours === 0)
        .map(normalizeTraccarStop);
    } else if (devSource === 'foxlogger') {
      const foxId = req.query.deviceId;
      const data = await foxlogger.getDeviceParking(foxId, { from, to, user_id: foxlogger.getUserId() });
      parking = (data || []).map(p => ({
        startTime: toUtcIso(p.from_time),
        endTime: toUtcIso(p.to_time),
        duration: (parseInt(p.hour || 0) * 3600) + (parseInt(p.minute || 0) * 60) + (parseInt(p.second || 0)),
        latitude: p.Loc ? parseFloat(p.Loc.split(',')[1]?.replace(/[\[\]]/g, '') || 0) : null,
        longitude: p.Loc ? parseFloat(p.Loc.split(',')[0]?.replace(/[\[\]]/g, '') || 0) : null,
        address: p.addrs || null,
      }));
    } else {
      const data = await mspf.getDeviceParkingAll(idNum, { from, to });
      parking = (data || []).map(p => normalizeMspfParking(idNum, p));
    }

    parking.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

    const totalDuration = parking.reduce((sum, p) => sum + (p.duration || 0), 0);
    const isAdmin = req.user.role === 'admin';

    res.json({
      deviceId: idNum,
      ...(isAdmin ? { source: devSource } : {}),
      period: { from, to: to || new Date().toISOString() },
      parking,
      summary: {
        total: parking.length,
        totalDuration,
      },
    });
  } catch (err) {
    next(err);
  }
});

function calculateIdleSegments(positions) {
  if (!positions || positions.length < 2) return [];
  const sorted = [...positions].sort((a, b) => new Date(a.deviceTime) - new Date(b.deviceTime));
  const segments = [];
  let current = null;

  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const speed = p.speed || 0;
    const ignition = p.attributes?.ignition ?? p.ignition;
    const time = p.deviceTime;
    const isIdle = speed < 1 && ignition === true;

    if (isIdle) {
      if (!current) {
        current = { startTime: time, endTime: time, lat: p.latitude, lon: p.longitude };
      } else {
        current.endTime = time;
      }
    } else {
      if (current) {
        const dur = (new Date(current.endTime).getTime() - new Date(current.startTime).getTime()) / 1000;
        if (dur > 0) segments.push({ startTime: current.startTime, endTime: current.endTime, duration: Math.round(dur), latitude: current.lat, longitude: current.lon, address: null });
        current = null;
      }
    }
  }

  if (current) {
    const dur = (new Date(current.endTime).getTime() - new Date(current.startTime).getTime()) / 1000;
    if (dur > 0) segments.push({ startTime: current.startTime, endTime: current.endTime, duration: Math.round(dur), latitude: current.lat, longitude: current.lon, address: null });
  }

  return segments;
}

router.get('/idle', async (req, res, next) => {
  try {
    const { deviceId, group, from, to } = req.query;
    if (!deviceId) throw createError(400, 'deviceId is required', { code: 'ERR_VALIDATION' });
    if (!from) throw createError(400, 'from is required', { code: 'ERR_VALIDATION' });

    const idNum = parseInt(deviceId, 10);
    let devSource = group ? deviceRouter.resolveGroup(group)?.source : null;
    if (!devSource) devSource = deviceRouter.getSourceByDeviceId(idNum);
    if (!devSource) {
      const [t, m, f] = await Promise.allSettled([
        traccar.getDevices({ id: idNum }),
        mspf.getDevice(idNum),
        foxlogger.waitForInit(3000).then(() => foxlogger.getDevices()).then(d => d.data.find(x => x.uniqueId === req.query.deviceId || String(x.id) === req.query.deviceId)),
      ]);
      if (t.status === 'fulfilled' && t.value?.[0]) {
        devSource = 'traccar';
        deviceRouter.setSourceByDeviceId(idNum, 'traccar');
      } else if (m.status === 'fulfilled' && m.value?.id) {
        devSource = 'mspf';
        deviceRouter.setSourceByDeviceId(idNum, 'mspf');
      } else if (f.status === 'fulfilled' && f.value) {
        devSource = 'foxlogger';
        deviceRouter.setSourceByDeviceId(idNum, 'foxlogger');
      } else {
        throw createError(404, 'Device not found', { code: 'ERR_NOT_FOUND' });
      }
    }

    if (req.user.role !== 'admin') {
      if (!req.user.groups?.length) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
      const dg = await db('device_groups').where({ device_id: idNum, source: devSource }).whereIn('group_id', req.user.groups).first();
      if (!dg) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
    }

    let idle;
    if (devSource === 'traccar') {
      const data = await traccar.getReportStops({ deviceId: idNum, from, to });
      idle = (data || [])
        .filter(s => (s.engineHours || 0) > 0)
        .map(s => ({ startTime: toUtcIso(s.startTime), endTime: toUtcIso(s.endTime), duration: s.duration, latitude: s.lat, longitude: s.lon, address: s.address || null }));
    } else {
      const positions = await mspf.getDeviceRoute(idNum, { from, to });
      idle = calculateIdleSegments(positions || []);
    }

    idle.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

    const totalDuration = idle.reduce((sum, p) => sum + (p.duration || 0), 0);
    const isAdmin = req.user.role === 'admin';

    res.json({
      deviceId: idNum,
      ...(isAdmin ? { source: devSource } : {}),
      period: { from, to: to || new Date().toISOString() },
      idle,
      summary: { total: idle.length, totalDuration },
    });
  } catch (err) {
    next(err);
  }
});

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function enrichMspfTrips(trips, routePositions) {
  if (!trips || trips.length === 0) return [];
  const sortedRoutes = (routePositions || []).sort((a, b) => new Date(a.deviceTime) - new Date(b.deviceTime));

  return trips.map(trip => {
    const startMs = new Date(trip.timeStart).getTime();
    const endMs = new Date(trip.timeEnd).getTime();
    const tripPositions = sortedRoutes.filter(p => {
      const t = new Date(p.deviceTime).getTime();
      return t >= startMs && t <= endMs;
    });

    let distance = 0;
    let maxSpeed = 0;
    for (let i = 1; i < tripPositions.length; i++) {
      const a = tripPositions[i - 1], b = tripPositions[i];
      distance += haversine(a.latitude, a.longitude, b.latitude, b.longitude);
      const spd = b.speed || 0;
      if (spd > maxSpeed) maxSpeed = spd;
    }

    const duration = Math.round((endMs - startMs) / 1000);
    const avgSpeed = duration > 0 ? parseFloat(((distance / duration) * 3600).toFixed(2)) : undefined;

    return {
      startTime: toUtcIso(trip.timeStart),
      endTime: toUtcIso(trip.timeEnd),
      duration,
      startLatitude: trip.positionStart?.lat ?? null,
      startLongitude: trip.positionStart?.lon ?? null,
      endLatitude: trip.positionEnd?.lat ?? null,
      endLongitude: trip.positionEnd?.lon ?? null,
      distance: parseFloat(distance.toFixed(2)),
      averageSpeed: avgSpeed,
      maxSpeed: maxSpeed > 0 ? parseFloat(maxSpeed.toFixed(2)) : undefined,
    };
  });
}

router.get('/trips', async (req, res, next) => {
  try {
    const { deviceId, group, from, to } = req.query;
    if (!deviceId) throw createError(400, 'deviceId is required', { code: 'ERR_VALIDATION' });
    if (!from) throw createError(400, 'from is required', { code: 'ERR_VALIDATION' });

    const idNum = parseInt(deviceId, 10);
    let devSource = group ? deviceRouter.resolveGroup(group)?.source : null;
    if (!devSource) devSource = deviceRouter.getSourceByDeviceId(idNum);
    if (!devSource) {
      const [t, m, f] = await Promise.allSettled([
        traccar.getDevices({ id: idNum }),
        mspf.getDevice(idNum),
        foxlogger.waitForInit(3000).then(() => foxlogger.getDevices()).then(d => d.data.find(x => x.uniqueId === req.query.deviceId || String(x.id) === req.query.deviceId)),
      ]);
      if (t.status === 'fulfilled' && t.value?.[0]) {
        devSource = 'traccar';
        deviceRouter.setSourceByDeviceId(idNum, 'traccar');
      } else if (m.status === 'fulfilled' && m.value?.id) {
        devSource = 'mspf';
        deviceRouter.setSourceByDeviceId(idNum, 'mspf');
      } else if (f.status === 'fulfilled' && f.value) {
        devSource = 'foxlogger';
        deviceRouter.setSourceByDeviceId(idNum, 'foxlogger');
      } else {
        throw createError(404, 'Device not found', { code: 'ERR_NOT_FOUND' });
      }
    }

    if (req.user.role !== 'admin') {
      if (!req.user.groups?.length) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
      const dg = await db('device_groups').where({ device_id: idNum, source: devSource }).whereIn('group_id', req.user.groups).first();
      if (!dg) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
    }

    let trips;
    if (devSource === 'traccar') {
      const data = await traccar.getReportTrips({ deviceId: idNum, from, to });
      trips = (data || []).map(t => ({
        startTime: toUtcIso(t.startTime),
        endTime: toUtcIso(t.endTime),
        duration: t.duration,
        startLatitude: t.startLat,
        startLongitude: t.startLon,
        endLatitude: t.endLat,
        endLongitude: t.endLon,
        startAddress: t.startAddress || null,
        endAddress: t.endAddress || null,
        distance: t.distance,
        averageSpeed: t.averageSpeed,
        maxSpeed: t.maxSpeed,
        spentFuel: t.spentFuel,
        driverName: t.driverName || null,
      }));
    } else {
      const [tripData, routeData] = await Promise.all([
        mspf.getDeviceTrip(idNum, { from, to }),
        mspf.getDeviceRoute(idNum, { from, to }),
      ]);
      trips = enrichMspfTrips(tripData || [], routeData || []);
    }

    trips.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

    const totalDuration = trips.reduce((s, t) => s + (t.duration || 0), 0);
    const totalDistance = trips.reduce((s, t) => s + (t.distance || 0), 0);
    const isAdmin = req.user.role === 'admin';

    res.json({
      deviceId: idNum,
      ...(isAdmin ? { source: devSource } : {}),
      period: { from, to: to || new Date().toISOString() },
      trips,
      summary: { total: trips.length, totalDuration, totalDistance: parseFloat(totalDistance.toFixed(2)) },
    });
  } catch (err) {
    next(err);
  }
});

function enrichMspfSummary(summary, routePositions) {
  if (!routePositions || routePositions.length < 2) return summary;
  const sorted = routePositions.sort((a, b) => new Date(a.deviceTime) - new Date(b.deviceTime));
  let distance = 0, maxSpeed = 0;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i];
    distance += haversine(a.latitude, a.longitude, b.latitude, b.longitude);
    const spd = b.speed || 0;
    if (spd > maxSpeed) maxSpeed = spd;
  }
  const start = new Date(sorted[0].deviceTime).getTime();
  const end = new Date(sorted[sorted.length - 1].deviceTime).getTime();
  const duration = Math.round((end - start) / 1000);
  summary.distance = parseFloat(distance.toFixed(2));
  summary.maxSpeed = maxSpeed > 0 ? parseFloat(maxSpeed.toFixed(2)) : undefined;
  summary.averageSpeed = duration > 0 ? parseFloat(((distance / duration) * 3600).toFixed(2)) : undefined;
  summary.duration = duration;
  summary.engineHours = duration;
  return summary;
}

function summaryResponse(summaries, isAdmin = true) {
  const totalDistance = summaries.reduce((s, r) => s + (r.distance || 0), 0);
  const totalDuration = summaries.reduce((s, r) => s + (r.duration || 0), 0);
  const outputSummaries = isAdmin ? summaries : summaries.map(s => {
    const copy = { ...s };
    delete copy.source;
    return copy;
  });
  return { summaries: outputSummaries, total: { devices: summaries.length, distance: parseFloat(totalDistance.toFixed(2)), duration: totalDuration } };
}

function mspfStatsRowToItem(r) {
  return { time: r.datetime, distance: r.mileage ?? 0, drivingTime: r.drivingtime ?? 0, maxSpeed: null, averageSpeed: null, spentFuel: null };
}

function traccarTripToItem(t) {
  return { time: t.startTime, distance: t.distance ?? 0, drivingTime: t.duration ?? 0, maxSpeed: t.maxSpeed ?? null, averageSpeed: t.averageSpeed ?? null, spentFuel: t.spentFuel ?? null };
}

function foxSummaryRowToItem(r) {
  return {
    time: r.from_time,
    distance: parseFloat(r.distance || 0),
    drivingTime: (parseInt(r.time_hour || 0, 10) * 3600) + (parseInt(r.time_minute || 0, 10) * 60) + parseInt(r.time_second || 0, 10),
    maxSpeed: parseFloat(r.speed_max || 0) || null,
    averageSpeed: parseFloat(r.speed_avg || 0) || null,
    spentFuel: parseFloat(r.fuel_usage || 0) || null,
  };
}

async function probeSummaryDeviceSource(idNum, idStr, group, source) {
  let devSource = source;
  if (group) { const p = deviceRouter.resolveGroup(group); if (p) devSource = p.source; }
  if (!devSource) devSource = deviceRouter.getSourceByDeviceId(idNum);
  if (!devSource) devSource = deviceRouter.getSourceByDeviceId(idStr);
  if (devSource) return devSource;

  const idNumArg = Number.isNaN(idNum) ? undefined : idNum;
  const [t, m, f] = await Promise.allSettled([
    idNumArg ? traccar.getDevices({ id: idNumArg }) : Promise.resolve([]),
    idNumArg ? mspf.getDevice(idNumArg) : Promise.resolve(null),
    foxlogger.waitForInit(3000).then(() => foxlogger.getDevices()).then(d => d.data.find(x =>
      x.uniqueId === idStr ||
      String(x.id) === idStr ||
      x.attributes?.vehicleUnit === idStr ||
      x.attributes?.simcard === idStr ||
      x.uniqueId.replace(/^0+/, '') === String(idStr).replace(/^0+/, '') ||
      String(x.id).replace(/^0+/, '') === String(idStr).replace(/^0+/, '')
    )),
  ]);
  if (t.status === 'fulfilled' && t.value?.[0]) {
    deviceRouter.setSourceByDeviceId(idNum, 'traccar');
    return 'traccar';
  }
  if (m.status === 'fulfilled' && m.value?.id) {
    deviceRouter.setSourceByDeviceId(idNum, 'mspf');
    return 'mspf';
  }
  if (f.status === 'fulfilled' && f.value) {
    deviceRouter.setSourceByDeviceId(String(f.value.id), 'foxlogger');
    deviceRouter.setSourceByDeviceId(idStr, 'foxlogger');
    return 'foxlogger';
  }
  return null;
}

async function collectGroupSummaryItems(dgs, fromIso, toIso) {
  const items = [];
  const traccarIds = dgs.filter(d => d.source === 'traccar').map(d => d.device_id);
  const mspfIds = dgs.filter(d => d.source === 'mspf').map(d => d.device_id);
  const foxIds = dgs.filter(d => d.source === 'foxlogger').map(d => d.device_id);

  if (traccarIds.length > 0) {
    const results = await Promise.allSettled(traccarIds.map(id => traccar.getReportTrips({ deviceId: id, from: fromIso, to: toIso })));
    for (const r of results) {
      if (r.status === 'fulfilled') for (const t of (r.value || [])) items.push(traccarTripToItem(t));
    }
  }

  if (mspfIds.length > 0) {
    const merged = cache.get('devices:merged') || [];
    const idToBc = {};
    for (const d of merged) {
      if (d.source === 'mspf' && d.group) idToBc[d.id] = parseInt(d.group.replace('mspf_', ''), 10);
    }
    const byBc = {};
    for (const id of mspfIds) {
      const bc = idToBc[id];
      if (bc) (byBc[bc] = byBc[bc] || []).push(id);
    }
    const startDate = toUtcDateStr(fromIso);
    const endDate = toUtcDateStr(toIso);
    const bcIds = Object.keys(byBc).map(Number);
    if (bcIds.length > 0) {
      const results = await Promise.allSettled(bcIds.map(bc => mspf.getBcStatsReports(bc, { startDate, endDate })));
      for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'fulfilled') {
          const ids = new Set(byBc[bcIds[i]]);
          for (const row of (results[i].value || [])) if (ids.has(row.deviceId)) items.push(mspfStatsRowToItem(row));
        }
      }
    }
    const uncovered = mspfIds.filter(id => !idToBc[id]);
    if (uncovered.length > 0) {
      const results = await Promise.allSettled(uncovered.map(id => mspf.getDeviceStatsReports(id, { startDate, endDate })));
      for (const r of results) if (r.status === 'fulfilled') for (const row of (r.value || [])) items.push(mspfStatsRowToItem(row));
    }
  }

  if (foxIds.length > 0) {
    const results = await Promise.allSettled(foxIds.map(id => foxlogger.getDeviceSummary(id, { from: fromIso, to: toIso, user_id: foxlogger.getUserId() })));
    for (const r of results) {
      if (r.status === 'fulfilled') for (const row of (r.value?.data || [])) items.push(foxSummaryRowToItem(row));
    }
  }

  return items;
}

function resolveSummaryDeviceName(idNum, devSource) {
  const merged = cache.get('devices:merged') || [];
  const d = merged.find(x => x.id === idNum && x.source === devSource);
  return d?.name || undefined;
}

router.get('/summary', async (req, res, next) => {
  try {
    const { deviceId, group, source, from, to, granularity } = req.query;
    const isAdmin = req.user.role === 'admin';
    const userGroups = req.user.groups || [];

    if (granularity) {
      const allowedGran = ['day', 'week', 'month', 'year'];
      if (!allowedGran.includes(granularity)) {
        throw createError(400, 'granularity must be one of: day, week, month, year', { code: 'ERR_VALIDATION' });
      }
      const fromIso = from || new Date(Date.now() - 30 * 86400000).toISOString();
      const toIso = to || new Date().toISOString();

      if (group && /^\d+$/.test(String(group))) {
        const groupId = parseInt(group, 10);
        const groupInfo = await db('groups').where({ id: groupId }).first();
        if (!groupInfo) throw createError(404, 'Group not found', { code: 'ERR_NOT_FOUND' });
        if (!isAdmin && !userGroups.includes(groupId)) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
        const dgs = await db('device_groups').where({ group_id: groupId }).select('device_id', 'source');
        const items = await collectGroupSummaryItems(dgs, fromIso, toIso);
        const seriesData = buildSeries(items, fromIso, toIso, granularity);
        return res.json({
          type: 'group',
          group: { id: groupInfo.id, name: groupInfo.name },
          granularity,
          period: { from: fromIso, to: toIso },
          timezone: 'UTC',
          ...seriesData,
        });
      }

      if (!deviceId) {
        throw createError(400, 'deviceId or group (custom group ID) is required for summary time-series', { code: 'ERR_VALIDATION' });
      }

      const idNum = parseInt(deviceId, 10);
      const idStr = deviceId;
      const devSource = await probeSummaryDeviceSource(idNum, idStr, group, source);
      if (!devSource) throw createError(404, 'Device not found', { code: 'ERR_NOT_FOUND' });

      if (!isAdmin) {
        if (!userGroups.length) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
        const lookupId = devSource === 'foxlogger' ? idStr : idNum;
        const dg = await db('device_groups').where({ device_id: lookupId, source: devSource }).whereIn('group_id', userGroups).first();
        if (!dg) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
      }

      let items;
      if (devSource === 'mspf') {
        const rows = await mspf.getDeviceStatsReports(idNum, { startDate: toUtcDateStr(fromIso), endDate: toUtcDateStr(toIso) });
        items = (rows || []).map(mspfStatsRowToItem);
      } else if (devSource === 'traccar') {
        const trips = await traccar.getReportTrips({ deviceId: idNum, from: fromIso, to: toIso });
        items = (trips || []).map(traccarTripToItem);
      } else {
        const data = await foxlogger.getDeviceSummary(idStr, { from: fromIso, to: toIso, user_id: foxlogger.getUserId() });
        items = (data?.data || []).map(foxSummaryRowToItem);
      }

      const seriesData = buildSeries(items, fromIso, toIso, granularity);
      return res.json({
        type: 'device',
        deviceId: idNum,
        deviceName: resolveSummaryDeviceName(idNum, devSource),
        granularity,
        period: { from: fromIso, to: toIso },
        timezone: 'UTC',
        ...seriesData,
      });
    }

    if (!deviceId && !group) {
      const userGroups = req.user.groups || [];
      const isAdmin = req.user.role === 'admin';

      let deviceIds = [];
      if (!isAdmin) {
        if (userGroups.length > 0) {
          const dgs = await db('device_groups').whereIn('group_id', userGroups).select('device_id', 'source');
          deviceIds = dgs.map(d => ({ id: d.device_id, source: d.source }));
        }
      }

      const [traccarResult, mspfResult] = await Promise.allSettled([
        traccar.getReportSummary({ from, to: to || undefined }),
        mspf.getStatsSummary(),
      ]);

      const summaries = [];
      if (traccarResult.status === 'fulfilled') {
        for (const s of traccarResult.value) {
          if (deviceIds.length > 0 && !deviceIds.some(d => d.id === s.deviceId && d.source === 'traccar')) continue;
          summaries.push({ ...s, source: 'traccar', spentFuel: s.spentFuel || null, engineHours: s.engineHours || null, maxSpeed: s.maxSpeed || null, averageSpeed: s.averageSpeed || null });
        }
      }
      if (mspfResult.status === 'fulfilled') {
        const data = mspfResult.value?.data || [];
        for (const s of data) {
          if (deviceIds.length > 0 && !deviceIds.some(d => d.id === s.deviceId && d.source === 'mspf')) continue;
          summaries.push({ deviceId: s.deviceId, deviceName: '', source: 'mspf', distance: s.totalMileage || 0, maxSpeed: null, averageSpeed: null, duration: s.totalDrivingTime || 0, engineHours: s.totalDrivingTime || null, spentFuel: null });
        }
      }

      return res.json({ period: { from: from || undefined, to: to || new Date().toISOString() }, ...summaryResponse(summaries, isAdmin) });
    }

    const idNum = parseInt(deviceId, 10);
    let devSource = group ? deviceRouter.resolveGroup(group)?.source : null;
    if (!devSource) devSource = deviceRouter.getSourceByDeviceId(idNum);
    if (!devSource) {
      const [t, m, f] = await Promise.allSettled([
        traccar.getDevices({ id: idNum }),
        mspf.getDevice(idNum),
        foxlogger.waitForInit(3000).then(() => foxlogger.getDevices()).then(d => d.data.find(x => x.uniqueId === req.query.deviceId || String(x.id) === req.query.deviceId)),
      ]);
      if (t.status === 'fulfilled' && t.value?.[0]) {
        devSource = 'traccar';
        deviceRouter.setSourceByDeviceId(idNum, 'traccar');
      } else if (m.status === 'fulfilled' && m.value?.id) {
        devSource = 'mspf';
        deviceRouter.setSourceByDeviceId(idNum, 'mspf');
      } else if (f.status === 'fulfilled' && f.value) {
        devSource = 'foxlogger';
        deviceRouter.setSourceByDeviceId(idNum, 'foxlogger');
      } else {
        throw createError(404, 'Device not found', { code: 'ERR_NOT_FOUND' });
      }
    }

    if (req.user.role !== 'admin') {
      if (!req.user.groups?.length) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
      const dg = await db('device_groups').where({ device_id: idNum, source: devSource }).whereIn('group_id', req.user.groups).first();
      if (!dg) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
    }

    if (devSource === 'traccar') {
      const data = await traccar.getReportSummary({ deviceId: idNum, from, to: to || undefined });
      const s = (data || [])[0] || {};
      return res.json({
        deviceId: idNum,
        ...(isAdmin ? { source: 'traccar' } : {}),
        period: { from, to: to || new Date().toISOString() },
        ...summaryResponse([{ deviceId: idNum, deviceName: s.deviceName || '', source: 'traccar', distance: s.distance || 0, maxSpeed: s.maxSpeed || null, averageSpeed: s.averageSpeed || null, duration: s.duration || 0, engineHours: s.engineHours || null, spentFuel: s.spentFuel || null }], isAdmin),
      });
    }

    if (devSource === 'foxlogger') {
      const foxImei = req.query.deviceId;
      const data = await foxlogger.getDeviceSummary(foxImei, { from, to: to || undefined, user_id: foxlogger.getUserId() });
      const raw = (data?.data || [])[0] || {};
      return res.json({
        deviceId: foxImei,
        ...(isAdmin ? { source: 'foxlogger' } : {}),
        period: { from, to: to || new Date().toISOString() },
        ...summaryResponse([{ deviceId: foxImei, deviceName: raw.gps_name || '', source: 'foxlogger', distance: parseFloat(raw.distance || 0), maxSpeed: parseFloat(raw.speed_max || 0), averageSpeed: parseFloat(raw.speed_avg || 0), duration: (parseInt(raw.time_hour || 0) * 3600) + (parseInt(raw.time_minute || 0) * 60) + (parseInt(raw.time_second || 0)), engineHours: null, spentFuel: parseFloat(raw.fuel_usage || 0) }], isAdmin),
      });
    }

    const device = await mspf.getDevice(idNum);
    const route = await mspf.getDeviceRoute(idNum, { from, to: to || undefined });
    const enriched = enrichMspfSummary({
      deviceId: idNum,
      deviceName: device?.name || mspf.normalizeDevice?.(device)?.name || '',
      source: 'mspf',
      maxSpeed: null, averageSpeed: null, duration: null, engineHours: null, spentFuel: null,
    }, route || []);

    res.json({
      deviceId: idNum,
      ...(isAdmin ? { source: 'mspf' } : {}),
      period: { from, to: to || new Date().toISOString() },
      ...summaryResponse([enriched], isAdmin),
    });
  } catch (err) {
    next(err);
  }
});

// ponytail: in-memory NodeCache master distance summary. Ceiling: single-instance gateway. Upgrade path: Redis cache or worker cron.
async function getMasterDistance24h() {
  const cacheKey = 'reports:masterDistance:24h';
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const now = new Date();
  const fromDate = new Date(now.getTime() - 24 * 3600 * 1000);
  const fromIso = fromDate.toISOString();
  const toIso = now.toISOString();
  const startDate = toUtcDateStr(fromIso);
  const endDate = toUtcDateStr(toIso);

  const merged = cache.get('devices:merged') || [];
  const map = new Map();

  for (const d of merged) {
    map.set(`${d.source}:${d.id}`, {
      deviceId: d.id,
      name: d.name || `${d.source}:${d.id}`,
      source: d.source,
      distance: 0,
      duration: 0,
    });
  }

  const bcIds = [...new Set(merged
    .filter(d => d.source === 'mspf' && d.group)
    .map(d => parseInt(d.group.replace('mspf_', ''), 10))
    .filter(Boolean)
  )];

  const foxDevices = merged.filter(d => d.source === 'foxlogger');

  const [traccarResult, mspfBcResults, mspfSummaryResult, foxResults] = await Promise.allSettled([
    traccar.getReportSummary({ from: fromIso, to: toIso }),
    bcIds.length > 0
      ? Promise.allSettled(bcIds.map(bc => mspf.getBcStatsReports(bc, { startDate, endDate })))
      : Promise.resolve([]),
    mspf.getStatsSummary ? mspf.getStatsSummary() : Promise.resolve({ data: [] }),
    foxDevices.length > 0
      ? Promise.allSettled(foxDevices.map(f => foxlogger.getDeviceSummary(f.id, { from: fromIso, to: toIso, user_id: foxlogger.getUserId?.() })))
      : Promise.resolve([]),
  ]);

  if (traccarResult.status === 'fulfilled' && Array.isArray(traccarResult.value)) {
    for (const s of traccarResult.value) {
      const key = `traccar:${s.deviceId}`;
      const existing = map.get(key);
      const dist = s.distance || 0;
      const dur = s.duration || 0;
      if (existing) {
        existing.distance += dist;
        existing.duration += dur;
        if ((!existing.name || existing.name === `traccar:${s.deviceId}`) && s.deviceName) {
          existing.name = s.deviceName;
        }
      } else {
        map.set(key, {
          deviceId: s.deviceId,
          name: s.deviceName || `traccar:${s.deviceId}`,
          source: 'traccar',
          distance: dist,
          duration: dur,
        });
      }
    }
  }

  let mspfCount = 0;
  if (mspfBcResults.status === 'fulfilled' && Array.isArray(mspfBcResults.value)) {
    for (const r of mspfBcResults.value) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) {
        for (const row of r.value) {
          mspfCount++;
          const key = `mspf:${row.deviceId}`;
          const existing = map.get(key);
          const dist = parseFloat(row.mileage || 0);
          const dur = parseInt(row.drivingtime || 0, 10);
          if (existing) {
            existing.distance += dist;
            existing.duration += dur;
            if ((!existing.name || existing.name === `${row.deviceId}`) && row.vin) {
              existing.name = row.vin;
            }
          } else {
            map.set(key, {
              deviceId: row.deviceId,
              name: row.vin || `mspf:${row.deviceId}`,
              source: 'mspf',
              distance: dist,
              duration: dur,
            });
          }
        }
      }
    }
  }

  if (mspfSummaryResult.status === 'fulfilled' && mspfSummaryResult.value?.data) {
    for (const s of mspfSummaryResult.value.data) {
      const key = `mspf:${s.deviceId}`;
      const existing = map.get(key);
      const dist = s.totalMileage || 0;
      const dur = s.totalDrivingTime || 0;
      if (existing) {
        if (existing.distance === 0) {
          existing.distance = dist;
          existing.duration = dur;
        }
      } else {
        map.set(key, {
          deviceId: s.deviceId,
          name: `mspf:${s.deviceId}`,
          source: 'mspf',
          distance: dist,
          duration: dur,
        });
      }
    }
  }

  if (foxResults.status === 'fulfilled' && Array.isArray(foxResults.value)) {
    for (let i = 0; i < foxResults.value.length; i++) {
      const r = foxResults.value[i];
      if (r.status === 'fulfilled' && r.value) {
        const foxId = foxDevices[i]?.id;
        const key = `foxlogger:${foxId}`;
        const existing = map.get(key);
        const rows = Array.isArray(r.value.data) ? r.value.data : (r.value.data ? [r.value.data] : []);
        for (const row of rows) {
          const dist = parseFloat(row.distance || 0);
          const dur = (parseInt(row.time_hour || 0, 10) * 3600) + (parseInt(row.time_minute || 0, 10) * 60) + parseInt(row.time_second || 0, 10);
          if (existing) {
            existing.distance += dist;
            existing.duration += dur;
            if (row.gps_name) existing.name = row.gps_name;
          }
        }
      }
    }
  }

  const list = Array.from(map.values()).map(d => ({
    ...d,
    distance: parseFloat((d.distance || 0).toFixed(2)),
  }));

  const result = {
    period: { from: fromIso, to: toIso, hours: 24 },
    devices: list,
  };

  cache.set(cacheKey, result, 1800); // 30 minutes TTL
  return result;
}

router.get(['/top-distance', '/top-mileage'], async (req, res, next) => {
  try {
    const { group, refresh, limit = 10 } = req.query;
    if (refresh === 'true') {
      cache.del('reports:masterDistance:24h');
    }

    const master = await getMasterDistance24h();
    const isAdmin = req.user.role === 'admin';
    const userGroups = req.user.groups || [];

    let filtered = master.devices;

    if (group) {
      const groupId = parseInt(group, 10);
      const groupInfo = await db('groups').where({ id: groupId }).first();
      if (!groupInfo) throw createError(404, 'Group not found', { code: 'ERR_NOT_FOUND' });
      if (!isAdmin && !userGroups.includes(groupId)) {
        throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
      }
      const dgs = await db('device_groups').where({ group_id: groupId }).select('device_id', 'source');
      const grpKeys = new Set(dgs.filter(m => m.source !== 'foxlogger').map(m => `${m.source}:${m.device_id}`));
      const foxGrpKeys = new Set(dgs.filter(m => m.source === 'foxlogger').map(m => String(m.device_id)));
      filtered = filtered.filter(d => {
        if (d.source !== 'foxlogger') return grpKeys.has(`${d.source}:${d.deviceId}`);
        if (foxGrpKeys.has(String(d.deviceId))) return true;
        if (foxlogger.resolveImei) {
          const imei = foxlogger.resolveImei(d.deviceId);
          if (imei && foxGrpKeys.has(String(imei))) return true;
        }
        return false;
      });
    } else if (!isAdmin) {
      if (userGroups.length === 0) {
        filtered = [];
      } else {
        const mappings = await db('device_groups').whereIn('group_id', userGroups).select('device_id', 'source');
        const allowedKeys = new Set(mappings.filter(m => m.source !== 'foxlogger').map(m => `${m.source}:${m.device_id}`));
        const foxAllowed = new Set(mappings.filter(m => m.source === 'foxlogger').map(m => String(m.device_id)));
        filtered = filtered.filter(d => {
          if (d.source !== 'foxlogger') return allowedKeys.has(`${d.source}:${d.deviceId}`);
          if (foxAllowed.has(String(d.deviceId))) return true;
          if (foxlogger.resolveImei) {
            const imei = foxlogger.resolveImei(d.deviceId);
            if (imei && foxAllowed.has(String(imei))) return true;
          }
          return false;
        });
      }
    }

    filtered.sort((a, b) => b.distance - a.distance || a.deviceId - b.deviceId);
    const maxLimit = Math.max(1, Math.min(parseInt(limit, 10) || 10, 100));
    const topDevices = filtered.slice(0, maxLimit).map((d, idx) => {
      const item = { rank: idx + 1, ...d };
      if (!isAdmin) delete item.source;
      return item;
    });

    res.json({
      period: master.period,
      totalDevicesEvaluated: filtered.length,
      topDevices,
    });
  } catch (err) {
    next(err);
  }
});

const TRACCAR_EVENT_STATUS = {
  geofenceEnter: 'OPEN', geofenceExit: 'CLOSE',
  ignitionOn: 'OPEN', ignitionOff: 'CLOSE',
  deviceOnline: 'OPEN', deviceOffline: 'CLOSE',
  deviceMoving: 'OPEN', deviceStopped: 'CLOSE',
  alarm: 'OPEN', overspeed: 'OPEN',
  maintenance: 'OPEN', commandResult: 'CLOSE',
  driverChanged: 'OPEN', textMessage: 'OPEN', deviceUnknown: 'OPEN',
};

const TRACCAR_EVENT_NAMES = {
  ignitionOn: 'Ignition ON', ignitionOff: 'Ignition OFF',
  deviceOnline: 'Device Online', deviceOffline: 'Device Offline',
  deviceMoving: 'Device Moving', deviceStopped: 'Device Stopped',
  alarm: 'Alarm', overspeed: 'Overspeed',
  maintenance: 'Maintenance', commandResult: 'Command Result',
  driverChanged: 'Driver Changed', textMessage: 'Text Message',
  deviceUnknown: 'Device Unknown',
};

router.get('/events', async (req, res, next) => {
  try {
    const { deviceId, group, from, to, status, name } = req.query;
    const isAdmin = req.user.role === 'admin';
    const userGroups = req.user.groups || [];

    if (deviceId) {
      const idNum = parseInt(deviceId, 10);
      let devSource = group ? deviceRouter.resolveGroup(group)?.source : null;
      if (!devSource) devSource = deviceRouter.getSourceByDeviceId(idNum);
      if (!devSource) {
        const [t, m, f] = await Promise.allSettled([
          traccar.getDevices({ id: idNum }),
          mspf.getDevice(idNum),
          foxlogger.waitForInit(3000).then(() => foxlogger.getDevices()).then(d => d.data.find(x => x.uniqueId === req.query.deviceId || String(x.id) === req.query.deviceId)),
        ]);
        if (t.status === 'fulfilled' && t.value?.[0]) {
          devSource = 'traccar';
          deviceRouter.setSourceByDeviceId(idNum, 'traccar');
        } else if (m.status === 'fulfilled' && m.value?.id) {
          devSource = 'mspf';
          deviceRouter.setSourceByDeviceId(idNum, 'mspf');
        } else if (f.status === 'fulfilled' && f.value) {
          devSource = 'foxlogger';
          deviceRouter.setSourceByDeviceId(idNum, 'foxlogger');
        } else throw createError(404, 'Device not found', { code: 'ERR_NOT_FOUND' });
      }

      if (!isAdmin) {
        if (!userGroups.length) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
        const dg = await db('device_groups').where({ device_id: idNum, source: devSource }).whereIn('group_id', userGroups).first();
        if (!dg) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
      }

      let events = [];
      if (devSource === 'traccar') {
        const data = await traccar.getReportEvents({ deviceId: idNum, from, to: to || undefined });
        const geoList = await traccar.getGeofences();
        const geoMap = {};
        for (const g of geoList) geoMap[g.id] = g.name;

        for (const e of data || []) {
          const isGeo = (e.type === 'geofenceEnter' || e.type === 'geofenceExit');
          events.push({
            name: isGeo && e.geofenceId ? (geoMap[e.geofenceId] || null) : (TRACCAR_EVENT_NAMES[e.type] || null),
            eventTime: toUtcIso(e.eventTime),
            status: TRACCAR_EVENT_STATUS[e.type] || null,
            deviceId: e.deviceId,
            source: 'traccar',
            geofenceId: e.geofenceId || null,
            positionId: e.positionId || null,
            attributes: e.attributes || null,
          });
        }
      } else {
        const merged = cache.get('devices:merged');
        let bcId = null;
        if (merged) {
          const d = merged.find(x => x.id === idNum && x.source === 'mspf');
          if (d?.group) bcId = parseInt(d.group.replace('mspf_', ''), 10);
        }

        if (bcId) {
          const [openRes, closedRes] = await Promise.allSettled([
            mspf.getMspfEvents({ bcIds: [bcId], deviceId: idNum }),
            mspf.getMspfClosedEvents({ bcId, deviceId: idNum, from, to: to || undefined }),
          ]);

          const openEvents = openRes.status === 'fulfilled' ? openRes.value : [];
          const closedEvents = closedRes.status === 'fulfilled' ? closedRes.value : [];

          for (const e of [...openEvents, ...closedEvents]) {
            events.push({
              name: e.monitorName || null,
              eventTime: toUtcIso(e.openedAt || e.closedAt),
              status: e.status || 'OPEN',
              deviceId: e.deviceId,
              source: 'mspf',
              monitorId: e.monitorId || null,
              monitorName: e.monitorName || null,
              openedAt: toUtcIso(e.openedAt) || null,
              closedAt: toUtcIso(e.closedAt) || null,
            });
          }
        }
      }

      if (status) events = events.filter(e => e.status === status.toUpperCase());
      if (name) events = events.filter(e => e.name && e.name.toLowerCase().includes(name.toLowerCase()));
      events.sort((a, b) => new Date(b.eventTime) - new Date(a.eventTime));

      const openCount = events.filter(e => e.status === 'OPEN').length;
      const closedCount = events.filter(e => e.status === 'CLOSE').length;

      return res.json({
        deviceId: idNum, source: devSource,
        period: { from, to: to || new Date().toISOString() },
        events,
        summary: { total: events.length, open: openCount, closed: closedCount },
      });
    }

    // ── Multi-device (no deviceId) ───────────────────────
    const [traccarResult, mspfResult] = await Promise.allSettled([
      traccar.getReportEvents({ from, to: to || undefined }),
      mspf.getMspfEvents({ bcIds: [10000023] }).catch(() => []),
    ]);

    let events = [];
    if (traccarResult.status === 'fulfilled') {
      for (const e of traccarResult.value) {
        events.push({
          name: null, eventTime: toUtcIso(e.eventTime),
          status: TRACCAR_EVENT_STATUS[e.type] || null,
          deviceId: e.deviceId, source: 'traccar',
          geofenceId: e.geofenceId || null,
        });
      }
    }
    if (mspfResult.status === 'fulfilled') {
      for (const e of mspfResult.value) {
        events.push({
          name: null, eventTime: toUtcIso(e.openedAt || e.closedAt),
          status: e.status || null, deviceId: e.deviceId, source: 'mspf',
          monitorId: e.monitorId || null,
        });
      }
    }

    if (!isAdmin) {
      if (userGroups.length === 0) { events = []; }
      else {
        const dgs = await db('device_groups').whereIn('group_id', userGroups).select('device_id', 'source');
        const allowed = new Set(dgs.map(d => `${d.source}:${d.device_id}`));
        events = events.filter(e => allowed.has(`${e.source}:${e.deviceId}`));
      }
    }

    if (status) events = events.filter(e => e.status === status.toUpperCase());
    if (name) events = events.filter(e => e.name && e.name.toLowerCase().includes(name.toLowerCase()));
    events.sort((a, b) => new Date(b.eventTime) - new Date(a.eventTime));

    res.json({
      period: { from, to: to || new Date().toISOString() },
      events: isAdmin ? events : sanitizeReportItems(events, isAdmin),
      summary: { total: events.length },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
