const { UserRepository } = require('../../db/models/User');
const { isDisposableEmail, normalizeEmail } = require('../../utils/email');
const { sendOtpEmail, sendPasswordResetEmail } = require('../../services/otp-email.service');
const { safeNextUrl, resolvePostAuthRedirect } = require('../utils/safeNextUrl');
const {
  buildLoginRiskKey,
  registerLoginFailure,
  clearLoginFailures,
  isChallengeRequiredForKey,
} = require('../../services/auth-risk.service');
const { verifyTurnstile } = require('../../services/turnstile.service');

const userRepo = new UserRepository();

/** Bot trap field `_hp_mi` from login/register forms — must stay empty. */
function honeypotTripped(body) {
  if (!body || typeof body !== 'object') {
    return false;
  }
  const raw = body._hp_mi;
  if (raw === undefined || raw === null) {
    return false;
  }
  return String(raw).trim() !== '';
}

function showLogin(req, res) {
  const nextUrl = safeNextUrl(req.query.next);
  const oauthErrors = [];
  if (req.session && req.session.oauthFlash && Array.isArray(req.session.oauthFlash.errors)) {
    oauthErrors.push(...req.session.oauthFlash.errors);
    delete req.session.oauthFlash;
  }
  const requiresTurnstile = Boolean(req.session && req.session.requiresTurnstile);
  res.render('login', {
    title: 'Login',
    errors: [],
    oauthErrors,
    formData: { email: '', password: '' },
    nextUrl,
    requiresTurnstile,
    turnstileSiteKey: requiresTurnstile ? process.env.CLOUDFLARE_TURNSTILE_SITE_KEY || '' : '',
  });
}

function renderVerifyEmail(req, res, options = {}) {
  const pendingEmail =
    normalizeEmail(options.email || '') ||
    normalizeEmail(req.session && req.session.verifyEmailPending) ||
    '';
  if (req.session) {
    req.session.verifyEmailPending = pendingEmail || undefined;
  }
  res.render('verify-email', {
    title: 'Verify Email',
    errors: options.errors || [],
    success: options.success || '',
    formData: {
      email: pendingEmail,
      otpCode: options.otpCode || '',
    },
    nextUrl: safeNextUrl(options.nextUrl),
  });
}

function renderForgotPassword(res, options = {}) {
  res.render('forgot-password', {
    title: 'Forgot Password',
    errors: options.errors || [],
    success: options.success || '',
    formData: {
      email: options.email || '',
    },
  });
}

function renderResetPassword(res, options = {}) {
  res.render('reset-password', {
    title: 'Reset Password',
    errors: options.errors || [],
    success: options.success || '',
    token: options.token || '',
  });
}

async function postLogin(req, res, next) {
  try {
    const { email, password, 'cf-turnstile-response': turnstileToken, next: nextField } = req.body;
    const nextUrl = safeNextUrl(nextField || req.query.next);

    const sessionRequiresTurnstile = Boolean(req.session && req.session.requiresTurnstile);

    const renderLogin = (errors, requiresTurnstile = sessionRequiresTurnstile) => {
      if (requiresTurnstile && req.session) {
        req.session.requiresTurnstile = true;
      }
      return res.status(400).render('login', {
        title: 'Login',
        errors,
        oauthErrors: [],
        formData: { email: email || '', password: password || '' },
        nextUrl,
        requiresTurnstile,
        turnstileSiteKey: requiresTurnstile ? process.env.CLOUDFLARE_TURNSTILE_SITE_KEY || '' : '',
      });
    };

    if (honeypotTripped(req.body)) {
      return renderLogin(['Invalid email or password.']);
    }

    // Only verify Turnstile when the challenge is active for this session
    if (sessionRequiresTurnstile) {
      const tsResult = await verifyTurnstile(turnstileToken, req.ip);
      if (!tsResult.success) {
        return renderLogin([tsResult.error || 'Security check failed. Please try again.'], true);
      }
    }

    const riskKey = buildLoginRiskKey(req.ip, email);
    const result = await userRepo.verifyLogin(email, password);

    if (!result.success) {
      registerLoginFailure(riskKey);
      const shouldChallenge = isChallengeRequiredForKey(riskKey);
      if (result.requiresVerification && result.email) {
        return renderVerifyEmail(req, res, {
          errors: result.errors,
          email: result.email,
          nextUrl,
        });
      }
      return renderLogin(result.errors, shouldChallenge || sessionRequiresTurnstile);
    }

    clearLoginFailures(riskKey);
    if (req.session && req.session.requiresTurnstile) {
      delete req.session.requiresTurnstile;
    }

    const userPayload = {
      id: result.user.id,
      email: result.user.email,
      firstName: result.user.firstName,
      lastName: result.user.lastName,
      role: result.user.role || 'user',
      profileImageUrl: result.user.profileImageUrl || null,
    };

    req.session.regenerate((regErr) => {
      if (regErr) {
        return next(regErr);
      }
      req.session.user = userPayload;
      req.session.save((saveErr) => {
        if (saveErr) {
          return next(saveErr);
        }
        return res.redirect(resolvePostAuthRedirect(nextUrl));
      });
    });
  } catch (err) {
    next(err);
  }
}

function showRegister(req, res) {
  const oauthErrors = [];
  if (req.session && req.session.oauthFlash && Array.isArray(req.session.oauthFlash.errors)) {
    oauthErrors.push(...req.session.oauthFlash.errors);
    delete req.session.oauthFlash;
  }
  res.render('register', {
    title: 'Register',
    errors: [],
    oauthErrors,
    formData: { firstName: '', lastName: '', email: '' },
    nextUrl: safeNextUrl(req.query.next),
  });
}

