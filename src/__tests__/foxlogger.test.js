const { enrichHistoryWithRollback, fmtFoxTime } = require('../services/foxlogger');

const IMEI = '0780901703170270';

describe('foxlogger — fmtFoxTime (request time1/time2 = FOXLOGGER_TIMEZONE naive)', () => {
  test('converts UTC ISO to WIB naive', () => {
    expect(fmtFoxTime('2026-08-05T17:00:00.000Z')).toBe('2026-08-06 00:00:00');
    expect(fmtFoxTime('2026-08-06T04:54:00.000Z')).toBe('2026-08-06 11:54:00');
    expect(fmtFoxTime('2026-08-05T17:00:00Z')).toBe('2026-08-06 00:00:00');
  });

  test('passes through already-naive input', () => {
    expect(fmtFoxTime('2026-08-06 00:00:00')).toBe('2026-08-06 00:00:00');
  });

  test('returns undefined for empty input', () => {
    expect(fmtFoxTime(null)).toBeUndefined();
    expect(fmtFoxTime('')).toBeUndefined();
    expect(fmtFoxTime(undefined)).toBeUndefined();
  });
});

describe('foxlogger — enrichHistoryWithRollback', () => {
  test('sets course and nopol when rollback time matches history time', () => {
    const history = [
      { time: '2026-06-15 10:00:00', lat: -6.16, long: 106.81, Speed: '20', engi: 'ON', Dist: '0.5', addr: 'Jl. A' },
      { time: '2026-06-15 10:00:10', lat: -6.17, long: 106.82, Speed: '30', engi: 'ON', Dist: '0.4', addr: 'Jl. B' },
    ];
    const rollback = [
      { time: '2026-06-15 10:00:00', dir: '89', nopol: 'B 2412 PFQ', speed: '20', eng: 'ON' },
      { time: '2026-06-15 10:00:10', dir: '270', nopol: 'B 2412 PFQ', speed: '30', eng: 'ON' },
    ];

    const positions = enrichHistoryWithRollback(IMEI, history, rollback);
    expect(positions).toHaveLength(2);
    expect(positions[0].course).toBe(89);
    expect(positions[1].course).toBe(270);
    expect(positions[0].attributes.nopol).toBe('B 2412 PFQ');
    expect(positions[0].speed).toBe(20);
    expect(positions[0].attributes.address).toBe('Jl. A');
  });

  test('keeps course 0 and no nopol when rollback has no matching time', () => {
    const history = [
      { time: '2026-06-15 10:00:00', lat: -6.16, long: 106.81, Speed: '20', engi: 'ON' },
    ];
    const rollback = [
      { time: '2026-06-15 11:00:00', dir: '89', nopol: 'B 2412 PFQ' },
    ];

    const positions = enrichHistoryWithRollback(IMEI, history, rollback);
    expect(positions[0].course).toBe(0);
    expect(positions[0].attributes.nopol).toBeUndefined();
  });

  test('ignores invalid dir (keeps course 0)', () => {
    const history = [{ time: '2026-06-15 10:00:00', lat: 0, long: 0, Speed: '0', engi: 'OFF' }];
    const rollback = [{ time: '2026-06-15 10:00:00', dir: 'abc', nopol: 'B 1' }];

    const positions = enrichHistoryWithRollback(IMEI, history, rollback);
    expect(positions[0].course).toBe(0);
    expect(positions[0].attributes.nopol).toBe('B 1');
  });

  test('normalizes naive history time to UTC (Asia/Jakarta)', () => {
    const history = [{ time: '2026-06-15 10:00:00', lat: 0, long: 0, Speed: '0', engi: 'OFF' }];
    const positions = enrichHistoryWithRollback(IMEI, history, []);
    expect(positions[0].deviceTime).toBe('2026-06-15T03:00:00.000Z');
  });

  test('returns empty array when no history', () => {
    expect(enrichHistoryWithRollback(IMEI, [], [])).toEqual([]);
    expect(enrichHistoryWithRollback(IMEI, null, [])).toEqual([]);
  });
});
