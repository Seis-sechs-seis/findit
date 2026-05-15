'use strict';

const { postForm, getJson } = require('../http');

const AUTH = 'https://github.com/login/oauth/authorize';
const TOKEN = 'https://github.com/login/oauth/access_token';
const USER = 'https://api.github.com/user';
const EMAILS = 'https://api.github.com/user/emails';

module.exports = {
  id: 'github',

  buildAuthorizeUrl({ clientId, redirectUri, state, codeChallenge }) {
    const q = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'read:user user:email',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      allow_signup: 'true',
    });
    return `${AUTH}?${q.toString()}`;
  },

  async exchangeCode({ code, clientId, clientSecret, redirectUri, codeVerifier }) {
    const { ok, json } = await postForm(TOKEN, {
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    });
    if (!ok || !json || json.error) {
      const msg = (json && (json.error_description || json.error)) || 'GitHub token exchange failed';
      return { error: String(msg) };
    }
    const accessToken = json.access_token;
    if (!accessToken) {
      return { error: 'GitHub token response missing access_token.' };
    }
    return { accessToken };
  },

  async fetchProfile(accessToken) {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
    };
    const { ok: uOk, json: uJson } = await getJson(USER, headers);
    if (!uOk || !uJson || !uJson.id) {
      return { error: 'Failed to read GitHub profile.' };
    }
    let email = typeof uJson.email === 'string' && uJson.email.includes('@') ? uJson.email : '';
    if (!email) {
      const { ok: eOk, json: list } = await getJson(EMAILS, headers);
      if (eOk && Array.isArray(list)) {
        const primary = list.find((e) => e && e.primary && e.email);
        const any = list.find((e) => e && e.email);
        email = (primary && primary.email) || (any && any.email) || '';
      }
    }
    if (!email) {
      return { error: 'GitHub did not return an email. Make it public or grant user:email scope.' };
    }
    const login = String(uJson.login || '').trim();
    const name = String(uJson.name || '').trim();
    const firstPart = name.split(/\s+/u)[0] || login || 'GitHub';
    const restPart = name.split(/\s+/u).slice(1).join(' ') || 'User';
    const firstName = firstPart.slice(0, 100);
    const lastName = restPart.slice(0, 100);
    return {
      profile: {
        provider: 'github',
        subject: String(uJson.id),
        email: String(email).toLowerCase(),
        firstName,
        lastName,
        picture: typeof uJson.avatar_url === 'string' ? uJson.avatar_url : null,
      },
    };
  },
};
