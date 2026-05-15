'use strict';

const { postForm, getJson } = require('../http');

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';

module.exports = {
  id: 'google',

  buildAuthorizeUrl({ clientId, redirectUri, state, codeChallenge }) {
    const q = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      access_type: 'online',
      include_granted_scopes: 'true',
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
      const msg =
        (json && (json.error_description || json.error)) || 'Google token exchange failed';
      return { error: String(msg) };
    }
    const accessToken = json.access_token;
    if (!accessToken) {
      return { error: 'Google token response missing access_token.' };
    }
    return { accessToken };
  },

  async fetchProfile(accessToken) {
    const { ok: uOk, json: uJson } = await getJson(USERINFO, {
      Authorization: `Bearer ${accessToken}`,
    });
    if (!uOk || !uJson || !uJson.sub) {
      return { error: 'Failed to read Google profile.' };
    }
    const email = String(uJson.email || '').toLowerCase();
    if (!email) {
      return { error: 'Google did not return an email for this account.' };
    }
    const given = String(uJson.given_name || '').trim();
    const family = String(uJson.family_name || '').trim();
    const name = String(uJson.name || '').trim();
    const firstName = (given || name.split(/\s+/u)[0] || 'Google').slice(0, 100);
    const lastName = (family || name.split(/\s+/u).slice(1).join(' ') || 'User').slice(0, 100);
    return {
      profile: {
        provider: 'google',
        subject: String(uJson.sub),
        email,
        firstName: firstName.slice(0, 100),
        lastName: lastName.slice(0, 100),
        picture: typeof uJson.picture === 'string' ? uJson.picture : null,
      },
    };
  },
};
