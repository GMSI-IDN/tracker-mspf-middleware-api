const { periodKey, periodStartDate, addPeriod, aggregateByPeriod, fillMissingPeriods, buildSeries } = require('../utils/periodStats');

describe('periodStats — periodKey', () => {
  const d = new Date('2026-06-15T10:00:00.000Z');
  test('day key is YYYY-MM-DD', () => {
    expect(periodKey(d, 'day')).toBe('2026-06-15');
  });
  test('week key is ISO YYYY-Www', () => {
    expect(periodKey(d, 'week')).toBe('2026-W25');
  });
  test('month key is YYYY-MM', () => {
    expect(periodKey(d, 'month')).toBe('2026-06');
  });
  test('year key is YYYY', () => {
    expect(periodKey(d, 'year')).toBe('2026');
  });
});

describe('periodStats — periodStartDate', () => {
  test('day returns same date', () => {
    expect(periodStartDate(new Date('2026-06-18T10:00:00.000Z'), 'day')).toBe('2026-06-18');
  });
  test('week returns Monday', () => {
    expect(periodStartDate(new Date('2026-06-18T10:00:00.000Z'), 'week')).toBe('2026-06-15');
  });
  test('month returns 1st', () => {
    expect(periodStartDate(new Date('2026-06-18T10:00:00.000Z'), 'month')).toBe('2026-06-01');
  });
  test('year returns Jan 1', () => {
    expect(periodStartDate(new Date('2026-06-18T10:00:00.000Z'), 'year')).toBe('2026-01-01');
  });
});

describe('periodStats — aggregateByPeriod', () => {
  test('aggregates items into day buckets', () => {
    const items = [
      { time: '2026-06-15T08:00:00Z', distance: 10, drivingTime: 600, maxSpeed: 50, averageSpeed: 40, spentFuel: 1 },
      { time: '2026-06-15T09:00:00Z', distance: 20, drivingTime: 1200, maxSpeed: 80, averageSpeed: 60, spentFuel: 2 },
      { time: '2026-06-16T09:00:00Z', distance: 5, drivingTime: 300, maxSpeed: 30, averageSpeed: 20, spentFuel: 0.5 },
    ];
    const series = aggregateByPeriod(items, 'day');
    expect(series).toHaveLength(2);
    const d15 = series.find(b => b.key === '2026-06-15');
    expect(d15.distance).toBe(30);
    expect(d15.drivingTime).toBe(1800);
    expect(d15.maxSpeed).toBe(80);
    expect(d15.averageSpeed).toBe(60);
    expect(d15.spentFuel).toBe(3);
    expect(d15.count).toBe(2);
  });

  test('handles naive Jakarta timestamps', () => {
    const items = [{ time: '2026-06-15 07:00:00', distance: 10, drivingTime: 600, maxSpeed: 40, spentFuel: 1 }];
    const series = aggregateByPeriod(items, 'day');
    expect(series[0].key).toBe('2026-06-15');
  });

  test('handles MSPF date-only strings as UTC', () => {
    const items = [{ time: '2026-06-15', distance: 10, drivingTime: 3600, maxSpeed: null, spentFuel: null }];
    const series = aggregateByPeriod(items, 'day');
    expect(series[0].key).toBe('2026-06-15');
  });

  test('aggregates by month', () => {
    const items = [
      { time: '2026-06-15T08:00:00Z', distance: 10, drivingTime: 600 },
      { time: '2026-07-01T08:00:00Z', distance: 20, drivingTime: 1200 },
    ];
    const series = aggregateByPeriod(items, 'month');
    expect(series.map(b => b.key).sort()).toEqual(['2026-06', '2026-07']);
  });

  test('skips invalid timestamps', () => {
    const items = [
      { time: 'not-a-date', distance: 10, drivingTime: 600 },
      { time: '2026-06-15T08:00:00Z', distance: 5, drivingTime: 300 },
    ];
    const series = aggregateByPeriod(items, 'day');
    expect(series).toHaveLength(1);
    expect(series[0].distance).toBe(5);
  });
});

describe('periodStats — fillMissingPeriods', () => {
  test('fills empty day buckets between from and to', () => {
    const series = [
      { key: '2026-06-10', date: '2026-06-10', distance: 10, drivingTime: 600, maxSpeed: 40, averageSpeed: 60, spentFuel: 1, count: 1 },
      { key: '2026-06-12', date: '2026-06-12', distance: 5, drivingTime: 300, maxSpeed: 20, averageSpeed: 60, spentFuel: 0.5, count: 1 },
    ];
    const filled = fillMissingPeriods(series, '2026-06-10T00:00:00Z', '2026-06-12T00:00:00Z', 'day');
    expect(filled).toHaveLength(3);
    expect(filled[0].key).toBe('2026-06-10');
    expect(filled[1].key).toBe('2026-06-11');
    expect(filled[1].distance).toBe(0);
    expect(filled[1].drivingTime).toBe(0);
    expect(filled[1].maxSpeed).toBeNull();
    expect(filled[1].count).toBe(0);
    expect(filled[2].key).toBe('2026-06-12');
  });
});

describe('periodStats — buildSeries', () => {
  test('returns filled series and total', () => {
    const items = [
      { time: '2026-06-10T08:00:00Z', distance: 10, drivingTime: 600, maxSpeed: 40, spentFuel: 1 },
      { time: '2026-06-12T08:00:00Z', distance: 20, drivingTime: 1200, maxSpeed: 80, spentFuel: 2 },
    ];
    const { series, total } = buildSeries(items, '2026-06-10T00:00:00Z', '2026-06-12T00:00:00Z', 'day');
    expect(series).toHaveLength(3);
    expect(total.distance).toBe(30);
    expect(total.drivingTime).toBe(1800);
    expect(total.maxSpeed).toBe(80);
    expect(total.averageSpeed).toBe(60);
    expect(total.spentFuel).toBe(3);
    expect(total.count).toBe(2);
  });
});
