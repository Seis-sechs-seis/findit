'use strict';

const { postForm } = require('../auth/oauth/http');

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Verifies a Cloudflare Turnstile token (skips in dev if no secret key).
 *
 * @param {string|undefined} token
 * @param {string|undefined} [ip]
 */
async function verifyTurnstile(token, ip) {
  const secret = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[turnstile] CLOUDFLARE_TURNSTILE_SECRET_KEY is not set in production — blocking request.'
      );
      return { success: false, error: 'Security check is not configured.' };
    }
    // Dev/test: skip silently
    return { success: true };
  }

  if (!token || typeof token !== 'string' || !token.trim()) {
    return { success: false, error: 'Security check is required.' };
  }

  try {
    const payload = { secret, response: token.trim() };
    if (ip) {
      payload.remoteip = ip;
    }

    const { ok, json } = await postForm(VERIFY_URL, payload);

    if (!ok || !json || !json.success) {
      const codes = json && Array.isArray(json['error-codes']) ? json['error-codes'] : [];
      const isExpired = codes.includes('timeout-or-duplicate');
      return {
        success: false,
        error: isExpired
          ? 'Security check expired. Please try again.'
          : 'Security check failed. Please try again.',
      };
    }

    return { success: true };
  } catch (err) {
    console.error('[turnstile] Verification request failed:', err.message);
    return { success: false, error: 'Security check failed. Please try again.' };
  }
}

module.exports = { verifyTurnstile };
