function mergeMetadataBlobs(adminData, customerData) {
  const admin = adminData && typeof adminData === 'object' && !Array.isArray(adminData) ? adminData : {};
  const customer = customerData && typeof customerData === 'object' && !Array.isArray(customerData) ? customerData : {};
  const merged = {};
  const owners = {};

  for (const [key, value] of Object.entries(admin)) {
    merged[key] = value;
    owners[key] = 'admin';
  }
  for (const [key, value] of Object.entries(customer)) {
    if (!(key in merged)) {
      merged[key] = value;
      owners[key] = 'customer';
    }
  }

  return { merged, owners };
}

module.exports = { mergeMetadataBlobs };
