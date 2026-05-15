const { ContactRequestRepository } = require('../../db/models/ContactRequest');
const { ContactThreadMessageRepository } = require('../../db/models/ContactThreadMessage');
const { ContactRequestReadStateRepository } = require('../../db/models/ContactRequestReadState');

const requestRepo = new ContactRequestRepository();
const messageRepo = new ContactThreadMessageRepository();
const readRepo = new ContactRequestReadStateRepository();

/** Short-lived cache so every HTML navigation does not re-scan all threads (see setLocals). */
const UNREAD_COUNT_TTL_MS = Math.min(
  Math.max(Number(process.env.REQUESTS_UNREAD_CACHE_MS) || 15000, 3000),
  120000
);
const unreadCountCache = new Map();

function peekCachedUnread(uid) {
  const row = unreadCountCache.get(uid);
  if (!row) {
    return null;
  }
  if (Date.now() > row.expires) {
    unreadCountCache.delete(uid);
    return null;
  }
  return row.value;
}

function storeCachedUnread(uid, value) {
  unreadCountCache.set(uid, { value, expires: Date.now() + UNREAD_COUNT_TTL_MS });
}

function invalidateUnreadCountCacheForUser(userId) {
  const uid = Number(userId);
  if (Number.isFinite(uid)) {
    unreadCountCache.delete(uid);
  }
}

function requestUpdatedAtMs(r) {
  return new Date(r.updatedAt || r.createdAt).getTime();
}

function requestCreatedAtMs(r) {
  return new Date(r.createdAt).getTime();
}

async function isThreadUnreadForUser(userId, request) {
  const uid = Number(userId);
  const lastSeen = await readRepo.getLastSeenAt(request.id, uid);
  const lastSeenMs = lastSeen && !Number.isNaN(lastSeen.getTime()) ? lastSeen.getTime() : 0;

  if (request.status === 'pending' && Number(request.ownerUserId) === uid) {
    return requestCreatedAtMs(request) > lastSeenMs;
  }

  if (request.status === 'pending' && Number(request.requesterUserId) === uid) {
    return false;
  }

  const cutoff = lastSeen && !Number.isNaN(lastSeen.getTime()) ? lastSeen : new Date(0);
  if (await messageRepo.hasFromOtherAfter(request.id, uid, cutoff)) {
    return true;
  }

  if (Number(request.requesterUserId) === uid && request.status !== 'pending') {
    return requestUpdatedAtMs(request) > lastSeenMs;
  }

  if (Number(request.ownerUserId) === uid && request.status === 'cancelled') {
    return requestUpdatedAtMs(request) > lastSeenMs;
  }

  return false;
}

async function countUnreadForUser(userId) {
  const uid = Number(userId);
  if (!Number.isFinite(uid)) {
    return 0;
  }
  const cached = peekCachedUnread(uid);
  if (cached !== null) {
    return cached;
  }
  const incoming = await requestRepo.getIncomingForOwner(uid);
  const outgoing = await requestRepo.getOutgoingForRequester(uid);
  const byId = new Map();
  for (const r of incoming) {
    byId.set(r.id, r);
  }
  for (const r of outgoing) {
    byId.set(r.id, r);
  }
  let n = 0;
  for (const r of byId.values()) {
    if (await isThreadUnreadForUser(uid, r)) {
      n += 1;
    }
  }
  storeCachedUnread(uid, n);
  return n;
}

async function markThreadOpened(requestId, userId) {
  await readRepo.touch(requestId, userId);
  invalidateUnreadCountCacheForUser(userId);
}

async function markInboxListOpened(userId) {
  const uid = Number(userId);
  if (!Number.isFinite(uid)) {
    return;
  }
  const incoming = await requestRepo.getIncomingForOwner(uid);
  const outgoing = await requestRepo.getOutgoingForRequester(uid);
  const ids = new Set();
  for (const r of incoming) {
    ids.add(r.id);
  }
  for (const r of outgoing) {
    ids.add(r.id);
  }
  for (const id of ids) {
    await readRepo.touch(id, uid);
  }
  invalidateUnreadCountCacheForUser(uid);
}

module.exports = {
  countUnreadForUser,
  markThreadOpened,
  markInboxListOpened,
  invalidateUnreadCountCacheForUser,
};
