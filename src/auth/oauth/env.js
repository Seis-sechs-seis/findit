'use strict';

const { githubOAuthConfigured } = require('./githubCreds');

function trimBaseUrl(url) {
  return String(url || '')
    .trim()
    .replace(/\/+$/u, '');
}

/**
 * Origin used for OAuth redirect_uri (must match GitHub/Google callback registration).
 * Defaults to SITE_URL. Set OAUTH_SITE_URL when the browser origin differs (e.g. LAN IP vs localhost).
 */
function getOAuthSiteUrl() {
  return trimBaseUrl(process.env.OAUTH_SITE_URL || process.env.SITE_URL || '');
}

/**
 * OAuth env snapshot (no secrets leaked to views — only flags + redirect path pattern).
 */
function getOAuthRuntimeConfig() {
  const siteUrl = getOAuthSiteUrl();
  const google =
    Boolean(process.env.OAUTH_GOOGLE_CLIENT_ID) && Boolean(process.env.OAUTH_GOOGLE_CLIENT_SECRET);
  const github = githubOAuthConfigured(siteUrl);
  return {
    siteUrl,
    redirectBase: siteUrl ? `${siteUrl}/auth/oauth` : '',
    providers: {
      google,
      github,
    },
    anyEnabled: google || github,
  };
}

/** Flags for EJS (no secrets). */
function oauthProviderFlags() {
  const c = getOAuthRuntimeConfig();
  return {
    google: c.providers.google,
    github: c.providers.github,
    any: c.anyEnabled,
  };
}

module.exports = {
  getOAuthSiteUrl,
  getOAuthRuntimeConfig,
  oauthProviderFlags,
};
