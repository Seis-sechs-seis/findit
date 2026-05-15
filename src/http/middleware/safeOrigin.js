/**
 * Optional same-site-ish guard for mutating requests (defense in depth with CSRF).
 * Enable with ENFORCE_SAME_ORIGIN=1 in production behind a correct Host / proxy setup.
 */

function normalizeHost(host) {
  return String(host || '')
    .split(':')[0]
    .trim()
    .toLowerCase();
}

function hostFromUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return normalizeHost(u.hostname);
  } catch {
    return '';
  }
}

function sameOriginGuard(req, res, next) {
  if (process.env.ENFORCE_SAME_ORIGIN !== '1') {
    return next();
  }
  const m = req.method;
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') {
    return next();
  }

  const expected = normalizeHost(req.get('host'));
  if (!expected) {
    return next();
  }

  const origin = req.get('origin');
  if (origin && hostFromUrl(origin) !== expected) {
    return res.status(403).json({ ok: false, error: 'bad_origin', message: 'Invalid origin.' });
  }

  const referer = req.get('referer');
  if (referer && hostFromUrl(referer) !== expected) {
    return res.status(403).json({ ok: false, error: 'bad_origin', message: 'Invalid referer.' });
  }

  return next();
}

module.exports = { sameOriginGuard };
