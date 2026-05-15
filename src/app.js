const compression = require('compression');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const helmet = require('helmet');
const path = require('path');
const session = require('express-session');

function buildSessionStore() {
  const provider = (process.env.DB_PROVIDER || 'mysql').toLowerCase();
  if (provider === 'supabase') {
    const SupabaseSessionStore = require('./db/session');
    return new SupabaseSessionStore();
  }
  // MySQL
  const MySQLStore = require('express-mysql-session')(session);
  return new MySQLStore({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'findit',
    createDatabaseTable: true,
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,
    expiration: 7 * 24 * 60 * 60 * 1000,
    connectionLimit: 5,
  });
}

const { requestLogger, setLocals, notFoundHandler, errorHandler } = require('./http/middleware');
const { globalCsrfGuard } = require('./http/middleware/csrf');
const { sameOriginGuard } = require('./http/middleware/safeOrigin');
const { globalLimiter } = require('./http/middleware/security');
const authRoutes = require('./http/routes/auth.route');
const oauthRoutes = require('./http/routes/oauth.route');
const pageRoutes = require('./http/routes/page.route');
const itemRoutes = require('./http/routes/item.route');

const app = express();
app.set('trust proxy', Number(process.env.TRUST_PROXY || 1));
const isProd = process.env.NODE_ENV === 'production';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    permittedCrossDomainPolicies: false,
    hsts: isProd
      ? {
          maxAge: 15552000,
          includeSubDomains: true,
          preload: false,
        }
      : false,
  })
);
app.use(
  compression({
    threshold: 1024,
    filter: (req, res) => {
      if (req.headers['x-no-compression']) {
        return false;
      }
      return compression.filter(req, res);
    },
  })
);
app.use(globalLimiter);
app.use(express.urlencoded({ extended: true, limit: process.env.BODY_LIMIT || '100kb' }));
app.use(express.json({ limit: process.env.BODY_LIMIT || '100kb' }));
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    maxAge: isProd ? '7d' : 0,
    etag: true,
    lastModified: true,
    immutable: false,
    setHeaders: (res, filePath) => {
      const lower = filePath.replace(/\\/g, '/').toLowerCase();
      if (!isProd && (lower.endsWith('.css') || lower.endsWith('.js'))) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        return;
      }
      if (!isProd) {
        return;
      }
      if (lower.endsWith('.css') || lower.endsWith('.js') || lower.endsWith('.svg')) {
        res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=2592000');
      } else if (lower.includes('/images/')) {
        res.setHeader('Cache-Control', 'public, max-age=2592000, stale-while-revalidate=86400');
      } else if (lower.includes('/uploads/')) {
        res.setHeader('Cache-Control', 'private, max-age=900, stale-while-revalidate=3600');
      }
    },
  })
);

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret && isProd) {
  console.warn('[warn] SESSION_SECRET is not set; set it in production.');
}

const sessionStore = (() => {
  try {
    return buildSessionStore();
  } catch (err) {
    console.warn(
      '[warn] Could not initialise session store, falling back to MemoryStore:',
      err.message
    );
    return undefined;
  }
})();

// secure:true whenever the request arrives over HTTPS — covers Vercel (always HTTPS)
// and any reverse-proxy that forwards the original protocol in X-Forwarded-Proto.
const secureCookie = isProd || process.env.COOKIE_SECURE === '1';

app.use(
  session({
    name: 'findit.sid',
    secret: sessionSecret || 'dev-only-change-me',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookie,
    },
  })
);

app.use(requestLogger);
app.use(setLocals);
app.use(globalCsrfGuard);
app.use(sameOriginGuard);

app.use('/', authRoutes);
app.use('/auth/oauth', oauthRoutes);
app.use('/', pageRoutes);
app.use('/items', itemRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
