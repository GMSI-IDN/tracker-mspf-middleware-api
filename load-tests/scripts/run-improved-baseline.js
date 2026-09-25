const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const endpointType = process.argv[2] || 'devices'; // 'devices' or 'positions'
const scriptName = endpointType === 'positions' ? 'positions-only.yml' : 'devices-only.yml';
const rootDir = path.resolve(__dirname, '../..');
const resultsDir = path.resolve(rootDir, 'load-tests/results');
const scriptPath = path.resolve(__dirname, scriptName);

if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir, { recursive: true });
}

console.log('='.repeat(75));
console.log(`IMPROVED BASELINE RUNNER: Endpoint [${endpointType.toUpperCase()}]`);
console.log('='.repeat(75));

// 1. Run Preflight Safety Gate
console.log('\nStep 1: Running Preflight Safety Gate...');
const runEnv = { ...process.env, DOTENV_CONFIG_PATH: path.resolve(__dirname, '../.env.loadtest') };
try {
  execSync('node -r dotenv/config load-tests/scripts/preflight.js', { stdio: 'inherit', cwd: rootDir, env: runEnv });
} catch (err) {
  console.error('\n❌ Preflight safety check failed. Aborting test execution.');
  process.exit(1);
}

// 2. Generate Auth Tokens
console.log('\nStep 2: Generating Auth Tokens...');
try {
  execSync('node -r dotenv/config load-tests/scripts/generate-tokens.js', { stdio: 'inherit', cwd: rootDir, env: runEnv });
} catch (err) {
  console.error('\n❌ Token generation failed. Aborting test execution.');
  process.exit(1);
}

// 3. Find Middleware PID
let middlewarePid = null;
try {
  const lsofOut = execSync('lsof -t -i :3001', { encoding: 'utf8' }).trim();
  middlewarePid = lsofOut.split('\n')[0];
  console.log(`Found Middleware process on port 3001 (PID: ${middlewarePid})`);
} catch {
  console.error('Middleware is not running on port 3001! Please start the middleware server first.');
  process.exit(1);
}

// 4. Run Artillery with CPU sampling
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const jsonReport = path.resolve(resultsDir, `baseline-${endpointType}-${timestamp}.json`);

console.log(`\nStep 3: Executing Artillery (${scriptName}) for 2 minutes at 50 RPS...`);
console.log(`Output: ${jsonReport}`);

// Start CPU monitor for Middleware & Artillery
const cpuSamples = { middleware: [], artillery: [] };
let artilleryPid = null;
let monitorInterval = null;

const artProcess = spawn('npx', ['artillery', 'run', scriptPath, '--output', jsonReport], {
  cwd: rootDir,
  stdio: ['ignore', 'inherit', 'inherit'],
});
artilleryPid = artProcess.pid;

monitorInterval = setInterval(() => {
  try {
    if (middlewarePid) {
      const outM = execSync(`ps -p ${middlewarePid} -o %cpu --no-headers`, { encoding: 'utf8' }).trim();
      const valM = parseFloat(outM) || 0;
      if (!isNaN(valM)) cpuSamples.middleware.push(valM);
    }
  } catch {}
  try {
    if (artilleryPid) {
      const outA = execSync(`ps -p ${artilleryPid} -o %cpu --no-headers`, { encoding: 'utf8' }).trim();
      const valA = parseFloat(outA) || 0;
      if (!isNaN(valA)) cpuSamples.artillery.push(valA);
    }
  } catch {}
}, 2000);

artProcess.on('close', (code) => {
  clearInterval(monitorInterval);
  console.log('\n' + '='.repeat(75));
  console.log(`TEST RUN COMPLETED (Exit code: ${code})`);
  console.log('='.repeat(75));

  // Compute CPU stats
  const avgM = cpuSamples.middleware.length ? (cpuSamples.middleware.reduce((a, b) => a + b, 0) / cpuSamples.middleware.length).toFixed(1) : 'N/A';
  const maxM = cpuSamples.middleware.length ? Math.max(...cpuSamples.middleware).toFixed(1) : 'N/A';

  const avgA = cpuSamples.artillery.length ? (cpuSamples.artillery.reduce((a, b) => a + b, 0) / cpuSamples.artillery.length).toFixed(1) : 'N/A';
  const maxA = cpuSamples.artillery.length ? Math.max(...cpuSamples.artillery).toFixed(1) : 'N/A';

  console.log('\n--- CPU MONITORING SUMMARY ---');
  console.log(`Middleware PID ${middlewarePid} CPU: Avg ${avgM}% | Max ${maxM}%`);
  console.log(`Artillery  PID ${artilleryPid} CPU: Avg ${avgA}% | Max ${maxA}%`);

  // Check log for TypeError
  console.log('\n--- SERVER LOG INTEGRITY CHECK (CACHE_FREEZE Guard) ---');
  try {
    const logContent = fs.readFileSync('/tmp/middleware-loadtest.log', 'utf8');
    if (logContent.includes('TypeError')) {
      console.error('🚨 ALERT: TypeError DETECTED in middleware log during test!');
      const lines = logContent.split('\n').filter(l => l.includes('TypeError'));
      console.error(lines.slice(0, 5).join('\n'));
    } else {
      console.log('✅ ZERO TypeError in middleware log! Deep Freeze strict guard passed with zero mutations.');
    }
  } catch (err) {
    console.log('Could not read /tmp/middleware-loadtest.log:', err.message);
  }

  process.exit(code || 0);
});
