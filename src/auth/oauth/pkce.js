'use strict';

const crypto = require('crypto');

function base64Url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/u, '');
}

function randomVerifier() {
  return base64Url(crypto.randomBytes(32));
}

function challengeFromVerifier(verifier) {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return base64Url(hash);
}

function newPkcePair() {
  const codeVerifier = randomVerifier();
  const codeChallenge = challengeFromVerifier(codeVerifier);
  return { codeVerifier, codeChallenge };
}

module.exports = { newPkcePair, base64Url };
