/**
 * Redirects to login when there is no session user. Preserves intended URL in ?next=
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  const nextUrl = encodeURIComponent(req.originalUrl || '/');
  return res.redirect(`/login?next=${nextUrl}`);
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  return res.status(403).render('404', { title: 'Access Denied' });
}

/**
 * Like requireAuth, but never redirects to HTML login for thread JSON endpoints.
 * fetch often sends Accept: star-slash-star; req.accepts('html','json') then picks html first, so a redirect
 * would return 200 HTML and break JSON.parse on the client.
 */
function requireAuthJson(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  const pathOnly = String(req.originalUrl || req.url || '').split('?')[0];
  const isThreadJsonApi =
    pathOnly.includes('/contact/') &&
    (pathOnly.endsWith('/bootstrap') || pathOnly.endsWith('/poll'));
  if (isThreadJsonApi) {
    return res.status(401).json({ ok: false, error: 'auth_required' });
  }
  if (req.accepts('json', 'html') === 'json') {
    return res.status(401).json({ ok: false, error: 'auth_required' });
  }
  const nextUrl = encodeURIComponent(req.originalUrl || '/');
  return res.redirect(`/login?next=${nextUrl}`);
}

module.exports = { requireAuth, requireAuthJson, requireAdmin };
