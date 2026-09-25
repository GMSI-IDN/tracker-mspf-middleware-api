/**
 * Token Generator for Artillery Load Testing
 * Generates valid JWT tokens for admin and customer roles
 * and saves them to load-tests/scripts/tokens.csv
 */

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

// Load environment variables
const envLoadtestPath = path.resolve(__dirname, '../.env.loadtest');
const envRootPath = path.resolve(__dirname, '../../.env');

if (fs.existsSync(envLoadtestPath)) {
  require('dotenv').config({ path: envLoadtestPath });
} else if (fs.existsSync(envRootPath)) {
  require('dotenv').config({ path: envRootPath });
}

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key_change_in_production';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '8h';

const users = [
  {
    id: 1,
    username: 'admin',
    email: 'admin@system.local',
    role: 'admin',
    isActive: true,
    tokenVersion: 1,
    groups: [],
    timezone: 'Asia/Jakarta',
    permissions: { canCutEngine: true },
  },
  {
    id: 2,
    username: 'rental',
    email: 'customer@system.local',
    role: 'customer',
    isActive: true,
    tokenVersion: 1,
    groups: [1],
    timezone: 'Asia/Jakarta',
    permissions: { canCutEngine: false },
  },
];

const csvRows = [];

for (const user of users) {
  const token = jwt.sign(user, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  csvRows.push(`${token},${user.role},${user.username}`);
}

const outputPath = path.resolve(__dirname, 'tokens.csv');
fs.writeFileSync(outputPath, csvRows.join('\n') + '\n', 'utf8');

console.log(`[TokenGenerator] Successfully generated ${users.length} tokens at ${outputPath}`);
