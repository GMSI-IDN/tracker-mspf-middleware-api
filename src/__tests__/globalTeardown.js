'use strict';

const fs = require('fs');
const path = require('path');

module.exports = async () => {
  const dataDir = path.resolve(__dirname, '..', '..', 'data');
  if (fs.existsSync(dataDir)) {
    const files = fs.readdirSync(dataDir);
    for (const file of files) {
      if (file.startsWith('test') && (file.endsWith('.db') || file.endsWith('.db-wal') || file.endsWith('.db-shm'))) {
        try {
          fs.unlinkSync(path.join(dataDir, file));
        } catch {}
      }
    }
  }
};
