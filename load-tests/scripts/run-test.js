/**
 * Test Runner Script
 * Usage: node load-tests/scripts/run-test.js [smoke|load|stress]
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const scenario = process.argv[2] || 'smoke';
const validScenarios = ['smoke', 'load', 'stress'];

if (!validScenarios.includes(scenario)) {
  console.error(`Invalid scenario "${scenario}". Choose one of: ${validScenarios.join(', ')}`);
  process.exit(1);
}

const rootDir = path.resolve(__dirname, '../..');
const resultsDir = path.resolve(rootDir, 'load-tests/results');
if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir, { recursive: true });
}

console.log('='.repeat(70));
console.log(`🚀 LOAD TEST RUNNER: Scenario [${scenario.toUpperCase()}]`);
console.log('='.repeat(70));

// 1. Run Preflight Safety Gate
console.log('\nStep 1: Running Preflight Safety Gate...');
const runEnv = { ...process.env, DOTENV_CONFIG_PATH: path.resolve(__dirname, '../.env.loadtest') };
try {
  execSync('node -r dotenv/config load-tests/scripts/preflight.js', { stdio: 'inherit', cwd: rootDir, env: runEnv });
} catch (err) {
  console.error('\n❌ Preflight safety check failed. Aborting test execution.');
  process.exit(1);
}

// 2. Generate Tokens
console.log('\nStep 2: Generating Auth Tokens...');
try {
  execSync('node -r dotenv/config load-tests/scripts/generate-tokens.js', { stdio: 'inherit', cwd: rootDir, env: runEnv });
} catch (err) {
  console.error('\n❌ Token generation failed. Aborting test execution.');
  process.exit(1);
}

// 3. Execute Artillery
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const jsonReport = path.resolve(resultsDir, `${scenario}-${timestamp}.json`);
const htmlReport = path.resolve(resultsDir, `${scenario}-${timestamp}.html`);
const scriptPath = path.resolve(__dirname, `${scenario}.yml`);

console.log(`\nStep 3: Executing Artillery (${scenario})...`);
console.log(`Target Script: ${scriptPath}`);
console.log(`Results JSON:  ${jsonReport}`);

try {
  execSync(
    `npx artillery run "${scriptPath}" --output "${jsonReport}"`,
    { stdio: 'inherit', cwd: rootDir }
  );

  console.log('\nStep 4: Generating HTML Report...');
  execSync(
    `npx artillery report "${jsonReport}" --output "${htmlReport}"`,
    { stdio: 'inherit', cwd: rootDir }
  );
  console.log(`✅ HTML Report generated: ${htmlReport}`);
} catch (err) {
  console.error(`\n⚠️ Test finished or threshold breached. Check results in ${jsonReport}`);
}
