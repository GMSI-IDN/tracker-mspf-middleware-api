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
