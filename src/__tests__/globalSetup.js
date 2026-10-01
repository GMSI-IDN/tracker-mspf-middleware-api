'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const rootDir = path.resolve(__dirname, '..', '..');
const dataDir = path.resolve(rootDir, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const existingFiles = fs.readdirSync(dataDir);
for (const file of existingFiles) {
  if (file.startsWith('test') && (file.endsWith('.db') || file.endsWith('.db-wal') || file.endsWith('.db-shm'))) {
    try {
      fs.unlinkSync(path.join(dataDir, file));
    } catch {}
  }
}

process.env.JWT_SECRET = 'test-secret';
process.env.TRACCAR_URL = 'http://localhost:18082';
process.env.TRACCAR_USERNAME = 'test';
process.env.TRACCAR_PASSWORD = 'test';
process.env.MSPF_URL = 'http://localhost:18080/api';
process.env.MSPF_CLIENT_ID = 'test-client';
process.env.MSPF_CLIENT_SECRET = 'test-secret';
process.env.DB_DRIVER = 'sqlite3';
process.env.DB_PATH = './data/test.db';
process.env.LOG_LEVEL = 'silent';

const db = require('../db');

module.exports = async () => {
  await db.waitForMigration();
  await db.destroy();

  const templateDb = path.resolve(dataDir, 'test.db');
  const numWorkers = Math.max(os.cpus().length * 2, 16);
  for (let i = 1; i <= numWorkers; i++) {
    const workerDb = path.resolve(dataDir, `test-${i}.db`);
    fs.copyFileSync(templateDb, workerDb);
  }
};