async function postRegister(req, res, next) {
  try {
    const { firstName, lastName, email, password, confirmPassword, next: nextField } = req.body;
    const nextUrl = safeNextUrl(nextField || req.query.next);

    const renderRegister = (errors, status = 400) =>
      res.status(status).render('register', {
        title: 'Register',
        errors,
        oauthErrors: [],
        formData: { firstName: firstName || '', lastName: lastName || '', email: email || '' },
        nextUrl,
      });

    if (honeypotTripped(req.body)) {
      return renderRegister(['We could not complete registration. Please try again later.']);
    }

    if (isDisposableEmail(email)) {
      return renderRegister([
        'Disposable or temporary emails are not allowed. Please use a permanent email address.',
      ]);
    }

    const result = await userRepo.create({
      firstName,
      lastName,
      email,
      password,
      confirmPassword,
      createdIp: req.ip || req.headers['x-forwarded-for'] || null,
    });

    if (!result.success) {
      return renderRegister(result.errors);
    }

    await sendOtpEmail({
      toEmail: result.user.email,
      otpCode: result.otpCode,
    });

    return renderVerifyEmail(req, res, {
      success: `We sent a verification code to ${result.user.email}.`,
      email: result.user.email,
      nextUrl,
    });
  } catch (err) {
    next(err);
  }
}

function showVerifyEmail(req, res) {
  renderVerifyEmail(req, res, {
    nextUrl: req.query.next,
  });
}

async function handleResendOtp(req, res, nextUrl) {
  const normalized = normalizeEmail(req.session && req.session.verifyEmailPending) || '';
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return renderVerifyEmail(req, res, {
      errors: ['Missing email context. Please log in again and request a new OTP.'],
      nextUrl,
    });
  }

  const result = await userRepo.resendEmailOtp({ email: normalized });
  if (!result.success) {
    return renderVerifyEmail(req, res, {
      errors: result.errors,
      email: normalized,
      nextUrl,
    });
  }

  await sendOtpEmail({
    toEmail: result.user.email,
    otpCode: result.otpCode,
  });

  return renderVerifyEmail(req, res, {
    success: `A new verification code was sent to ${result.user.email}.`,
    email: result.user.email,
    nextUrl,
  });
}

async function postVerifyEmail(req, res, next) {
  try {
    const { otpCode, next: nextField, action } = req.body;
    const nextUrl = safeNextUrl(nextField || req.query.next);
    if (String(action || '').toLowerCase() === 'resend') {
      return handleResendOtp(req, res, nextUrl);
    }
    const candidateEmail = normalizeEmail(req.session && req.session.verifyEmailPending) || '';
    if (!candidateEmail) {
      return renderVerifyEmail(req, res, {
        errors: ['Missing email context. Please log in again and request a new OTP.'],
        nextUrl,
      });
    }
    const result = await userRepo.verifyEmailOtp({
      email: candidateEmail,
      otpCode,
    });

    if (!result.success) {
      return renderVerifyEmail(req, res, {
        errors: result.errors,
        email: candidateEmail,
        otpCode,
        nextUrl,
      });
    }

    const userPayload = {
      id: result.user.id,
      email: result.user.email,
      firstName: result.user.firstName,
      lastName: result.user.lastName,
      role: result.user.role || 'user',
      profileImageUrl: result.user.profileImageUrl || null,
    };

    req.session.regenerate((regErr) => {
      if (regErr) {
        return next(regErr);
      }
      req.session.user = userPayload;
      if (req.session && req.session.verifyEmailPending) {
        delete req.session.verifyEmailPending;
      }
      req.session.save((saveErr) => {
        if (saveErr) {
          return next(saveErr);
        }
        return res.redirect(resolvePostAuthRedirect(nextUrl));
      });
    });
  } catch (err) {
    next(err);
  }
}

async function postResendOtp(req, res, next) {
  try {
    const { next: nextField } = req.body;
    const nextUrl = safeNextUrl(nextField || req.query.next);
    return handleResendOtp(req, res, nextUrl);
  } catch (err) {
    next(err);
  }
}

function showForgotPassword(req, res) {
  renderForgotPassword(res, {});
}

async function postForgotPassword(req, res, next) {
  try {
    const email = String(req.body.email || '').trim();
    const result = await userRepo.requestPasswordReset({ email });
    if (result.shouldSend) {
      const resetUrl = `${req.protocol}://${req.get('host')}/reset-password/${result.token}`;
      await sendPasswordResetEmail({
        toEmail: result.user.email,
        resetUrl,
      });
    }
    return renderForgotPassword(res, {
      success: 'If the email exists, we sent a password reset link.',
      email: '',
    });
  } catch (err) {
    next(err);
  }
}

function showResetPassword(req, res) {
  renderResetPassword(res, { token: req.params.token });
}

async function postResetPassword(req, res, next) {
  try {
    const token = req.params.token;
    const { password, confirmPassword } = req.body;
    const result = await userRepo.resetPasswordByToken({
      token,
      password,
      confirmPassword,
    });
    if (!result.success) {
      return res.status(400).render('reset-password', {
        title: 'Reset Password',
        errors: result.errors,
        success: '',
        token,
      });
    }
    return renderResetPassword(res, {
      token: '',
      success: 'Password updated successfully. You can now log in.',
    });
  } catch (err) {
    next(err);
  }
}

function postLogout(req, res, next) {
  req.session.destroy((err) => {
    if (err) {
      return next(err);
    }
    res.redirect('/');
  });
}

module.exports = {
  showLogin,
  postLogin,
  showRegister,
  postRegister,
  showVerifyEmail,
  postVerifyEmail,
  postResendOtp,
  showForgotPassword,
  postForgotPassword,
  showResetPassword,
  postResetPassword,
  postLogout,
};
