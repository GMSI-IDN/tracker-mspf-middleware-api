const path = require('path');
const dotenv = require('dotenv');

// Force load and override with .env.loadtest
const envPath = path.resolve(__dirname, '../.env.loadtest');
dotenv.config({ path: envPath, override: true });

console.log('[StartServer] Starting middleware with loadtest config...');
console.log(`[StartServer] PORT: ${process.env.PORT}`);
console.log(`[StartServer] TRACCAR_URL: ${process.env.TRACCAR_URL}`);
console.log(`[StartServer] MSPF_URL: ${process.env.MSPF_URL}`);
console.log(`[StartServer] DB_HOST: ${process.env.DB_HOST}:${process.env.DB_PORT}`);

// Start server
require('../../src/server');
