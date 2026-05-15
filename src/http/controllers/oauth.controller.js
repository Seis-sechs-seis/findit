'use strict';

const { UserRepository } = require('../../db/models/User');
const { isDisposableEmail, normalizeEmail } = require('../../utils/email');
const { newPkcePair } = require('../../auth/oauth/pkce');
const { stashOAuthStart, consumeOAuthSession, clearOAuthSession } = require('../../auth/oauth/state');
const { getProvider } = require('../../auth/oauth/registry');
const { clientConfig, completeOAuthLogin } = require('../../auth/oauth/flow');
const { getOAuthRuntimeConfig } = require('../../auth/oauth/env');
const { safeNextUrl, resolvePostAuthRedirect } = require('../utils/safeNextUrl');

const userRepo = new UserRepository();

const ALLOWED = new Set(['google', 'github']);

function flashOAuthError(req, message) {
  if (!req.session) {
    return;
  }
  req.session.oauthFlash = { errors: [String(message || 'Sign-in failed.').slice(0, 400)] };
}

function start(req, res) {
  const providerId = String(req.params.provider || '').toLowerCase();
  if (!ALLOWED.has(providerId)) {
    return res.status(404).render('404', { title: 'Not found' });
  }
  if (req.session && req.session.user) {
    return res.redirect(resolvePostAuthRedirect(safeNextUrl(req.query.next)));
  }
  const rt = getOAuthRuntimeConfig();
  if (!rt.siteUrl) {
    flashOAuthError(req, 'Set SITE_URL (or OAUTH_SITE_URL for OAuth only) so redirect_uri matches your GitHub app.');
    return res.redirect('/login');
  }
  const cfg = clientConfig(providerId);
  const provider = getProvider(providerId);
  if (!cfg || !provider) {
    return res.status(404).render('404', { title: 'Sign-in unavailable' });
  }
  const nextPath = safeNextUrl(req.query.next);
  const { codeVerifier, codeChallenge } = newPkcePair();
  const state = stashOAuthStart(req, { provider: providerId, codeVerifier, nextPath });
  if (!state) {
    return res.status(500).send('Session is required for OAuth.');
  }
  const url = provider.buildAuthorizeUrl({
    clientId: cfg.clientId,
    redirectUri: cfg.redirectUri,
    state,
    codeChallenge,
  });
  return res.redirect(302, url);
}

function callback(req, res, next) {
  const providerId = String(req.params.provider || '').toLowerCase();
  if (!ALLOWED.has(providerId)) {
    return res.status(404).render('404', { title: 'Not found' });
  }
  if (req.session && req.session.user) {
    return res.redirect('/dashboard');
  }
  const q = req.query || {};
  if (q.error) {
    clearOAuthSession(req);
    flashOAuthError(req, q.error_description || q.error || 'Provider sign-in was cancelled.');
    return res.redirect('/login');
  }
  const code = q.code;
  const state = q.state;
  if (!code || !state) {
    clearOAuthSession(req);
    flashOAuthError(req, 'Missing authorization response. Try again.');
    return res.redirect('/login');
  }
  const bag = consumeOAuthSession(req, state);
  if (!bag || bag.provider !== providerId) {
    clearOAuthSession(req);
    flashOAuthError(req, 'Invalid or expired sign-in session. Please try again.');
    return res.redirect('/login');
  }

  completeOAuthLogin(providerId, { code: String(code), codeVerifier: bag.codeVerifier })
    .then((result) => {
      if (result.error) {
        flashOAuthError(req, result.error);
        return res.redirect('/login');
      }
      const profile = result.profile;
      const emailNorm = normalizeEmail(profile.email);
      if (!emailNorm || isDisposableEmail(profile.email)) {
        flashOAuthError(req, 'This email provider is not allowed for new accounts.');
        return res.redirect('/register');
      }
      return userRepo
        .signInWithOAuthProfile({
          email: profile.email,
          firstName: profile.firstName,
          lastName: profile.lastName,
          provider: profile.provider,
          subject: profile.subject,
          profileImageUrl: profile.picture || null,
          createdIp: req.ip || null,
        })
        .then((out) => {
          if (!out.success) {
            flashOAuthError(req, (out.errors && out.errors[0]) || 'Could not create account.');
            return res.redirect('/login');
          }
          req.session.regenerate((regErr) => {
            if (regErr) {
              return next(regErr);
            }
            req.session.user = {
              id: out.user.id,
              email: out.user.email,
              firstName: out.user.firstName,
              lastName: out.user.lastName,
              role: out.user.role || 'user',
              profileImageUrl: out.user.profileImageUrl || null,
            };
            return res.redirect(resolvePostAuthRedirect(safeNextUrl(bag.nextPath)));
          });
        });
    })
    .catch(next);
}

module.exports = { start, callback };
