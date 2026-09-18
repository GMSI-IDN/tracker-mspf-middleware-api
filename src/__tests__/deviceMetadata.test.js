const { mergeMetadataBlobs } = require('../utils/deviceMetadata');

describe('mergeMetadataBlobs', () => {
  test('merges admin and customer blobs into flat object with owners map', () => {
    const { merged, owners } = mergeMetadataBlobs(
      { jenis: 'Box', merek: 'Mitsubishi' },
      { catatan: 'cek AC' }
    );
    expect(merged).toEqual({ jenis: 'Box', merek: 'Mitsubishi', catatan: 'cek AC' });
    expect(owners).toEqual({ jenis: 'admin', merek: 'admin', catatan: 'customer' });
  });

  test('admin wins on key collision', () => {
    const { merged, owners } = mergeMetadataBlobs(
      { warna: 'Putih', jenis: 'Box' },
      { warna: 'customer value', catatan: 'note' }
    );
    expect(merged.warna).toBe('Putih');
    expect(merged.catatan).toBe('note');
    expect(owners.warna).toBe('admin');
    expect(owners.catatan).toBe('customer');
  });

  test('handles empty or non-object inputs', () => {
    expect(mergeMetadataBlobs(undefined, null)).toEqual({ merged: {}, owners: {} });
    expect(mergeMetadataBlobs('x', [])).toEqual({ merged: {}, owners: {} });
    expect(mergeMetadataBlobs({ a: 1 }, {})).toEqual({ merged: { a: 1 }, owners: { a: 'admin' } });
    expect(mergeMetadataBlobs({}, { b: 2 })).toEqual({ merged: { b: 2 }, owners: { b: 'customer' } });
  });

  test('does not mutate inputs', () => {
    const admin = { a: 1 };
    const customer = { b: 2 };
    mergeMetadataBlobs(admin, customer);
    expect(admin).toEqual({ a: 1 });
    expect(customer).toEqual({ b: 2 });
  });
});

describe('large device_id (IMEI / 64-bit) support', () => {
  const db = require('../db');
  const LARGE_ID = 780901703170270;

  beforeAll(async () => {
    await db.waitForMigration();
  });

  afterAll(async () => {
    await db('device_metadata').where({ device_id: LARGE_ID }).delete();
    await db('device_groups').where({ device_id: LARGE_ID }).delete();
    await db('command_logs').where({ device_id: LARGE_ID }).delete();
  });

  test('can insert, select, and delete 15-digit device_id in device_metadata', async () => {
    await db('device_metadata').insert({
      device_id: LARGE_ID,
      source: 'foxlogger',
      owner: 'admin',
      data: JSON.stringify({ notes: 'IMEI device' }),
    });

    const rows = await db('device_metadata').where({ source: 'foxlogger' }).whereIn('device_id', [LARGE_ID]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].device_id)).toBe(LARGE_ID);

    await db('device_metadata').where({ device_id: LARGE_ID, source: 'foxlogger' }).delete();
  });

  test('can insert and select 15-digit device_id in device_groups and command_logs', async () => {
    await db('device_groups').insert({
      device_id: LARGE_ID,
      source: 'foxlogger',
      group_id: 1,
    });
    const dg = await db('device_groups').where({ device_id: LARGE_ID }).first();
    expect(dg).toBeDefined();
    expect(Number(dg.device_id)).toBe(LARGE_ID);

    await db('command_logs').insert({
      device_id: LARGE_ID,
      source: 'foxlogger',
      command_type: 'engineStop',
      status: 'SUCCESS',
    });
    const cl = await db('command_logs').where({ device_id: LARGE_ID }).first();
    expect(cl).toBeDefined();
    expect(Number(cl.device_id)).toBe(LARGE_ID);
  });
});
