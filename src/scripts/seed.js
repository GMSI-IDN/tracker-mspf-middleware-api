const db = require('../db');

db.waitForMigration()
  .then(() => db.seed.run())
  .then(() => {
    console.log('Seeds complete');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Seed failed:', err.message);
    process.exit(1);
  });
