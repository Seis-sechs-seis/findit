'use strict';

const { request } = require('undici');

const DEFAULT_HEADERS = {
  'User-Agent': 'FindIt/1.0 (OAuth)',
  Accept: 'application/json',
};

/**
 * Parse body text as JSON, returning null on failure.
 * @param {string} text
 */
function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * POST application/x-www-form-urlencoded and return a normalised response.
 * @param {string} url
 * @param {Record<string, string>} bodyObj
 * @returns {Promise<{ ok: boolean, status: number, json: unknown, text: string }>}
 */
async function postForm(url, bodyObj) {
  const body = new URLSearchParams(bodyObj).toString();
  const { statusCode, body: stream } = await request(url, {
    method: 'POST',
    headers: {
      ...DEFAULT_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body,
  });
  const text = await stream.text();
  return {
    ok: statusCode >= 200 && statusCode < 300,
    status: statusCode,
    json: tryJson(text),
    text,
  };
}

/**
 * GET a JSON endpoint with arbitrary headers (e.g. Authorization bearer).
 * @param {string} url
 * @param {Record<string, string>} [headers]
 * @returns {Promise<{ ok: boolean, status: number, json: unknown }>}
 */
async function getJson(url, headers = {}) {
  const { statusCode, body: stream } = await request(url, {
    method: 'GET',
    headers: { ...DEFAULT_HEADERS, ...headers },
  });
  const text = await stream.text();
  return { ok: statusCode >= 200 && statusCode < 300, status: statusCode, json: tryJson(text) };
}

/**
 * GET raw text with a timeout (ms).
 * @param {string} url
 * @param {number} [timeoutMs]
 * @returns {Promise<string>}
 */
async function getText(url, timeoutMs = 20_000) {
  const { statusCode, body: stream } = await request(url, {
    method: 'GET',
    headers: { 'User-Agent': DEFAULT_HEADERS['User-Agent'] },
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  });
  if (statusCode !== 200) {
    throw new Error(`HTTP ${statusCode}`);
  }
  return stream.text();
}

module.exports = { postForm, getJson, getText };
