const { toUtcIso } = require('./timestamp');

function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    return new Date(`${value}T00:00:00.000Z`);
  }
  const iso = toUtcIso(value);
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function dateOnly(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function isoWeek(d) {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((copy - yearStart) / 86400000) + 1) / 7);
  return { year: copy.getUTCFullYear(), week };
}

function periodKey(date, granularity) {
  switch (granularity) {
    case 'week': {
      const w = isoWeek(date);
      return `${w.year}-W${pad2(w.week)}`;
    }
    case 'month':
      return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;
    case 'year':
      return `${date.getUTCFullYear()}`;
    case 'day':
    default:
      return dateOnly(date);
  }
}

function periodStartDate(date, granularity) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  switch (granularity) {
    case 'week': {
      const dayNum = start.getUTCDay() || 7;
      start.setUTCDate(start.getUTCDate() - (dayNum - 1));
      return dateOnly(start);
    }
    case 'month':
      return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-01`;
    case 'year':
      return `${date.getUTCFullYear()}-01-01`;
    case 'day':
    default:
      return dateOnly(start);
  }
}

function addPeriod(date, granularity) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  switch (granularity) {
    case 'week':
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case 'month':
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
    case 'year':
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      break;
    case 'day':
    default:
      d.setUTCDate(d.getUTCDate() + 1);
  }
  return d;
}

function emptyBucket(key, date) {
  return {
    key,
    date,
    distance: 0,
    drivingTime: 0,
    maxSpeed: null,
    averageSpeed: null,
    spentFuel: 0,
    count: 0,
  };
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function aggregateByPeriod(items, granularity) {
  const map = new Map();
  for (const item of items) {
    const d = toDate(item.time);
    if (!d) continue;
    const key = periodKey(d, granularity);
    let bucket = map.get(key);
    if (!bucket) {
      bucket = emptyBucket(key, periodStartDate(d, granularity));
      map.set(key, bucket);
    }
    bucket.distance += item.distance || 0;
    bucket.drivingTime += item.drivingTime || 0;
    bucket.spentFuel += item.spentFuel || 0;
    bucket.count += 1;
    if (item.maxSpeed != null && item.maxSpeed > (bucket.maxSpeed || 0)) bucket.maxSpeed = item.maxSpeed;
  }
  const series = [];
  for (const bucket of map.values()) {
    bucket.distance = round2(bucket.distance);
    bucket.drivingTime = Math.round(bucket.drivingTime);
    bucket.spentFuel = round2(bucket.spentFuel);
    if (bucket.maxSpeed != null) bucket.maxSpeed = round2(bucket.maxSpeed);
    bucket.averageSpeed = bucket.drivingTime > 0 && bucket.distance > 0
      ? round2((bucket.distance / bucket.drivingTime) * 3600)
      : null;
    series.push(bucket);
  }
  return series;
}

function fillMissingPeriods(series, fromIso, toIso, granularity) {
  const from = toDate(fromIso);
  const to = toDate(toIso);
  if (!from || !to) return series;
  const byKey = new Map(series.map(b => [b.key, b]));
  const result = [];
  let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  cursor = toDate(periodStartDate(cursor, granularity));
  const endMs = to.getTime();
  while (cursor.getTime() <= endMs) {
    const key = periodKey(cursor, granularity);
    const bucket = byKey.get(key) || emptyBucket(key, periodStartDate(cursor, granularity));
    result.push(bucket);
    cursor = addPeriod(cursor, granularity);
  }
  return result;
}

function buildSeries(items, fromIso, toIso, granularity) {
  const series = fillMissingPeriods(aggregateByPeriod(items, granularity), fromIso, toIso, granularity);
  const total = series.reduce(
    (acc, b) => {
      acc.distance += b.distance || 0;
      acc.drivingTime += b.drivingTime || 0;
      acc.spentFuel += b.spentFuel || 0;
      acc.count += b.count || 0;
      if (b.maxSpeed != null && b.maxSpeed > (acc.maxSpeed || 0)) acc.maxSpeed = b.maxSpeed;
      return acc;
    },
    { distance: 0, drivingTime: 0, maxSpeed: null, averageSpeed: null, spentFuel: 0, count: 0 }
  );
  total.distance = round2(total.distance);
  total.drivingTime = Math.round(total.drivingTime);
  total.spentFuel = round2(total.spentFuel);
  if (total.maxSpeed != null) total.maxSpeed = round2(total.maxSpeed);
  total.averageSpeed = total.drivingTime > 0 && total.distance > 0
    ? round2((total.distance / total.drivingTime) * 3600)
    : null;
  return { series, total };
}

module.exports = { toDate, periodKey, periodStartDate, addPeriod, aggregateByPeriod, fillMissingPeriods, buildSeries };
