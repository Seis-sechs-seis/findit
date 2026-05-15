'use strict';

/**
 * Grant admin role to an existing user by email.
 *
 * Usage:
 *   node scripts/make-admin.js <email>
 *   npm run make:admin -- <email>
 *
 * Reads DB_PROVIDER from your .env (mysql or supabase).
 */

require('dotenv').config();

const { normalizeEmail } = require('../src/utils/email');

const email = process.argv[2];

if (!email || !email.includes('@')) {
  console.error('Usage: node scripts/make-admin.js <email>');
  process.exit(1);
}

const normalized = normalizeEmail(email);
const provider = (process.env.DB_PROVIDER || 'mysql').toLowerCase();

async function run() {
  if (provider === 'supabase') {
    await grantSupabase(normalized);
  } else {
    await grantMysql(normalized);
  }
}

async function grantMysql(normalizedEmail) {
  const pool = require('../src/db/pool');
  const [rows] = await pool.query(
    'SELECT id, email, role FROM users WHERE normalizedEmail = ? LIMIT 1',
    [normalizedEmail]
  );
  const user = rows[0];
  if (!user) {
    console.error(`No user found with email: ${email}`);
    process.exit(1);
  }
  if (user.role === 'admin') {
    console.log(`${user.email} is already an admin.`);
    process.exit(0);
  }
  await pool.query('UPDATE users SET role = ? WHERE id = ?', ['admin', user.id]);
  console.log(`Done — ${user.email} is now an admin.`);
  process.exit(0);
}

async function grantSupabase(normalizedEmail) {
  const { getSupabaseClient } = require('../src/db/supabase');
  const supabase = getSupabaseClient();
  const { data: user, error: findErr } = await supabase
    .from('users')
    .select('id, email, role')
    .eq('normalizedEmail', normalizedEmail)
    .maybeSingle();
  if (findErr) throw findErr;
  if (!user) {
    console.error(`No user found with email: ${email}`);
    process.exit(1);
  }
  if (user.role === 'admin') {
    console.log(`${user.email} is already an admin.`);
    process.exit(0);
  }
  const { error: updateErr } = await supabase
    .from('users')
    .update({ role: 'admin' })
    .eq('id', user.id);
  if (updateErr) throw updateErr;
  console.log(`Done — ${user.email} is now an admin.`);
  process.exit(0);
}

run().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
