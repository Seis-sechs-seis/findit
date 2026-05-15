const rateLimit = require('express-rate-limit');

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const globalLimiter = rateLimit({
  windowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  max: toInt(process.env.RATE_LIMIT_MAX, 100),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS',
  message: 'Too many requests. Please try again later.',
});

const authLimiter = rateLimit({
  windowMs: toInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  max: toInt(process.env.AUTH_RATE_LIMIT_MAX, 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many auth attempts. Please wait and try again.',
});

const registerLimiter = rateLimit({
  windowMs: toInt(process.env.REGISTER_RATE_LIMIT_WINDOW_MS, 60 * 60 * 1000),
  max: toInt(process.env.REGISTER_RATE_LIMIT_MAX, 5),
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many signup attempts. Please try again later.',
});

const otpLimiter = rateLimit({
  windowMs: toInt(process.env.OTP_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  max: toInt(process.env.OTP_RATE_LIMIT_MAX, 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many OTP requests. Please wait before trying again.',
});

const resetRequestLimiter = rateLimit({
  windowMs: toInt(process.env.RESET_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  max: toInt(process.env.RESET_RATE_LIMIT_MAX, 5),
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many password reset requests. Please wait and try again.',
});

const resetConfirmLimiter = rateLimit({
  windowMs: toInt(process.env.RESET_CONFIRM_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  max: toInt(process.env.RESET_CONFIRM_RATE_LIMIT_MAX, 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many password reset attempts. Please wait and try again.',
});

const reportLimiter = rateLimit({
  windowMs: toInt(process.env.REPORT_RATE_LIMIT_WINDOW_MS, 60 * 60 * 1000),
  max: toInt(process.env.REPORT_RATE_LIMIT_MAX, 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many report submissions. Please try again later.',
});

/** OAuth start (redirect to IdP) — prevents redirect abuse. */
const oauthStartLimiter = rateLimit({
  windowMs: toInt(process.env.OAUTH_START_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  max: toInt(process.env.OAUTH_START_RATE_LIMIT_MAX, 40),
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many sign-in attempts. Please wait and try again.',
});

/** Contact thread messages (spam / upload abuse). */
const threadMessageLimiter = rateLimit({
  windowMs: toInt(process.env.THREAD_MSG_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  max: toInt(process.env.THREAD_MSG_RATE_LIMIT_MAX, 80),
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many messages sent. Please wait and try again.',
});

/** Settings avatar uploads (storage + CPU). */
const avatarUploadLimiter = rateLimit({
  windowMs: toInt(process.env.AVATAR_UPLOAD_RATE_LIMIT_WINDOW_MS, 60 * 60 * 1000),
  max: toInt(process.env.AVATAR_UPLOAD_RATE_LIMIT_MAX, 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many avatar uploads. Please try again later.',
});

/** Live thread polling (read-heavy). */
const threadPollLimiter = rateLimit({
  windowMs: toInt(process.env.THREAD_POLL_RATE_LIMIT_WINDOW_MS, 60 * 1000),
  max: toInt(process.env.THREAD_POLL_RATE_LIMIT_MAX, 120),
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many live updates. Please slow down.',
});

/** Contact / thread state changes (approve, cancel, close, etc.) — tighter than global POST limiter. */
const contactFlowLimiter = rateLimit({
  windowMs: toInt(process.env.CONTACT_FLOW_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  max: toInt(process.env.CONTACT_FLOW_RATE_LIMIT_MAX, 80),
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many contact actions. Please wait and try again.',
});

module.exports = {
  globalLimiter,
  authLimiter,
  registerLimiter,
  otpLimiter,
  resetRequestLimiter,
  resetConfirmLimiter,
  reportLimiter,
  oauthStartLimiter,
  threadMessageLimiter,
  threadPollLimiter,
  avatarUploadLimiter,
  contactFlowLimiter,
};
