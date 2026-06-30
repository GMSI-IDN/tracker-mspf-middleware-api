require('dotenv').config();

module.exports = {
  development: {
    client: 'better-sqlite3',
    connection: { filename: process.env.DB_PATH || './data/gateway.db' },
    useNullAsDefault: true,
    migrations: { directory: './migrations' },
    seeds: { directory: './seeds' },
    pool: { afterCreate: (conn, cb) => { conn.pragma('journal_mode = WAL'); cb(); } },
  },
  production: {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT, 10) || 5432,
      database: process.env.DB_NAME || 'gateway',
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
    },
    pool: { min: 2, max: 10 },
    migrations: { directory: './migrations' },
    seeds: { directory: './seeds' },
  },
};
