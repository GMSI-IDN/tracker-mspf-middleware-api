/**
 * Preflight Safety Gate for Middleware Load Testing
 *
 * Mandatory safety checks before running ANY load test:
 * 1. Target URL must be localhost, 127.0.0.1, or local container.
 * 2. Upstream URLs must NEVER point to production or staging servers.
 * 3. Mock Upstream server must be running and healthy.
 * 4. Target Middleware must be running and healthy.
 * 5. Checks system file descriptor limits (ulimit -n).
 */

const http = require('http');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Attempt to load .env.loadtest if it exists, otherwise fallback to .env
const envLoadtestPath = path.resolve(__dirname, '../.env.loadtest');
const envRootPath = path.resolve(__dirname, '../../.env');

if (fs.existsSync(envLoadtestPath)) {
  require('dotenv').config({ path: envLoadtestPath });
} else if (fs.existsSync(envRootPath)) {
  require('dotenv').config({ path: envRootPath });
}

const FORBIDDEN_PATTERNS = [
  'fleet-management-system.co.id',
  'cloud-gms.com',
  'foxlogger.app',
  'staging',
  'prod',
];

const TARGET_URL = process.env.TARGET_URL || process.env.BASE_URL || 'http://127.0.0.1:3000';
const MOCK_URL = process.env.MOCK_URL || `http://127.0.0.1:${process.env.MOCK_PORT || 4000}`;

const UPSTREAM_VARS = [
  { name: 'TRACCAR_URL', value: process.env.TRACCAR_URL },
  { name: 'MSPF_URL', value: process.env.MSPF_URL },
  { name: 'MSPF_TOKEN_URL', value: process.env.MSPF_TOKEN_URL },
];

function log(msg) {
  console.log(`[Preflight] ${msg}`);
}

function fail(reason) {
  console.error('\n' + '='.repeat(70));
  console.error('🚨 PREFLIGHT SAFETY CHECK FAILED: LOAD TEST ABORTED');
  console.error('='.repeat(70));
  console.error(`Reason: ${reason}\n`);
  process.exit(1);
}

function warn(msg) {
  console.warn(`⚠️  [Preflight Warning] ${msg}`);
}

async function pingUrl(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const req = http.get(
        {
          hostname: u.hostname,
          port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: u.pathname + (u.search || ''),
          timeout: timeoutMs,
        },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode, body }));
        }
      );
      req.on('error', (err) => resolve({ ok: false, error: err.message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: 'Timeout' });
      });
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

