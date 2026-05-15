'use strict';

/** Only allow same-origin relative paths for ?next= */
function safeNextUrl(next) {
  if (!next || typeof next !== 'string') {
    return '/';
  }
  if (!next.startsWith('/') || next.startsWith('//')) {
    return '/';
  }
  return next;
}

function resolvePostAuthRedirect(nextUrl) {
  if (nextUrl && nextUrl !== '/') {
    return nextUrl;
  }
  return '/dashboard';
}

module.exports = { safeNextUrl, resolvePostAuthRedirect };
