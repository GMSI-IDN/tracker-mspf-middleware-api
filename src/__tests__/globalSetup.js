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
};