async function run() {
  log('Starting preflight safety checks...');

  // 1. Check Target URL safety
  log(`Verifying target middleware URL: ${TARGET_URL}`);
  const safeHostnames = ['localhost', '127.0.0.1', '0.0.0.0', 'middleware', 'gateway', 'app'];
  try {
    const targetParsed = new URL(TARGET_URL);
    if (!safeHostnames.includes(targetParsed.hostname)) {
      fail(`Target URL "${TARGET_URL}" is not pointing to localhost or local container!`);
    }
  } catch (err) {
    fail(`Invalid TARGET_URL format: ${err.message}`);
  }

  // 2. Check Upstream URL safety (Zero production hits)
  log('Verifying upstream URLs point strictly to local mock...');
  for (const { name, value } of UPSTREAM_VARS) {
    if (!value) continue;
    const lower = value.toLowerCase();
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (lower.includes(pattern)) {
        fail(
          `Environment variable ${name} contains forbidden production/staging host "${pattern}"!\n` +
          `Configured Value: ${value}\n` +
          `Refusing to proceed. Upstream must be pointed to the local mock server (e.g., http://127.0.0.1:4000).`
        );
      }
    }
    // Must be local / mock
    if (!lower.includes('localhost') && !lower.includes('127.0.0.1') && !lower.includes('mock-upstream')) {
      fail(
        `Environment variable ${name} ("${value}") is not pointing to localhost/127.0.0.1/mock-upstream!`
      );
    }
  }

  // 3. Check Database safety (Zero production/staging DB hits)
  log('Verifying Database host points strictly to local instance...');
  const dbDriver = (process.env.DB_DRIVER || 'sqlite3').toLowerCase();
  if (dbDriver === 'pg' || dbDriver === 'postgres' || dbDriver === 'postgresql') {
    const dbHost = (process.env.DB_HOST || '').toLowerCase();
    const dbUrl = (process.env.DATABASE_URL || '').toLowerCase();
    const safeDbHosts = ['localhost', '127.0.0.1', '0.0.0.0', 'postgres', 'pg'];

    if (dbUrl) {
      try {
        const parsedDbUrl = new URL(dbUrl);
        if (!safeDbHosts.includes(parsedDbUrl.hostname)) {
          fail(`DATABASE_URL host "${parsedDbUrl.hostname}" is not localhost/127.0.0.1! External DB is forbidden during load test.`);
        }
      } catch (err) {
        fail(`Invalid DATABASE_URL format: ${err.message}`);
      }
    } else {
      if (!dbHost || !safeDbHosts.includes(dbHost)) {
        fail(
          `DB_HOST ("${dbHost || 'empty'}") is not pointing to localhost / 127.0.0.1 / postgres!\n` +
          `External/remote database is strictly forbidden for load testing to prevent WAN latency skew & accidental data mutation.`
        );
      }
    }
    log(`Database host verified: ${dbHost || 'URL (local)'}`);
  } else {
    log('Database driver is sqlite3 (local file).');
  }

  // 4. Check FoxLogger safety
  if (process.env.FOXLOGGER_EMAIL || process.env.FOXLOGGER_PASSWORD) {
    warn(
      'FOXLOGGER_EMAIL is set. If testing without DNS spoofing to mock, set FOXLOGGER_EMAIL="" in .env.loadtest so the background worker skips calling live FoxLogger servers.'
    );
  }

  // 4. Check OS file descriptor limits
  try {
    const ulimit = execSync('ulimit -n', { shell: '/bin/bash' }).toString().trim();
    const limitNum = parseInt(ulimit, 10);
    log(`Current file descriptor limit (ulimit -n): ${ulimit}`);
    if (!isNaN(limitNum) && limitNum < 10000) {
      warn(
        `ulimit -n (${limitNum}) is below recommended 10,000 for high-load testing.\n` +
        `    Consider running "ulimit -n 65535" in your shell before running heavy stress tests.`
      );
    }
  } catch {
    // Non-bash or Windows environment
  }

  // 5. Check Mock Upstream connectivity
  log(`Checking Mock Upstream health at ${MOCK_URL}/health...`);
  const mockCheck = await pingUrl(`${MOCK_URL}/health`);
  if (!mockCheck.ok) {
    fail(
      `Mock Upstream is NOT reachable at ${MOCK_URL}/health (${mockCheck.error || mockCheck.status}).\n` +
      `Please start the mock upstream server first:\n` +
      `    node load-tests/mock-upstream/server.js`
    );
  }
  try {
    const parsed = JSON.parse(mockCheck.body);
    if (!parsed.mock) {
      fail(`Server at ${MOCK_URL}/health did not identify as mock server!`);
    }
    log(`Mock Upstream confirmed active with ${parsed.devices?.total || 0} synthetic devices.`);
  } catch {
    fail(`Could not parse JSON response from Mock Upstream at ${MOCK_URL}/health`);
  }

  // 6. Check Target Middleware connectivity
  log(`Checking Target Middleware health at ${TARGET_URL}/health...`);
  const targetCheck = await pingUrl(`${TARGET_URL}/health`);
  if (!targetCheck.ok) {
    fail(
      `Target Middleware is NOT reachable at ${TARGET_URL}/health (${targetCheck.error || targetCheck.status}).\n` +
      `Please ensure the API Gateway is running with load test configuration.`
    );
  }
  log('Target Middleware confirmed reachable.');

  console.log('\n' + '='.repeat(70));
  console.log('✅ PREFLIGHT SAFETY CHECK PASSED: Environment is safe for load testing.');
  console.log('='.repeat(70) + '\n');
}

if (require.main === module) {
  run().catch((err) => {
    console.error('Preflight unexpected error:', err);
    process.exit(1);
  });
}

module.exports = { run };
