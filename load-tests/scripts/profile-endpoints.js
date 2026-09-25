const inspector = require('inspector');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const jwt = require('jsonwebtoken');

// Preload env
require('dotenv').config({ path: path.resolve(__dirname, '../.env.loadtest'), override: true });

const app = require('../../src/app');
const config = require('../../src/config');
const db = require('../../src/db');
const cache = require('../../src/services/cache');

const adminToken = jwt.sign({ id: 1, role: 'admin', isActive: true, tokenVersion: 1 }, config.jwt.secret);
const customerToken = jwt.sign({ id: 2, role: 'customer', isActive: true, tokenVersion: 1, groups: [1] }, config.jwt.secret);

async function runProfile() {
  await db.waitForMigration();
  console.log('1. Warming up cache and auth...');

  // Warm cache with 1200 synthetic devices matching mock
  const dummyDevices = [];
  for (let i = 1; i <= 1200; i++) {
    dummyDevices.push({
      id: i,
      name: `Unit ${i}`,
      source: i <= 90 ? 'traccar' : (i === 91 ? 'foxlogger' : 'mspf'),
      group: i <= 90 ? 'traccar_1' : 'mspf_1',
      status: 'online',
      attributes: { power: 12.5, ignition: true, volt: 12.5, addr_IB: 3.8 },
    });
  }
  cache.set('devices:merged', dummyDevices, 300);
  cache.set('positions:merged', dummyDevices.map(d => ({ deviceId: d.id, source: d.source, attributes: { ...d.attributes } })), 300);

  // Warm auth status & device rules
  await request(app).get('/api/devices?limit=5').set('Authorization', `Bearer ${adminToken}`);
  await request(app).get('/api/positions').set('Authorization', `Bearer ${adminToken}`);
  await request(app).get('/api/devices?limit=5').set('Authorization', `Bearer ${customerToken}`);
  await request(app).get('/api/positions').set('Authorization', `Bearer ${customerToken}`);

  console.log('2. Starting V8 CPU Profile during high load (100 requests x 1,200 devices)...');
  const session = new inspector.Session();
  session.connect();

  await new Promise((resolve) => session.post('Profiler.enable', resolve));
  await new Promise((resolve) => session.post('Profiler.start', resolve));

  const startTime = Date.now();
  // Fire 100 requests to /api/positions and /api/devices
  for (let i = 0; i < 50; i++) {
    await request(app).get('/api/positions').set('Authorization', `Bearer ${adminToken}`);
    await request(app).get('/api/devices?page=1&limit=50').set('Authorization', `Bearer ${adminToken}`);
  }
  const durationMs = Date.now() - startTime;
  console.log(`3. Finished 100 heavy requests in ${durationMs}ms (${(100 / (durationMs / 1000)).toFixed(2)} req/s). Stopping profiler...`);

  await new Promise((resolve) => {
    session.post('Profiler.stop', (err, { profile }) => {
      const outputPath = path.resolve(__dirname, '../results/loadtest-cpu.cpuprofile');
      fs.writeFileSync(outputPath, JSON.stringify(profile));
      console.log(`4. Saved CPU profile to ${outputPath}`);
      resolve();
    });
  });

  await db.destroy();
  console.log('5. Database connection closed. Analyzing profile...');
  require('./analyze-profile');
}

runProfile().catch((err) => {
  console.error('Profile failed:', err);
  process.exit(1);
});
