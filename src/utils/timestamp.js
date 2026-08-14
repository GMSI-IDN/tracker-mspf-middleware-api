const config = require('../config');

const SENTINEL_DATE = /^0{4}-0{2}-0{2}/;
const NAIVE_DATETIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d+)?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function getTimeZoneOffsetMs(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map(p => [p.type, p.value]));
  const wallAsUtc = Date.UTC(
    parseInt(parts.year, 10),
    parseInt(parts.month, 10) - 1,
    parseInt(parts.day, 10),
    parseInt(parts.hour, 10),
    parseInt(parts.minute, 10),
    parseInt(parts.second, 10)
  );
  return wallAsUtc - date.getTime();
}

function naiveToUtcIso(naive, timeZone) {
  const match = naive.match(NAIVE_DATETIME);
  if (!match) return null;
  const wallAsUtc = Date.UTC(
    parseInt(match[1].slice(0, 4), 10),
    parseInt(match[1].slice(5, 7), 10) - 1,
    parseInt(match[1].slice(8, 10), 10),
    parseInt(match[2].slice(0, 2), 10),
    parseInt(match[2].slice(3, 5), 10),
    parseInt(match[2].slice(6, 8), 10)
  );
  const offset = getTimeZoneOffsetMs(new Date(wallAsUtc), timeZone);
  return new Date(wallAsUtc - offset).toISOString();
}

function toUtcIso(value, opts = {}) {
  const timeZone = opts.timeZone || config.foxlogger.timezone;
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'number') {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const str = String(value).trim();
  if (!str || SENTINEL_DATE.test(str)) return null;
  if (NAIVE_DATETIME.test(str)) return naiveToUtcIso(str, timeZone);
  if (DATE_ONLY.test(str)) return `${str}T00:00:00.000Z`;
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toUtcDateStr(value) {
  const iso = toUtcIso(value);
  if (!iso) return null;
  return iso.slice(0, 10);
}

function toSourceNaive(value, timeZone = config.foxlogger.timezone) {
  const iso = toUtcIso(value);
  if (!iso) return null;
  const d = new Date(iso);
  const offset = getTimeZoneOffsetMs(d, timeZone);
  const local = new Date(d.getTime() + offset);
  const pad = (n) => String(n).padStart(2, '0');
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`;
}

function isValidTimeZone(tz) {
  if (!tz) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function startOfDayIso(value = new Date(), timeZone = config.foxlogger.timezone) {
  try {
    const naive = toSourceNaive(value, timeZone);
    if (!naive) return null;
    return toUtcIso(`${naive.slice(0, 10)} 00:00:00`, { timeZone });
  } catch {
    const iso = toUtcIso(value);
    return iso ? `${iso.slice(0, 10)}T00:00:00.000Z` : null;
  }
}

module.exports = { toUtcIso, toUtcDateStr, toSourceNaive, isValidTimeZone, startOfDayIso };
