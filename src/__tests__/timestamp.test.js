const { toUtcIso, toUtcDateStr } = require('../utils/timestamp');

describe('timestamp util — toUtcIso', () => {
  test('returns null for empty / invalid values', () => {
    expect(toUtcIso(null)).toBeNull();
    expect(toUtcIso(undefined)).toBeNull();
    expect(toUtcIso('')).toBeNull();
    expect(toUtcIso('not-a-date')).toBeNull();
    expect(toUtcIso('0000-00-00 00:00:00')).toBeNull();
    expect(toUtcIso('0000-00-00')).toBeNull();
  });

  test('passes through Date objects', () => {
    expect(toUtcIso(new Date('2026-08-05T06:59:54.000Z'))).toBe('2026-08-05T06:59:54.000Z');
  });

  test('converts unix seconds to UTC ISO', () => {
    expect(toUtcIso(1591181120)).toBe('2020-06-03T10:45:20.000Z');
  });

  test('converts ISO string with Z unchanged', () => {
    expect(toUtcIso('2026-06-15T10:00:00Z')).toBe('2026-06-15T10:00:00.000Z');
  });

  test('converts ISO string with numeric offset to UTC', () => {
    expect(toUtcIso('2026-08-05T13:59:54+07:00')).toBe('2026-08-05T06:59:54.000Z');
  });

  test('interprets naive "YYYY-MM-DD HH:mm:ss" as Asia/Jakarta (UTC+7)', () => {
    expect(toUtcIso('2026-08-05 13:59:54')).toBe('2026-08-05T06:59:54.000Z');
    expect(toUtcIso('2026-07-28 07:47:11')).toBe('2026-07-28T00:47:11.000Z');
  });

  test('interprets naive "YYYY-MM-DDTHH:mm:ss" as Asia/Jakarta (UTC+7)', () => {
    expect(toUtcIso('2026-08-05T13:59:54')).toBe('2026-08-05T06:59:54.000Z');
  });

  test('treats date-only string as UTC midnight', () => {
    expect(toUtcIso('2026-06-15')).toBe('2026-06-15T00:00:00.000Z');
  });
});

describe('timestamp util — toUtcDateStr', () => {
  test('returns UTC date part', () => {
    expect(toUtcDateStr('2026-08-05 13:59:54')).toBe('2026-08-05');
    expect(toUtcDateStr('2026-06-15T10:00:00Z')).toBe('2026-06-15');
  });

  test('returns null for invalid input', () => {
    expect(toUtcDateStr(null)).toBeNull();
    expect(toUtcDateStr('garbage')).toBeNull();
  });
});
