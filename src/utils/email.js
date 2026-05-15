const fs = require('fs');
const path = require('path');
const { getText } = require('../auth/oauth/http');

const FALLBACK_DOMAINS = [
  'mailinator.com',
  'guerrillamail.com',
  '10minutemail.com',
  'tempmail.com',
  'temp-mail.org',
  'yopmail.com',
  'getnada.com',
  'trashmail.com',
  'sharklasers.com',
  'dispostable.com',
];

const LOCAL_FILE = 'disposable_email_blocklist.conf';
const SOURCE_URL =
  'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/refs/heads/main/disposable_email_blocklist.conf';

const FETCH_TIMEOUT_MS = 20000;

let disposeSet = null;
/** @type {Promise<void>|null} */
let warmOnce = null;

function listPath() {
  const overridePath = String(process.env.DISPOSABLE_EMAIL_BLOCKLIST_PATH || '').trim();
  return overridePath
    ? path.resolve(overridePath)
    : path.join(__dirname, '..', '..', 'data', LOCAL_FILE);
}

function fbMerge() {
  return new Set(FALLBACK_DOMAINS);
}

/**
 * One domain per line; from https://github.com/disposable-email-domains/disposable-email-domains
 * @param {string} raw
 * @param {Set<string>} into
 */
function mergeLines(raw, into) {
  for (const line of raw.split(/\r?\n/)) {
    const d = line.trim().toLowerCase();
    if (!d || d.startsWith('#')) {
      continue;
    }
    if (!/^[a-z0-9][a-z0-9.-]*\.[a-z0-9.-]+$/i.test(d)) {
      continue;
    }
    into.add(d);
  }
}


function trySave(p, text) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, 'utf8');
  } catch {
    // read-only FS (e.g. serverless) — in-memory set still works
  }
}

async function pullFromNet(p) {
  const merged = fbMerge();
  try {
    const raw = await getText(SOURCE_URL, FETCH_TIMEOUT_MS);
    mergeLines(raw, merged);
    trySave(p, raw);
  } catch (err) {
    console.warn('[email] disposable blocklist fetch failed:', err.message);
  }
  disposeSet = merged;
}

/**
 * Local file first; else fetch upstream and save when writable.
 */
function warmBlocklist() {
  if (!warmOnce) {
    warmOnce = (async () => {
      const p = listPath();
      try {
        const raw = fs.readFileSync(p, 'utf8');
        const merged = fbMerge();
        mergeLines(raw, merged);
        disposeSet = merged;
        return;
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.warn('[email] disposable blocklist load failed:', err.message);
        }
      }
      await pullFromNet(p);
    })();
  }
  return warmOnce;
}

/**
 * @returns {Set<string>}
 */
function loadDisposeSet() {
  if (disposeSet) {
    return disposeSet;
  }

  const merged = fbMerge();
  try {
    const raw = fs.readFileSync(listPath(), 'utf8');
    mergeLines(raw, merged);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn('[email] disposable blocklist load failed:', err.message);
    }
  }
  disposeSet = merged;
  return disposeSet;
}

function parseEmail(rawEmail) {
  const email = String(rawEmail || '')
    .trim()
    .toLowerCase();
  const parts = email.split('@');
  if (parts.length !== 2) {
    return { raw: email, local: '', domain: '' };
  }
  return { raw: email, local: parts[0], domain: parts[1] };
}

/** Strip +tags and dots for uniqueness (all domains). */
function normLocal(local) {
  return String(local || '')
    .split('+')[0]
    .replace(/\./g, '');
}

/**
 * Stored / compared as normalizedEmail everywhere (signup, login, admin matching).
 */
function normalizeEmail(rawEmail) {
  const { raw, local, domain } = parseEmail(rawEmail);
  if (!local || !domain) {
    return raw;
  }

  const baseLocal = normLocal(local);

  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return `${baseLocal}@gmail.com`;
  }

  return `${baseLocal}@${domain}`;
}

function isDisposableEmail(rawEmail) {
  const { domain } = parseEmail(rawEmail);
  if (!domain) {
    return false;
  }
  return loadDisposeSet().has(domain);
}

module.exports = {
  normalizeEmail,
  isDisposableEmail,
  warmBlocklist,
};
