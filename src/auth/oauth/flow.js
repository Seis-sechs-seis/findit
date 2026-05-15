'use strict';

const { getOAuthRuntimeConfig } = require('./env');
const { resolveGithubOAuthApp } = require('./githubCreds');
const { getProvider } = require('./registry');

function clientConfig(providerId) {
  const rt = getOAuthRuntimeConfig();
  if (!rt.redirectBase) {
    return null;
  }
  if (providerId === 'google' && rt.providers.google) {
    return {
      clientId: process.env.OAUTH_GOOGLE_CLIENT_ID,
      clientSecret: process.env.OAUTH_GOOGLE_CLIENT_SECRET,
      redirectUri: `${rt.redirectBase}/${providerId}/callback`,
    };
  }
  if (providerId === 'github' && rt.providers.github) {
    const gh = resolveGithubOAuthApp(rt.siteUrl);
    if (!gh) {
      return null;
    }
    return {
      clientId: gh.clientId,
      clientSecret: gh.clientSecret,
      redirectUri: `${rt.redirectBase}/${providerId}/callback`,
    };
  }
  return null;
}

/**
 * Exchange authorization code and resolve normalized profile for DB.
 * @param {string} providerId
 * @param {{ code: string; codeVerifier: string }} args
 */
async function completeOAuthLogin(providerId, args) {
  const provider = getProvider(providerId);
  const cfg = clientConfig(providerId);
  if (!provider || !cfg) {
    return { error: 'This sign-in provider is not configured.' };
  }

  const ex = await provider.exchangeCode({
    code: args.code,
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    redirectUri: cfg.redirectUri,
    codeVerifier: args.codeVerifier,
  });
  if (ex.error) {
    return { error: ex.error };
  }

  const pr = await provider.fetchProfile(ex.accessToken);
  return pr.error ? { error: pr.error } : { profile: pr.profile };
}

module.exports = {
  clientConfig,
  completeOAuthLogin,
};
