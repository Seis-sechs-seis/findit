'use strict';

const github = require('./providers/github');
const google = require('./providers/google');

const registry = new Map([
  ['github', github],
  ['google', google],
]);

function getProvider(id) {
  return registry.get(String(id || '').toLowerCase()) || null;
}

module.exports = { getProvider, registry };
