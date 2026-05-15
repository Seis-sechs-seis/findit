const fs = require('fs').promises;
const path = require('path');
const pool = require('./pool');
const { getSupabaseClient } = require('./supabase');
const { normalizeEmail } = require('../utils/email');

/**
 * Creates tables if missing. Seeds sample rows from data/items.json when the items table is empty.
 */
async function initDb() {
  const provider = (process.env.DB_PROVIDER || 'mysql').toLowerCase();
  if (provider === 'supabase') {
    // Supabase tables should be managed through SQL editor/migrations.
    await verifySupabaseTables();
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      firstName VARCHAR(100) NOT NULL,
      lastName VARCHAR(100) NOT NULL,
      email VARCHAR(255) NOT NULL,
      normalizedEmail VARCHAR(255) NOT NULL UNIQUE,
      passwordHash VARCHAR(255) NOT NULL,
      role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
      isVerified TINYINT(1) NOT NULL DEFAULT 0,
      otpHash VARCHAR(255) NULL,
      otpExpiresAt DATETIME NULL,
      otpLastSentAt DATETIME NULL,
      otpAttempts INT NOT NULL DEFAULT 0,
      resetTokenHash VARCHAR(255) NULL,
      resetTokenExpiresAt DATETIME NULL,
      resetLastSentAt DATETIME NULL,
      createdIp VARCHAR(64) NULL,
      profileImageUrl VARCHAR(500) NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS items (
      id VARCHAR(36) PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      category VARCHAR(100) NOT NULL,
      location VARCHAR(500) NOT NULL,
      date DATE NOT NULL,
      type ENUM('lost', 'found') NOT NULL,
      status ENUM('active', 'claimed') NOT NULL DEFAULT 'active',
      contactName VARCHAR(200) NOT NULL,
      contactEmail VARCHAR(255) NOT NULL,
      ownerUserId INT NULL,
      verificationPrompt VARCHAR(255) NULL,
      verificationAnswerHash VARCHAR(255) NULL,
      imagesJson TEXT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contact_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      itemId VARCHAR(36) NOT NULL,
      requesterUserId BIGINT NOT NULL,
      ownerUserId BIGINT NOT NULL,
      message TEXT NULL,
      verificationResponse TEXT NULL,
      status ENUM('pending', 'approved', 'rejected', 'cancelled', 'closed') NOT NULL DEFAULT 'pending',
      ownerDecisionNote TEXT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      resolvedAt DATETIME NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contact_request_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      requestId INT NOT NULL,
      authorUserId BIGINT NOT NULL,
      body TEXT NOT NULL,
      attachmentUrl VARCHAR(500) NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_crm_request (requestId)
    )
  `);

  await pool.query(
    'ALTER TABLE contact_request_messages ADD COLUMN IF NOT EXISTS attachmentUrl VARCHAR(500) NULL'
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contact_request_read_state (
      requestId INT NOT NULL,
      userId BIGINT NOT NULL,
      lastSeenAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (requestId, userId),
      INDEX idx_crrs_user (userId)
    )
  `);

  try {
    await pool.query(`
      ALTER TABLE contact_requests
      MODIFY COLUMN status ENUM('pending', 'approved', 'rejected', 'cancelled', 'closed')
      NOT NULL DEFAULT 'pending'
    `);
  } catch (err) {
    const msg = err && err.message ? String(err.message) : '';
    if (!/Duplicate column name|doesn't support|Unknown column/i.test(msg)) {
      console.warn('[db] contact_requests status enum:', msg || err);
    }
  }

  await pool.query(
    'ALTER TABLE contact_requests ADD COLUMN IF NOT EXISTS threadTimelineJson TEXT NULL'
  );

  // Backward-compatible upgrades for existing local databases.
  await pool.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS role ENUM('admin', 'user') NOT NULL DEFAULT 'user'"
  );
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS normalizedEmail VARCHAR(255) NULL');
  await pool.query(
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS isVerified TINYINT(1) NOT NULL DEFAULT 0'
  );
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS otpHash VARCHAR(255) NULL');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS otpExpiresAt DATETIME NULL');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS otpLastSentAt DATETIME NULL');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS otpAttempts INT NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS resetTokenHash VARCHAR(255) NULL');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS resetTokenExpiresAt DATETIME NULL');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS resetLastSentAt DATETIME NULL');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS createdIp VARCHAR(64) NULL');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS profileImageUrl VARCHAR(500) NULL');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS oauthProvider VARCHAR(32) NULL');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS oauthSubject VARCHAR(255) NULL');
  await pool.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth ON users (oauthProvider, oauthSubject)'
  );
  await pool.query('UPDATE users SET normalizedEmail = LOWER(email) WHERE normalizedEmail IS NULL');
  await pool.query(
    'UPDATE users SET isVerified = 1 WHERE isVerified = 0 AND passwordHash IS NOT NULL'
  );
  await pool.query('ALTER TABLE users MODIFY normalizedEmail VARCHAR(255) NOT NULL');
  await pool.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_normalized_email ON users (normalizedEmail)'
  );

  await backfillUserNormalizedEmails();

  await pool.query('ALTER TABLE items ADD COLUMN IF NOT EXISTS ownerUserId INT NULL');
  await pool.query(
    'ALTER TABLE items ADD COLUMN IF NOT EXISTS verificationPrompt VARCHAR(255) NULL'
  );
  await pool.query(
    'ALTER TABLE items ADD COLUMN IF NOT EXISTS verificationAnswerHash VARCHAR(255) NULL'
  );
  await pool.query('ALTER TABLE items ADD COLUMN IF NOT EXISTS imagesJson TEXT NULL');

  const [countRows] = await pool.query('SELECT COUNT(*) AS c FROM items');
  if (Number(countRows[0].c) === 0) {
    const dataPath = path.join(__dirname, '..', '..', 'data', 'items.json');
    try {
      const raw = await fs.readFile(dataPath, 'utf-8');
      const items = JSON.parse(raw);
      if (Array.isArray(items) && items.length > 0) {
        for (const item of items) {
          await pool.query(
            `INSERT INTO items (
              id, title, description, category, location, date, type, status, contactName, contactEmail, ownerUserId, verificationPrompt, verificationAnswerHash, imagesJson, createdAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              item.id,
              item.title,
              item.description,
              item.category,
              item.location,
              item.date,
              item.type,
              item.status,
              item.contactName,
              item.contactEmail,
              null,
              null,
              null,
              null,
              new Date(item.createdAt),
            ]
          );
        }
        console.log(`[db] seeded ${items.length} sample items from data/items.json`);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn('[db] sample seed skipped:', err.message);
      }
    }
  }
}

async function backfillUserNormalizedEmails() {
  try {
    const [rows] = await pool.query('SELECT id, email, normalizedEmail FROM users');
    for (const row of rows) {
      const next = normalizeEmail(row.email);
      if (!next || next === row.normalizedEmail) {
        continue;
      }
      try {
        await pool.query('UPDATE users SET normalizedEmail = ? WHERE id = ?', [next, row.id]);
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          console.warn(
            `[db] normalizedEmail backfill skipped for user ${row.id} (${row.email}) -> ${next} (would duplicate)`
          );
        } else {
          throw err;
        }
      }
    }
  } catch (err) {
    console.warn('[db] normalizedEmail backfill failed:', err.message);
  }
}

async function verifySupabaseTables() {
  const supabase = getSupabaseClient();

  const { error: usersError } = await supabase
    .from('users')
    .select('oauthProvider, profileImageUrl')
    .limit(1);
  if (usersError) {
    throw usersError;
  }

  const { error: itemsError } = await supabase
    .from('items')
    .select('id', { head: true, count: 'exact' })
    .limit(1);
  if (itemsError) {
    throw itemsError;
  }

  const { error: reqError } = await supabase
    .from('contact_requests')
    .select('id', { head: true, count: 'exact' })
    .limit(1);
  if (reqError) {
    throw reqError;
  }

  const { error: readStateError } = await supabase
    .from('contact_request_read_state')
    .select('requestId', { head: true, count: 'exact' })
    .limit(1);
  if (readStateError) {
    throw readStateError;
  }
}

module.exports = initDb;
