require('dotenv').config();
const path = require('path');

const resolveDbPath = (p) => path.resolve(__dirname, p || './data/gateway.db');

const isPg = (driver) => {
  const d = String(driver || '').toLowerCase().trim();
  return d === 'pg' || d === 'postgres' || d === 'postgresql';
};

const activeDriver = isPg(process.env.DB_DRIVER) ? 'pg' : 'sqlite';

const sqliteConfig = {
  client: 'better-sqlite3',
  connection: { filename: resolveDbPath(process.env.DB_PATH) },
  useNullAsDefault: true,
  migrations: { directory: path.resolve(__dirname, 'migrations') },
  seeds: { directory: path.resolve(__dirname, 'seeds') },
  pool: {
    afterCreate: (conn, cb) => {
      conn.pragma('journal_mode = WAL');
      cb();
    },
  },
};

const pgConnection = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT, 10) || 5432,
      database: process.env.DB_NAME || 'gateway',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASS || '',
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    };

const pgConfig = {
  client: 'pg',
  connection: pgConnection,
  pool: { min: 2, max: 10 },
  migrations: { directory: path.resolve(__dirname, 'migrations') },
  seeds: { directory: path.resolve(__dirname, 'seeds') },
};

module.exports = {
  sqlite: sqliteConfig,
  sqlite3: sqliteConfig,
  pg: pgConfig,
  postgres: pgConfig,
  postgresql: pgConfig,

  // Backward-compatibility with Knex CLI default environments:
  development: activeDriver === 'pg' ? pgConfig : sqliteConfig,
  production: activeDriver === 'pg' ? pgConfig : sqliteConfig,
  test: sqliteConfig,
};
