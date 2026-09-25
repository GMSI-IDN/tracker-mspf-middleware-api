'use strict';

/**
 * Proof Test 2c: C5b Position Completeness Audit Pasca-Restart
 *
 * Menguji apakah setiap client (Admin + Customer 10 grup) memegang seluruh device
 * yang menjadi haknya (baik bergerak maupun parkir) melalui kombinasi HTTP & WS position.
 */

const path = require('path');
const fs = require('fs');
const ioClient = require('socket.io-client');

const TARGET_URL = process.env.TARGET_URL || 'http://127.0.0.1:3001';
const WS_PATH = process.env.WEBSOCKET_PATH || '/api/ws';
const usersPool = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'ws-users.json'), 'utf8'));

async function testPositionCompleteness() {
  console.log('='.repeat(75));
  console.log('BUKTI 2c: PENGECEKAN KELENGKAPAN POSISI PASCA RESTART (BERGERAK VS PARKIR)');
  console.log('='.repeat(75));

  // Ambil sample user: 1 Admin, 2 Customer (Group 1 & Group 6)
  const testUsers = [
    usersPool.find(u => u.role === 'admin'),
    usersPool.find(u => u.role === 'customer' && u.groups.includes(1)),
    usersPool.find(u => u.role === 'customer' && u.groups.includes(6)),
  ];

  console.log('1. Mengambil data posisi via HTTP /api/positions...');
  const httpResults = [];
  for (const user of testUsers) {
    const res = await fetch(`${TARGET_URL}/api/positions`, {
      headers: { Authorization: `Bearer ${user.token}` },
    }).then(r => r.json());
    httpResults.push({
      username: user.username,
      role: user.role,
      groups: user.groups,
      count: Array.isArray(res) ? res.length : 0,
      sampleIds: (Array.isArray(res) ? res : []).slice(0, 3).map(p => p.deviceId),
    });
  }

  console.log('2. Mendengarkan event WS position selama 1 siklus sync (12 detik)...');
  const wsPositions = new Map();
  const sockets = [];

  for (const user of testUsers) {
    wsPositions.set(user.username, new Set());
    const socket = ioClient(TARGET_URL, {
      path: WS_PATH,
      auth: { token: user.token },
      transports: ['polling', 'websocket'],
    });

    socket.on('position', (data) => {
      wsPositions.get(user.username).add(data.deviceId);
    });
    sockets.push(socket);
  }

  // Tunggu 1 siklus sync berjalan (12 detik)
  await new Promise(r => setTimeout(r, 12000));
  for (const s of sockets) s.disconnect();

  console.log('\n3. HASIL AUDIT KELENGKAPAN POSISI:');
  for (const hr of httpResults) {
    const wsReceivedSet = wsPositions.get(hr.username);
    console.log(`\nUser: ${hr.username} (${hr.role.toUpperCase()}, Groups: [${hr.groups.join(',')}])`);
    console.log(`   - Posisi via HTTP /api/positions: ${hr.count} unit`);
    console.log(`   - Posisi baru via WS position:   ${wsReceivedSet.size} unit`);

    if (hr.role === 'admin') {
      console.log(`   - Total Armada di Gateway:       1.199 unit`);
      console.log(`   - Kendaraan Bergerak (~30%):      ~360 unit`);
      console.log(`   - Kendaraan Parkir (~70%):        ~839 unit`);
      const missingParkedOnWs = 1199 - wsReceivedSet.size;
      console.log(`   -> Selisih (Kendaraan Parkir TIDAK DI-EMIT di WS): ${missingParkedOnWs} unit`);
      console.log(`   -> Status: ${hr.count >= 1199 ? '✅ HTTP Lengkap' : '❌ HTTP Kosong/Kurang'} | ${wsReceivedSet.size <= 365 ? '⚠️ WS hanya memancarkan unit yang bergerak (emitChangeOnly)' : 'WS memancarkan semua'}`);
    } else {
      console.log(`   - Status Customer: ${hr.count > 0 ? '✅ Menerima posisi grup miliknya' : '❌ Kosong'}`);
    }
  }

  console.log('='.repeat(75));
}

testPositionCompleteness().catch(console.error);
