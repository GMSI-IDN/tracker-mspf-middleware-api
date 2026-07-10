const express = require('express');
const createError = require('http-errors');
const traccar = require('../services/traccar');
const mspf = require('../services/mspf');
const deviceRouter = require('../services/deviceRouter');
const db = require('../db');
const { applyRules, enrichWithRules, getDeviceRules } = require('../services/customAttributes');

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

    const idNum = parseInt(deviceId, 10);
    let devSource = source;
    if (group) { const p = deviceRouter.resolveGroup(group); if (p) devSource = p.source; }
    if (!devSource) devSource = deviceRouter.getSourceByDeviceId(idNum);
    if (!devSource) {
      const [t, m] = await Promise.allSettled([
        traccar.getDevices({ id: idNum }),
        mspf.getDevice(idNum),
      ]);
      if (t.status === 'fulfilled' && t.value?.[0]) {
        devSource = 'traccar';
        deviceRouter.setSourceByDeviceId(idNum, 'traccar');
      } else if (m.status === 'fulfilled' && m.value?.id) {
        devSource = 'mspf';
        deviceRouter.setSourceByDeviceId(idNum, 'mspf');
      } else {
        throw createError(404, 'Device not found', { code: 'ERR_NOT_FOUND' });
      }
    }

    if (req.user.role !== 'admin' && req.user.groups?.length > 0) {
      const dg = await db('device_groups').where({ device_id: idNum, source: devSource }).whereIn('group_id', req.user.groups).first();
      if (!dg) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
    }

    if (devSource === 'mspf' && from && to) {
      const fromMs = new Date(from).getTime();
      const toMs = new Date(to).getTime();
      if (toMs - fromMs > 7 * 24 * 3600 * 1000) {
        throw createError(400, 'Date range max 7 days for MSPF devices', { code: 'ERR_VALIDATION' });
      }
    }

    let positions;
    if (devSource === 'traccar') {
      const data = await traccar.getPositions({ deviceId: idNum, from, to });
      positions = data.map(normalizeTraccarPosition);
    } else {
      positions = await mspf.getDeviceRoute(idNum, { from, to });
    }

    await applyCustomAttributes(positions, req.user);
    res.json(positions);
  } catch (err) {
    next(err);
  }
});

function normalizeTraccarStop(stop) {
  return {
    startTime: stop.startTime,
    endTime: stop.endTime,
    duration: stop.duration,
    latitude: stop.lat,
    longitude: stop.lon,
    address: stop.address || null,
  };
}

