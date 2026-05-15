require('dotenv').config({ quiet: true });

const os = require('node:os');

if (!process.env.DB_PROVIDER && process.env.SUPABASE_URL) {
  process.env.DB_PROVIDER = 'supabase';
}

const { warmBlocklist } = require('./src/utils/email');
const initDb = require('./src/db/init');
const app = require('./src/app');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

/** Non-loopback IPv4s for “open on phone / another PC on Wi‑Fi” hints. */
function getLanIPv4Addresses() {
  const nets = os.networkInterfaces();
  if (!nets) {
    return [];
  }
  /** @type {{ iface: string; address: string }[]} */
  const out = [];
  for (const [iface, entries] of Object.entries(nets)) {
    if (!entries) {
      continue;
    }
    for (const net of entries) {
      const fam = net.family;
      const isV4 = fam === 'IPv4' || fam === 4;
      if (isV4 && !net.internal) {
        out.push({ iface, address: net.address });
      }
    }
  }
  return out;
}

function logStartupError(err) {
  const provider = (process.env.DB_PROVIDER || 'mysql').toLowerCase();
  const host = process.env.DB_HOST || 'localhost';
  const port = Number(process.env.DB_PORT) || 3306;
  const dbName = process.env.DB_NAME || 'findit';

  console.error('Failed to start.');
  const code = err.code || (err.errors && err.errors[0] && err.errors[0].code);

  if (provider === 'supabase' && code === 'SUPABASE_CONFIG_MISSING') {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) in .env.');
  } else if (provider === 'supabase') {
    console.error('Supabase validation failed. Check SUPABASE_URL/key and table setup.');
  } else if (code === 'ECONNREFUSED') {
    console.error(`Cannot connect to MySQL at ${host}:${port} (connection refused).`);
    console.error('- Start the MySQL service, or install/start MySQL locally.');
    console.error(
      '- On Windows, if MySQL is running but this still fails, set DB_HOST=127.0.0.1 in .env (avoids IPv6 localhost issues).'
    );
  } else if (code === 'ER_ACCESS_DENIED_ERROR') {
    console.error('MySQL rejected the login. Check DB_USER and DB_PASSWORD in .env.');
  } else if (code === 'ER_BAD_DB_ERROR') {
    console.error(`Database "${dbName}" does not exist. Create it in MySQL, then try again.`);
    console.error(
      `  Example: CREATE DATABASE ${dbName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    );
  }

  const primaryMsg = err.message && String(err.message).trim();
  if (primaryMsg) {
    console.error(primaryMsg);
  }
  if (err.sqlMessage) {
    console.error('SQL:', err.sqlMessage);
  }
  if (Array.isArray(err.errors)) {
    for (const e of err.errors) {
      if (e && e.message) {
        console.error('-', e.message);
      }
    }
  }
  if (!primaryMsg && !err.sqlMessage && code) {
    console.error('Error code:', code);
  }
}

async function start() {
  try {
    await warmBlocklist();
    await initDb();
    app.listen(PORT, HOST, () => {
      console.log(`FindIt server running at http://localhost:${PORT}`);
      const lan = getLanIPv4Addresses();
      if (lan.length === 0) {
        console.log(
          `FindIt LAN preview: no external IPv4 interface found (try Wi‑Fi/Ethernet or set HOST=0.0.0.0).`
        );
      } else {
        for (const { iface, address } of lan) {
          console.log(`FindIt LAN preview (${iface}): http://${address}:${PORT}`);
        }
      }
      if (HOST === '127.0.0.1' || HOST === 'localhost') {
        console.warn(
          '[warn] HOST is loopback only — other devices on the LAN cannot reach this server. Use HOST=0.0.0.0 in .env for LAN access.'
        );
      }
    });
  } catch (err) {
    logStartupError(err);
    process.exit(1);
  }
}

start();
