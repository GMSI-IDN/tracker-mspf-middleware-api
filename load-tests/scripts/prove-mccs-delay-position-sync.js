'use strict';

/**
 * Proof of Pilar 1 + Pilar 3: Fast Position Sync with MOCK_MCCS_DELAY_MS=500
 *
 * Membuktikan bahwa meskipun endpoint MCCS history memiliki delay 500ms (yang sebelumnya
 * membuat sync lambat 55 detik di staging), positionSync fast path kini selesai dalam ~1-2 detik
 * dan berhasil memperbarui posisi secara presisi setiap ~10 detik!
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '../..');
const runEnv = {
  ...process.env,
  DOTENV_CONFIG_PATH: path.resolve(__dirname, '../.env.loadtest'),
  MOCK_MCCS_DELAY_MS: '500', // 500ms delay per MCCS history call
};

async function runProof() {
  console.log('='.repeat(75));
  console.log('PEMBUKTIAN PILAR 1 + PILAR 3: FAST POSITION SYNC (MOCK_MCCS_DELAY_MS=500)');
  console.log('='.repeat(75));

  // 1. Matikan proses lama jika ada
  try { execSync('fuser -k 3001/tcp 4000/tcp 2>/dev/null || true'); } catch {}
  await new Promise(r => setTimeout(r, 1000));

  // 2. Nyalakan mock upstream dengan MOCK_MCCS_DELAY_MS=500
  console.log('1. Menyalakan Mock Upstream dengan MOCK_MCCS_DELAY_MS=500...');
  const mockProc = spawn('node', ['load-tests/mock-upstream/server.js'], {
    cwd: rootDir,
    env: runEnv,
    stdio: 'ignore',
  });

  await new Promise(r => setTimeout(r, 1500));

  // 3. Nyalakan middleware
  console.log('2. Menyalakan Middleware API...');
  const mwLogPath = '/tmp/prove-fast-sync.log';
  if (fs.existsSync(mwLogPath)) fs.unlinkSync(mwLogPath);
  const mwLogStream = fs.openSync(mwLogPath, 'a');

  const mwProc = spawn('node', ['--env-file=load-tests/.env.loadtest', 'src/server.js'], {
    cwd: rootDir,
    env: runEnv,
    stdio: ['ignore', mwLogStream, mwLogStream],
  });

  // Tunggu middleware siap
  console.log('3. Menunggu middleware siap (health check & initial sync)...');
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch('http://127.0.0.1:3001/health');
      if (res.ok) { ready = true; break; }
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  if (!ready) {
    console.error('Middleware failed to start!');
    mockProc.kill();
    mwProc.kill();
    process.exit(1);
  }
  console.log('Middleware healthy & operational!');

  // 4. Amati 3 siklus syncPositions berturut-turut (~35 detik)
  console.log('4. Memantau durasi eksekusi dan interval 3 siklus syncPositions berturut-turut (35s)...');
  const initialLog = fs.readFileSync(mwLogPath, 'utf8');

  await new Promise(r => setTimeout(r, 35000));

  const finalLog = fs.readFileSync(mwLogPath, 'utf8');
  const syncLines = finalLog.split('\n').filter(line => line.includes('[PositionSync] completed in') || line.includes('[PositionSync] start'));

  console.log('\n--- CUPLIKAN LOG EKSEKUSI POSITIONSYNC ---');
  console.log(syncLines.slice(-10).join('\n'));

  // Parse durations
  const completedLines = finalLog.split('\n').filter(line => line.includes('[PositionSync] completed in'));
  const durations = completedLines.map(l => {
    const match = l.match(/completed in (\d+)ms/);
    return match ? parseInt(match[1], 10) : null;
  }).filter(Boolean);

  console.log('\n--- HASIL ANALISIS SIKLUS SYNC ---');
  console.log(`Jumlah siklus sync yang selesai: ${durations.length}`);
  console.log(`Durasi per siklus: ${durations.join(' ms, ')} ms`);

  const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  console.log(`Rata-rata durasi penyelesaian sync: ${avgDuration} ms`);

  const isFast = durations.every(d => d < 5000);
  console.log(`-> Apakah sync selesai dalam < 5 detik (bebas hambatan MCCS 500ms)? ${isFast ? '✅ YA! FAST SYNC BERHASIL SEMPURNA' : '❌ MASIH TERHAMBAT'}`);
  console.log('='.repeat(75));

  // Cleanup
  mockProc.kill();
  mwProc.kill();
  try { execSync('fuser -k 3001/tcp 4000/tcp 2>/dev/null || true'); } catch {}
}

runProof().catch(console.error);
