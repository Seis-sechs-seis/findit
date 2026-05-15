const crypto = require('crypto');

const TOKEN_BYTES = 32;

function ensureCsrfToken(req) {
  if (!req.session) {
    return '';
  }
  if (
    !req.session.csrfToken ||
    typeof req.session.csrfToken !== 'string' ||
    req.session.csrfToken.length < TOKEN_BYTES * 2
  ) {
    req.session.csrfToken = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  }
  return req.session.csrfToken;
}

function isMultipartRequest(req) {
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  return ct.includes('multipart/form-data');
}

function readSubmittedCsrf(req) {
  const h = req.get('x-csrf-token') || req.get('csrf-token');
  if (h) {
    const t = String(h).trim();
    if (t.length <= 256 && /^[a-f0-9]+$/i.test(t)) {
      return t;
    }
    return '';
  }
  if (req.body && typeof req.body === 'object' && req.body._csrf != null) {
    const b = String(req.body._csrf).trim();
    if (b.length <= 256 && /^[a-f0-9]+$/i.test(b)) {
      return b;
    }
  }
  return '';
}

function timingSafeEq(a, b) {
  if (!a || !b || typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) {
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

function sendCsrfFailure(req, res) {
  const accept = String(req.get('Accept') || '');
  const xhr = String(req.get('X-Requested-With') || '') === 'XMLHttpRequest';
  if (xhr || accept.includes('application/json')) {
    return res.status(403).json({
      ok: false,
      error: 'csrf_invalid',
      message: 'Security check failed. Refresh the page and try again.',
    });
  }
  return res.status(403).render('404', {
    title: 'Security check failed',
    message: 'Refresh the page and try again.',
  });
}

/**
 * Verify CSRF token (session-bound). Use after body parsers; for multipart, run after multer.
 */
function requireCsrfToken(req, res, next) {
  if (!req.session) {
    return res.status(403).send('Session required');
  }
  ensureCsrfToken(req);
  const submitted = readSubmittedCsrf(req);
  const expected = req.session.csrfToken;
  if (!timingSafeEq(submitted, expected)) {
    return sendCsrfFailure(req, res);
  }
  return next();
}

/**
 * For non-multipart mutating requests (JSON + urlencoded). Multipart routes add requireCsrfToken after multer.
 */
function globalCsrfGuard(req, res, next) {
  const m = req.method;
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') {
    return next();
  }
  if (isMultipartRequest(req)) {
    return next();
  }
  return requireCsrfToken(req, res, next);
}

module.exports = {
  ensureCsrfToken,
  requireCsrfToken,
  globalCsrfGuard,
};
