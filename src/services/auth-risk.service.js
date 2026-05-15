const { normalizeEmail } = require('../utils/email');

const LOGIN_FAIL_WINDOW_MS = Number(process.env.LOGIN_FAIL_WINDOW_MS || 15 * 60 * 1000);
const LOGIN_FAIL_CHALLENGE_THRESHOLD = Number(process.env.LOGIN_FAIL_CHALLENGE_THRESHOLD || 5);
const MAX_TRACKED_KEYS = Number(process.env.LOGIN_FAIL_MAX_TRACKED_KEYS || 5000);

const attemptStore = new Map();

function pruneOld(nowMs) {
  for (const [key, value] of attemptStore.entries()) {
    if (!value || !Array.isArray(value.timestamps)) {
      attemptStore.delete(key);
      continue;
    }
    value.timestamps = value.timestamps.filter((ts) => nowMs - ts <= LOGIN_FAIL_WINDOW_MS);
    if (value.timestamps.length === 0) {
      attemptStore.delete(key);
    } else {
      attemptStore.set(key, value);
    }
  }
}

function enforceStoreLimit() {
  if (attemptStore.size <= MAX_TRACKED_KEYS) {
    return;
  }
  const entries = Array.from(attemptStore.entries()).sort(
    (a, b) => (a[1]?.lastSeenMs || 0) - (b[1]?.lastSeenMs || 0)
  );
  const removeCount = attemptStore.size - MAX_TRACKED_KEYS;
  for (let i = 0; i < removeCount; i += 1) {
    attemptStore.delete(entries[i][0]);
  }
}

function buildLoginRiskKey(ip, email) {
  return `${String(ip || '').trim()}|${normalizeEmail(email)}`;
}

function registerLoginFailure(key) {
  const nowMs = Date.now();
  pruneOld(nowMs);
  const existing = attemptStore.get(key) || { timestamps: [], lastSeenMs: nowMs };
  existing.timestamps.push(nowMs);
  existing.lastSeenMs = nowMs;
  attemptStore.set(key, existing);
  enforceStoreLimit();
  return existing.timestamps.length;
}

function clearLoginFailures(key) {
  attemptStore.delete(key);
}

function isChallengeRequiredForKey(key) {
  const nowMs = Date.now();
  pruneOld(nowMs);
  const entry = attemptStore.get(key);
  if (!entry) {
    return false;
  }
  return entry.timestamps.length >= LOGIN_FAIL_CHALLENGE_THRESHOLD;
}

function createChallenge() {
  const a = Math.floor(Math.random() * 8) + 2;
  const b = Math.floor(Math.random() * 8) + 2;
  return {
    prompt: `What is ${a} + ${b}?`,
    answer: String(a + b),
  };
}

module.exports = {
  buildLoginRiskKey,
  registerLoginFailure,
  clearLoginFailures,
  isChallengeRequiredForKey,
  createChallenge,
};
