'use strict';

const crypto = require('crypto');

const TTL_MS = 12 * 60 * 1000;

function randomState() {
  return crypto.randomBytes(24).toString('hex');
}

function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ab.length !== bb.length) {
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * @param {import('express').Request} req
 * @param {{ provider: string; codeVerifier: string; nextPath: string }} payload
 */
function stashOAuthStart(req, payload) {
  if (!req.session) {
    return null;
  }
  const state = randomState();
  req.session.oauth = {
    state,
    provider: payload.provider,
    codeVerifier: payload.codeVerifier,
    nextPath: payload.nextPath,
    createdAt: Date.now(),
  };
  return state;
}

/**
 * @param {import('express').Request} req
 * @param {string} state
 * @returns {{ provider: string; codeVerifier: string; nextPath: string } | null}
 */
function consumeOAuthSession(req, state) {
  const s = req.session && req.session.oauth;
  if (!s || !s.state || !timingSafeEqual(s.state, state)) {
    return null;
  }
  if (!s.createdAt || Date.now() - s.createdAt > TTL_MS) {
    delete req.session.oauth;
    return null;
  }
  delete req.session.oauth;
  return {
    provider: s.provider,
    codeVerifier: s.codeVerifier,
    nextPath: s.nextPath || '/',
  };
}

function clearOAuthSession(req) {
  if (req.session) {
    delete req.session.oauth;
  }
}

module.exports = {
  stashOAuthStart,
  consumeOAuthSession,
  clearOAuthSession,
};
