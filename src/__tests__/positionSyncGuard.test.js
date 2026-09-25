'use strict';

jest.mock('../services/traccar');
jest.mock('../services/mspf');
jest.mock('../services/foxlogger');
jest.mock('../services/autoSync', () => ({
  runAutoSync: jest.fn(() => Promise.resolve()),
}));

const traccar = require('../services/traccar');
const mspf = require('../services/mspf');
const foxlogger = require('../services/foxlogger');
const cache = require('../services/cache');
const positionSync = require('../services/positionSync');

describe('Pilar 1: PositionSync Concurrency Guard & Timeout Watchdog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cache.del('devices:merged');
    cache.del('positions:merged');

    // Populate devices:merged
    cache.set('devices:merged', [
      { id: 101, source: 'traccar', group: 'traccar_1' },
      { id: 1001, source: 'mspf', group: 'mspf_1' },
    ], 300);

    // Default fast mocks
    traccar.getPositions.mockResolvedValue([
      { deviceId: 101, source: 'traccar', speed: 10, latitude: -6.2, longitude: 106.8 },
    ]);
    mspf.getPositions.mockResolvedValue([
      { deviceId: 1001, source: 'mspf', speed: 20, latitude: -6.1, longitude: 106.9 },
    ]);
    foxlogger.getPositions.mockResolvedValue([]);
  });

  test('Kasus 1: Tick saat sync sedang berjalan dilewati (skipped)', async () => {
    let resolveFirstSync;
    const slowSyncPromise = new Promise((resolve) => {
      resolveFirstSync = resolve;
    });

    // MSPF getPositions menggantung sampai resolveFirstSync dipanggil
    mspf.getPositions.mockImplementationOnce(() => slowSyncPromise);

    // Panggil sync pertama (aktif di background)
    const run1Promise = positionSync.syncPositions();

    // Panggil sync kedua saat sync pertama masih aktif
    await positionSync.syncPositions();

    // Traccar hanya boleh dipanggil 1 kali (karena run kedua dilewati/skipped)
    expect(traccar.getPositions).toHaveBeenCalledTimes(1);

    // Selesaikan sync pertama
    resolveFirstSync([
      { deviceId: 1001, source: 'mspf', speed: 20, latitude: -6.1, longitude: 106.9 },
    ]);
    await run1Promise;

    // Setelah sync pertama selesai, sync ketiga berikutnya bisa berjalan normal
    await positionSync.syncPositions();
    expect(traccar.getPositions).toHaveBeenCalledTimes(2);
  });

  test('Kasus 2: Sync yang throw error tidak menyangkutkan guard (isSyncing ter-reset)', async () => {
    // Traccar throw error tak terduga
    traccar.getPositions.mockRejectedValueOnce(new Error('Fatal upstream network crash'));

    // Eksekusi sync yang gagal
    try {
      await positionSync.syncPositions();
    } catch {}

    // Guard tidak boleh tersangkut true — sync berikutnya harus bisa berjalan
    traccar.getPositions.mockResolvedValueOnce([
      { deviceId: 101, source: 'traccar', speed: 10, latitude: -6.2, longitude: 106.8 },
    ]);

    await positionSync.syncPositions();
    expect(traccar.getPositions).toHaveBeenCalledTimes(2);
  });

  test('Kasus 3: Sync yang menggantung dihentikan oleh batas waktu (timeout watchdog)', async () => {
    // Simulasi sync pertama yang menggantung selamanya (never resolves)
    mspf.getPositions.mockImplementationOnce(() => new Promise(() => {}));

    // Start sync yang menggantung
    positionSync.syncPositions();

    expect(traccar.getPositions).toHaveBeenCalledTimes(1);

    // Tick kedua segera sesudahnya: masih dalam window 120s -> harus di-skip
    await positionSync.syncPositions();
    expect(traccar.getPositions).toHaveBeenCalledTimes(1);

    // Fast-forward waktu 121 detik (melebihi batas timeout 120s)
    const originalDateNow = Date.now;
    try {
      Date.now = jest.fn(() => originalDateNow() + 125000);

      // Panggil sync lagi: guard mendeteksi timeout > 120s, mengizinkan sync baru berjalan
      await positionSync.syncPositions();
      expect(traccar.getPositions).toHaveBeenCalledTimes(2);
    } finally {
      Date.now = originalDateNow;
    }
  });
});
