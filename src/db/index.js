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
const env = config.env === 'production' ? 'production' : 'development';
const db = require('knex')(knexfile[env]);

let migrationDone = false;
const migrationQueue = [];

function runMigrations() {
  return db.migrate.latest().then(() => db.seed.run());
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