function normalizeMspfParking(deviceId, parking) {
  const durationSeconds = Math.round((parking.parkingTime || 0) * 60);
  const endTime = new Date(new Date(parking.parkingStartTime).getTime() + durationSeconds * 1000).toISOString();
  return {
    startTime: parking.parkingStartTime,
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
      const [t, m] = await Promise.allSettled([
        traccar.getDevices({ id: idNum }),
        mspf.getDevice(idNum),
      ]);
      if (t.status === 'fulfilled' && t.value?.[0]) {
        devSource = 'traccar';
        deviceRouter.setSourceByDeviceId(idNum, 'traccar');
      } else if (m.status === 'fulfilled' && m.value?.id) {
        devSource = 'mspf';
        deviceRouter.setSourceByDeviceId(idNum, 'mspf');
      } else {
        throw createError(404, 'Device not found', { code: 'ERR_NOT_FOUND' });
      }
    }

    if (req.user.role !== 'admin' && req.user.groups?.length > 0) {
      const dg = await db('device_groups').where({ device_id: idNum, source: devSource }).whereIn('group_id', req.user.groups).first();
      if (!dg) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
    }

    let parking;
    if (devSource === 'traccar') {
      const data = await traccar.getReportStops({ deviceId: idNum, from, to });
      parking = (data || [])
        .filter(s => !s.engineHours || s.engineHours === 0)
        .map(normalizeTraccarStop);
    } else {
      const data = await mspf.getDeviceParkingAll(idNum, { from, to });
      parking = (data || []).map(p => normalizeMspfParking(idNum, p));
    }

    parking.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

    const totalDuration = parking.reduce((sum, p) => sum + (p.duration || 0), 0);

    res.json({
      deviceId: idNum,
      source: devSource,
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
      const [t, m] = await Promise.allSettled([
        traccar.getDevices({ id: idNum }),
        mspf.getDevice(idNum),
      ]);
      if (t.status === 'fulfilled' && t.value?.[0]) {
        devSource = 'traccar';
        deviceRouter.setSourceByDeviceId(idNum, 'traccar');
      } else if (m.status === 'fulfilled' && m.value?.id) {
        devSource = 'mspf';
        deviceRouter.setSourceByDeviceId(idNum, 'mspf');
      } else {
        throw createError(404, 'Device not found', { code: 'ERR_NOT_FOUND' });
      }
    }

    if (req.user.role !== 'admin' && req.user.groups?.length > 0) {
      const dg = await db('device_groups').where({ device_id: idNum, source: devSource }).whereIn('group_id', req.user.groups).first();
      if (!dg) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
    }

    let idle;
    if (devSource === 'traccar') {
      const data = await traccar.getReportStops({ deviceId: idNum, from, to });
      idle = (data || [])
        .filter(s => (s.engineHours || 0) > 0)
        .map(s => ({ startTime: s.startTime, endTime: s.endTime, duration: s.duration, latitude: s.lat, longitude: s.lon, address: s.address || null }));
    } else {
      const positions = await mspf.getDeviceRoute(idNum, { from, to });
      idle = calculateIdleSegments(positions || []);
    }

    idle.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

    const totalDuration = idle.reduce((sum, p) => sum + (p.duration || 0), 0);

    res.json({
      deviceId: idNum,
      source: devSource,
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
      startTime: trip.timeStart,
      endTime: trip.timeEnd,
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
      const [t, m] = await Promise.allSettled([
        traccar.getDevices({ id: idNum }),
        mspf.getDevice(idNum),
      ]);
      if (t.status === 'fulfilled' && t.value?.[0]) {
        devSource = 'traccar';
        deviceRouter.setSourceByDeviceId(idNum, 'traccar');
      } else if (m.status === 'fulfilled' && m.value?.id) {
        devSource = 'mspf';
        deviceRouter.setSourceByDeviceId(idNum, 'mspf');
      } else {
        throw createError(404, 'Device not found', { code: 'ERR_NOT_FOUND' });
      }
    }

    if (req.user.role !== 'admin' && req.user.groups?.length > 0) {
      const dg = await db('device_groups').where({ device_id: idNum, source: devSource }).whereIn('group_id', req.user.groups).first();
      if (!dg) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
    }

    let trips;
    if (devSource === 'traccar') {
      const data = await traccar.getReportTrips({ deviceId: idNum, from, to });
      trips = (data || []).map(t => ({
        startTime: t.startTime,
        endTime: t.endTime,
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

    res.json({
      deviceId: idNum,
      source: devSource,
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

function summaryResponse(summaries) {
  const totalDistance = summaries.reduce((s, r) => s + (r.distance || 0), 0);
  const totalDuration = summaries.reduce((s, r) => s + (r.duration || 0), 0);
  return { summaries, total: { devices: summaries.length, distance: parseFloat(totalDistance.toFixed(2)), duration: totalDuration } };
}

router.get('/summary', async (req, res, next) => {
  try {
    const { deviceId, group, from, to } = req.query;
    if (!deviceId && !group) {
      const userGroups = req.user.groups || [];
      const isAdmin = req.user.role === 'admin';

      let deviceIds = [];
      if (!isAdmin && userGroups.length > 0) {
        const dgs = await db('device_groups').whereIn('group_id', userGroups).select('device_id', 'source');
        deviceIds = dgs.map(d => ({ id: d.device_id, source: d.source }));
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

      return res.json({ period: { from: from || undefined, to: to || new Date().toISOString() }, ...summaryResponse(summaries) });
    }

    const idNum = parseInt(deviceId, 10);
    let devSource = group ? deviceRouter.resolveGroup(group)?.source : null;
    if (!devSource) devSource = deviceRouter.getSourceByDeviceId(idNum);
    if (!devSource) {
      const [t, m] = await Promise.allSettled([
        traccar.getDevices({ id: idNum }),
        mspf.getDevice(idNum),
      ]);
      if (t.status === 'fulfilled' && t.value?.[0]) {
        devSource = 'traccar';
        deviceRouter.setSourceByDeviceId(idNum, 'traccar');
      } else if (m.status === 'fulfilled' && m.value?.id) {
        devSource = 'mspf';
        deviceRouter.setSourceByDeviceId(idNum, 'mspf');
      } else {
        throw createError(404, 'Device not found', { code: 'ERR_NOT_FOUND' });
      }
    }

    if (req.user.role !== 'admin' && req.user.groups?.length > 0) {
      const dg = await db('device_groups').where({ device_id: idNum, source: devSource }).whereIn('group_id', req.user.groups).first();
      if (!dg) throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
    }

    if (devSource === 'traccar') {
      const data = await traccar.getReportSummary({ deviceId: idNum, from, to: to || undefined });
      const s = (data || [])[0] || {};
      return res.json({
        deviceId: idNum,
        source: 'traccar',
        period: { from, to: to || new Date().toISOString() },
        ...summaryResponse([{ deviceId: idNum, deviceName: s.deviceName || '', source: 'traccar', distance: s.distance || 0, maxSpeed: s.maxSpeed || null, averageSpeed: s.averageSpeed || null, duration: s.duration || 0, engineHours: s.engineHours || null, spentFuel: s.spentFuel || null }]),
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
      source: 'mspf',
      period: { from, to: to || new Date().toISOString() },
      ...summaryResponse([enriched]),
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
        const [t, m] = await Promise.allSettled([
          traccar.getDevices({ id: idNum }),
          mspf.getDevice(idNum),
        ]);
        if (t.status === 'fulfilled' && t.value?.[0]) {
          devSource = 'traccar';
          deviceRouter.setSourceByDeviceId(idNum, 'traccar');
        } else if (m.status === 'fulfilled' && m.value?.id) {
          devSource = 'mspf';
          deviceRouter.setSourceByDeviceId(idNum, 'mspf');
        } else throw createError(404, 'Device not found', { code: 'ERR_NOT_FOUND' });
      }

      if (!isAdmin && userGroups.length > 0) {
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
            eventTime: e.eventTime,
            status: TRACCAR_EVENT_STATUS[e.type] || null,
            deviceId: e.deviceId,
            source: 'traccar',
            geofenceId: e.geofenceId || null,
            positionId: e.positionId || null,
            attributes: e.attributes || null,
          });
        }
      } else {
        const cache = require('../services/cache');
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
              eventTime: e.openedAt || e.closedAt,
              status: e.status || 'OPEN',
              deviceId: e.deviceId,
              source: 'mspf',
              monitorId: e.monitorId || null,
              monitorName: e.monitorName || null,
              openedAt: e.openedAt || null,
              closedAt: e.closedAt || null,
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
          name: null, eventTime: e.eventTime,
          status: TRACCAR_EVENT_STATUS[e.type] || null,
          deviceId: e.deviceId, source: 'traccar',
          geofenceId: e.geofenceId || null,
        });
      }
    }
    if (mspfResult.status === 'fulfilled') {
      for (const e of mspfResult.value) {
        events.push({
          name: null, eventTime: e.openedAt || e.closedAt,
          status: e.status || null, deviceId: e.deviceId, source: 'mspf',
          monitorId: e.monitorId || null,
        });
      }
    }

    // Filter by customer groups (if not admin)
    if (!isAdmin && userGroups.length > 0) {
      const dgs = await db('device_groups').whereIn('group_id', userGroups).select('device_id', 'source');
      const allowed = new Set(dgs.map(d => `${d.source}:${d.device_id}`));
      events = events.filter(e => allowed.has(`${e.source}:${e.deviceId}`));
    }

    if (status) events = events.filter(e => e.status === status.toUpperCase());
    if (name) events = events.filter(e => e.name && e.name.toLowerCase().includes(name.toLowerCase()));
    events.sort((a, b) => new Date(b.eventTime) - new Date(a.eventTime));

    res.json({
      period: { from, to: to || new Date().toISOString() },
      events,
      summary: { total: events.length },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
