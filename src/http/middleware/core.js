// logs every request ig
function requestLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const timestamp = new Date().toISOString();
    console.log(
      `[${timestamp}] ${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`
    );
  });

  next();
}

// global vars for ejs views ig
const { oauthProviderFlags } = require('../../auth/oauth/env');
const { ensureCsrfToken } = require('./csrf');

async function setLocals(req, res, next) {
  res.locals.appName = 'FindIt';
  res.locals.currentPath = req.path;
  res.locals.currentYear = new Date().getFullYear();
  res.locals.siteUrl = process.env.SITE_URL || req.protocol + '://' + req.get('host');
  res.locals.metaDescription =
    'FindIt – A centralized platform to report, search, and recover lost belongings in your community.';
  res.locals.user = req.session && req.session.user ? req.session.user : null;
  res.locals.csrfToken = req.session ? ensureCsrfToken(req) : '';
  res.locals.oauthProviders = oauthProviderFlags();
  res.locals.requestsUnreadCount = 0;
  if (res.locals.user) {
    try {
      // Thread poll/bootstrap return JSON only — skip the inbox sweep (can be many DB round-trips per user).
      const rawPath = String(req.originalUrl || req.url || '').split('?')[0];
      const skipUnreadSweep = /\/items\/[^/]+\/contact\/[^/]+\/(poll|bootstrap)$/.test(rawPath);
      if (!skipUnreadSweep) {
        const { countUnreadForUser } = require('../services/inboxUnread.service');
        res.locals.requestsUnreadCount = await countUnreadForUser(res.locals.user.id);
      }
    } catch (err) {
      console.warn('[inbox unread]', err.message || err);
    }
  }
  next();
}

// 404 handler
function notFoundHandler(req, res) {
  res.status(404).render('404', { title: 'Page Not Found' });
}

// catches errors so the app dont crash
function errorHandler(err, req, res, _) {
  const statusCode = err.status || 500;
  const isDev = req.app.get('env') === 'development';
  const msg =
    err && typeof err === 'object' && typeof err.message === 'string' && err.message.trim()
      ? err.message
      : String(err && err.code ? err.code : err || 'Error');

  console.error(`[ERROR] ${msg}`);
  if (isDev && err && typeof err === 'object' && typeof err.stack === 'string' && err.stack) {
    console.error(err.stack);
  }

  const pathOnly = String(req.originalUrl || req.url || '').split('?')[0];
  const jsonApi =
    pathOnly.includes('/contact/') &&
    (pathOnly.endsWith('/poll') || pathOnly.endsWith('/bootstrap'));
  const wantsJson =
    jsonApi ||
    String(req.get('Accept') || '').includes('application/json') ||
    String(req.get('X-Requested-With') || '') === 'XMLHttpRequest';

  if (wantsJson && !res.headersSent) {
    const clientMessage =
      statusCode >= 500
        ? 'Something went wrong. Please try again later.'
        : 'Request could not be completed.';
    return res.status(statusCode).json({
      ok: false,
      error: statusCode >= 500 ? 'server_error' : 'request_error',
      message: isDev ? msg : clientMessage,
    });
  }

  if (!res.headersSent) {
    res.status(statusCode).render('404', {
      title: 'Something Went Wrong',
      message: isDev ? err.message : 'An unexpected error occurred.',
      stack: isDev ? err.stack : null,
    });
  }
}

module.exports = { requestLogger, setLocals, notFoundHandler, errorHandler };
