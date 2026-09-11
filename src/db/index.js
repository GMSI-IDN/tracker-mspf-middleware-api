const path = require('path');
const fs = require('fs');
const config = require('../config');
const rootDir = path.resolve(__dirname, '..', '..');

if (config.dbDriver === 'sqlite3') {
  const dbPath = path.resolve(rootDir, config.db.path);
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
}

const knexfile = require(path.resolve(rootDir, 'knexfile.js'));
const driverKey = config.dbDriver === 'pg' ? 'pg' : 'sqlite';
const db = require('knex')(knexfile[driverKey] || knexfile.sqlite);

let migrationDone = false;
const migrationQueue = [];

// ponytail: in-app migration runner ceiling: multi-replica concurrency race on startup -> upgrade path: dedicated initContainer or CI/CD pre-deploy migration runner
function runMigrations() {
  const shouldSeed = process.env.NODE_ENV === 'test' || process.env.AUTO_SEED === 'true';
  if (shouldSeed) {
    return db.migrate.latest().then(() => db.seed.run());
  }
  return db.migrate.latest();
}

if (process.env.RUN_MIGRATIONS === 'false') {
  migrationDone = true;
} else {
  runMigrations().then(() => {
    migrationDone = true;
    migrationQueue.forEach(r => r());
  }).catch((err) => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  });
}

function waitForMigration() {
  if (migrationDone) return Promise.resolve();
  return new Promise((resolve) => migrationQueue.push(resolve));
}

module.exports = db;
module.exports.waitForMigration = waitForMigration;
module.exports.runMigrations = runMigrations;
