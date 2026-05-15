'use strict';

/**
 * True when SITE_URL looks like local HTTP dev (separate GitHub OAuth app is typical).
 */
function isLocalDevSiteUrl(siteUrl) {
  try {
    const u = new URL(String(siteUrl || '').trim());
    const h = u.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
    if (u.protocol !== 'http:') {
      return false;
    }
    return h === 'localhost' || h === '127.0.0.1' || h === '::1';
  } catch {
    return false;
  }
}

/**
 * On local dev URLs, prefer OAUTH_GITHUB_CLIENT_ID_LOCAL + _SECRET_LOCAL when both set.
 * Otherwise use OAUTH_GITHUB_CLIENT_ID + _SECRET (production or single shared app).
 * @param {string} siteUrl trimmed SITE_URL (e.g. http://localhost:3000)
 * @returns {{ clientId: string; clientSecret: string } | null}
 */
function resolveGithubOAuthApp(siteUrl) {
  const local = isLocalDevSiteUrl(siteUrl);
  if (local) {
    const idL = String(process.env.OAUTH_GITHUB_CLIENT_ID_LOCAL || '').trim();
    const secL = String(process.env.OAUTH_GITHUB_CLIENT_SECRET_LOCAL || '').trim();
    if (idL && secL) {
      return { clientId: idL, clientSecret: secL };
    }
  }
  const id = String(process.env.OAUTH_GITHUB_CLIENT_ID || '').trim();
  const sec = String(process.env.OAUTH_GITHUB_CLIENT_SECRET || '').trim();
  if (id && sec) {
    return { clientId: id, clientSecret: sec };
  }
  return null;
}

function githubOAuthConfigured(siteUrl) {
  return resolveGithubOAuthApp(siteUrl) !== null;
}

module.exports = {
  isLocalDevSiteUrl,
  resolveGithubOAuthApp,
  githubOAuthConfigured,
};
