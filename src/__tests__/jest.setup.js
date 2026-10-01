'use strict';

const fs = require('fs');
const path = require('path');

const workerId = process.env.JEST_WORKER_ID || '1';
const workerDbRel = `./data/test-${workerId}.db`;
const rootDir = path.resolve(__dirname, '..', '..');
const workerDbPath = path.resolve(rootDir, workerDbRel);
const templateDbPath = path.resolve(rootDir, 'data', 'test.db');

if (!fs.existsSync(workerDbPath) && fs.existsSync(templateDbPath)) {
  fs.copyFileSync(templateDbPath, workerDbPath);
}

process.env.JWT_SECRET = 'test-secret';
process.env.TRACCAR_URL = 'http://localhost:18082';
process.env.TRACCAR_USERNAME = 'test';
process.env.TRACCAR_PASSWORD = 'test';
process.env.MSPF_URL = 'http://localhost:18080/api';
process.env.MSPF_CLIENT_ID = 'test-client';
process.env.MSPF_CLIENT_SECRET = 'test-secret';
process.env.DB_DRIVER = 'sqlite3';
process.env.DB_PATH = workerDbRel;
process.env.CACHE_DEVICE_TTL = '120';
process.env.LOG_LEVEL = 'silent';
process.env.RATE_LIMIT_MAX = '10000';
process.env.RATE_LIMIT_AUTH_MAX = '10000';
process.env.FOXLOGGER_EMAIL = '';
process.env.FOXLOGGER_PASSWORD = '';
process.env.RUN_MIGRATIONS = 'false';
