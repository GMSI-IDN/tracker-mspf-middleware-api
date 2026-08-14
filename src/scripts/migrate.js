const db = require('../db');

db.waitForMigration().then(() => {
  console.log('Migrations complete');
  process.exit(0);
});
