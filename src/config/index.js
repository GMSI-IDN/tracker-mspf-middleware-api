require('dotenv').config();

const REQUIRED_ENV = [
  'JWT_SECRET',
  'TRACCAR_URL',
  'TRACCAR_USERNAME',
  'TRACCAR_PASSWORD',
  'MSPF_URL',
  'MSPF_CLIENT_ID',
  'MSPF_CLIENT_SECRET',
];

const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  env: process.env.NODE_ENV || 'development',
  dbDriver: process.env.DB_DRIVER || 'sqlite3',

  db: {
    path: process.env.DB_PATH || './data/gateway.db',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    name: process.env.DB_NAME || 'gateway',
    user: process.env.DB_USER || '',
    pass: process.env.DB_PASS || '',
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    expiry: process.env.JWT_EXPIRY || '8h',
  },

  traccar: {
    url: process.env.TRACCAR_URL,
    username: process.env.TRACCAR_USERNAME,
    password: process.env.TRACCAR_PASSWORD,
  },

  mspf: {
    url: process.env.MSPF_URL,
    clientId: process.env.MSPF_CLIENT_ID,
    clientSecret: process.env.MSPF_CLIENT_SECRET,
    tokenUrl: process.env.MSPF_TOKEN_URL || '',
    cacheTtl: parseInt(process.env.MCCS_CACHE_TTL, 10) || 10000,
  },

  cache: {
    ttl: parseInt(process.env.CACHE_DEVICE_TTL, 10) || 120,
    provider: process.env.CACHE_PROVIDER || 'node-cache',
  },

  websocket: {
    path: process.env.WEBSOCKET_PATH || '/api/ws',
    pollInterval: parseInt(process.env.POLL_INTERVAL, 10) || 10000,
    redisUrl: process.env.REDIS_URL || '',
  },

  cors: {
    origin: process.env.CORS_ORIGIN || '*',
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
    authMax: parseInt(process.env.RATE_LIMIT_AUTH_MAX, 10) || 20,
  },

  requestTimeout: parseInt(process.env.REQUEST_TIMEOUT, 10) || 30000,
};

module.exports = config;
