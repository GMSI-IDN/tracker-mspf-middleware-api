const bcrypt = require('bcryptjs');

exports.seed = async function (knex) {
  const exists = await knex('users').where({ role: 'admin' }).first();
  if (exists) return;

  await knex('users').insert({
    username: 'admin',
    password_hash: bcrypt.hashSync('admin123', 10),
    role: 'admin',
    groups: '[]',
  });
};
