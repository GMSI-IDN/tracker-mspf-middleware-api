const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

require('dotenv').config({ path: path.resolve(__dirname, '../.env.loadtest'), override: true });

const db = require('../../src/db');
const config = require('../../src/config');

const GROUPS_DATA = [
  { id: 1, name: 'Fleet Logistik Jakarta', description: 'Armada logistik area Jabodetabek' },
  { id: 2, name: 'Fleet Distribusi Jawa Barat', description: 'Armada distribusi Bandung & sekitarnya' },
  { id: 3, name: 'Fleet Ekspedisi Surabaya', description: 'Armada ekspedisi lintas Jawa Timur' },
  { id: 4, name: 'Fleet Cargo Medan', description: 'Armada cargo regional Sumatera Utara' },
  { id: 5, name: 'Fleet Transportasi Bali', description: 'Armada pariwisata & rental Bali' },
  { id: 6, name: 'Fleet Heavy Haulage Kalimantan', description: 'Armada angkutan berat industri' },
  { id: 7, name: 'Fleet Ritel Semarang', description: 'Armada distribusi ritel Jawa Tengah' },
  { id: 8, name: 'Fleet Truk Pendingin Makassar', description: 'Armada cold storage Indonesia Timur' },
  { id: 9, name: 'Fleet Operasional Tambang', description: 'Armada operasional tambang' },
  { id: 10, name: 'Fleet Rental VIP Corporate', description: 'Armada kendaraan eksekutif' },
];

async function seed() {
  await db.waitForMigration();
  console.log('1. Seeding 10 realistic fleet groups...');

  for (const g of GROUPS_DATA) {
    await db('groups').insert(g).onConflict('id').merge();
  }

  console.log('2. Mapping devices to groups (manual device_groups & sync rules)...');
  // Clean old test mappings
  await db('device_groups').delete();
  await db('group_sync_rules').delete();

  // A. Dynamic sync rules: MSPF BCs (1-5) mapped to Groups (1-5), Traccar Groups (1-3) mapped to Groups (1-3)
  await db('group_sync_rules').insert([
    { middleware_group_id: 1, source: 'traccar', source_group_id: 'traccar_1', source_group_name: 'Traccar Fleet Alpha' },
    { middleware_group_id: 2, source: 'traccar', source_group_id: 'traccar_2', source_group_name: 'Traccar Fleet Beta' },
    { middleware_group_id: 3, source: 'traccar', source_group_id: 'traccar_3', source_group_name: 'Traccar Fleet Gamma' },
    { middleware_group_id: 1, source: 'mspf', source_group_id: 'mspf_1', source_group_name: 'BC Jakarta' },
    { middleware_group_id: 2, source: 'mspf', source_group_id: 'mspf_2', source_group_name: 'BC Surabaya' },
    { middleware_group_id: 3, source: 'mspf', source_group_id: 'mspf_3', source_group_name: 'BC Bandung' },
    { middleware_group_id: 4, source: 'mspf', source_group_id: 'mspf_4', source_group_name: 'BC Medan' },
    { middleware_group_id: 5, source: 'mspf', source_group_id: 'mspf_5', source_group_name: 'BC Bali' },
  ]);

  // B. Manual device additions for Groups 6 - 10
  const manualRows = [];
  // Groups 6-10 take MSPF devices 1500-1800
  for (let dId = 1500; dId <= 1800; dId++) {
    const targetGroup = 6 + (dId % 5); // 6, 7, 8, 9, 10
    manualRows.push({ device_id: dId, source: 'mspf', group_id: targetGroup });
  }
  // FoxLogger in group 10
  manualRows.push({ device_id: 780901703170270, source: 'foxlogger', group_id: 10 });

  // Batch insert manual rows
  const CHUNK = 50;
  for (let i = 0; i < manualRows.length; i += CHUNK) {
    await db('device_groups').insert(manualRows.slice(i, i + CHUNK)).onConflict(['group_id', 'device_id', 'source']).ignore();
  }

  console.log(`Inserted ${manualRows.length} manual device mappings.`);

  console.log('3. Seeding realistic user accounts (5 Admin + 45 Customers)...');
  const passwordHash = bcrypt.hashSync('password123', 10);
  const usersList = [];

  // 5 Admin accounts (10%)
  for (let i = 1; i <= 5; i++) {
    usersList.push({
      id: 100 + i,
      username: `admin_${i}`,
      email: `admin_${i}@fleet.local`,
      password_hash: passwordHash,
      role: 'admin',
      is_active: true,
      token_version: 1,
      groups: JSON.stringify([]),
      timezone: 'Asia/Jakarta',
    });
  }

  // 30 Single-Group Customers
  for (let i = 1; i <= 30; i++) {
    const assignedGroup = ((i - 1) % 10) + 1; // 1 to 10
    usersList.push({
      id: 200 + i,
      username: `cust_single_${i}`,
      email: `cust_single_${i}@fleet.local`,
      password_hash: passwordHash,
      role: 'customer',
      is_active: true,
      token_version: 1,
      groups: JSON.stringify([assignedGroup]),
      timezone: 'Asia/Jakarta',
    });
  }

  // 15 Multi-Group Customers
  for (let i = 1; i <= 15; i++) {
    const g1 = ((i - 1) % 10) + 1;
    const g2 = (i % 10) + 1;
    usersList.push({
      id: 300 + i,
      username: `cust_multi_${i}`,
      email: `cust_multi_${i}@fleet.local`,
      password_hash: passwordHash,
      role: 'customer',
      is_active: true,
      token_version: 1,
      groups: JSON.stringify([g1, g2]),
      timezone: 'Asia/Jakarta',
    });
  }

  for (const u of usersList) {
    await db('users').insert(u).onConflict('id').merge();
  }

  console.log(`Seeded ${usersList.length} user accounts.`);

  // 4. Generate Tokens & Pool File
  console.log('4. Generating user JWT pool with realistic mix...');
  const pool = usersList.map((u) => {
    const userPayload = {
      id: u.id,
      username: u.username,
      email: u.email,
      role: u.role,
      isActive: true,
      tokenVersion: 1,
      groups: JSON.parse(u.groups),
      timezone: u.timezone,
    };
    const token = jwt.sign(userPayload, config.jwt.secret, { expiresIn: '8h' });
    return {
      id: u.id,
      username: u.username,
      role: u.role,
      groups: JSON.parse(u.groups),
      token,
    };
  });

  const poolPath = path.resolve(__dirname, 'ws-users.json');
  fs.writeFileSync(poolPath, JSON.stringify(pool, null, 2), 'utf8');
  console.log(`Saved ${pool.length} users with JWT tokens to ${poolPath}`);

  await db.destroy();
  console.log('✅ Realistic groups & users seeding completed successfully!');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
