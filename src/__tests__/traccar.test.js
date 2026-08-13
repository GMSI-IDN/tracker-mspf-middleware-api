const { toKmh } = require('../services/traccar');

describe('traccar — toKmh', () => {
  test('converts knots to km/h rounded to 2 decimals', () => {
    expect(toKmh(10)).toBe(18.52);
    expect(toKmh(27)).toBe(50);
    expect(toKmh(1)).toBe(1.85);
  });

  test('returns 0 for falsy values', () => {
    expect(toKmh(0)).toBe(0);
    expect(toKmh(null)).toBe(0);
    expect(toKmh(undefined)).toBe(0);
    expect(toKmh('')).toBe(0);
  });
});
