const { UserRepository } = require('../../db/models/User');
const { isDisposableEmail, normalizeEmail } = require('../../utils/email');
const { sendOtpEmail, sendPasswordResetEmail } = require('../../services/otp-email.service');
const { safeNextUrl, resolvePostAuthRedirect } = require('../utils/safeNextUrl');
const {
  buildLoginRiskKey,
  registerLoginFailure,
  clearLoginFailures,
  isChallengeRequiredForKey,
  createChallenge,
} = require('../../services/auth-risk.service');

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
  const hasChallenge = Boolean(
    req.session &&
    req.session.loginChallenge &&
    req.session.loginChallenge.prompt &&
    req.session.loginChallenge.answer
  );
  res.render('login', {
    title: 'Login',
    errors: [],
    oauthErrors,
    formData: { email: '', password: '' },
    nextUrl,
    requiresChallenge: hasChallenge,
    challengePrompt: hasChallenge ? req.session.loginChallenge.prompt : '',
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
    const { email, password, challengeAnswer, next: nextField } = req.body;
    const nextUrl = safeNextUrl(nextField || req.query.next);

    if (honeypotTripped(req.body)) {
      const riskKeyHp = buildLoginRiskKey(req.ip, email);
      const shouldChallengeHp = isChallengeRequiredForKey(riskKeyHp);
      if (
        shouldChallengeHp &&
        (!req.session.loginChallenge || !req.session.loginChallenge.prompt)
      ) {
        req.session.loginChallenge = createChallenge();
      }
      return res.status(400).render('login', {
        title: 'Login',
        errors: ['Invalid email or password.'],
        oauthErrors: [],
        formData: { email: email || '', password: password || '' },
        nextUrl,
        requiresChallenge: shouldChallengeHp,
        challengePrompt: shouldChallengeHp ? req.session.loginChallenge.prompt : '',
      });
    }

    const riskKey = buildLoginRiskKey(req.ip, email);
    const requiresChallenge = isChallengeRequiredForKey(riskKey);

    if (requiresChallenge) {
      const challenge = req.session.loginChallenge;
      const hasValidChallenge = Boolean(challenge && challenge.prompt && challenge.answer);
      if (!hasValidChallenge) {
        req.session.loginChallenge = createChallenge();
      }
      const expected = hasValidChallenge ? challenge.answer : req.session.loginChallenge.answer;
      if (String(challengeAnswer || '').trim() !== String(expected)) {
        return res.status(400).render('login', {
          title: 'Login',
          errors: ['Suspicious login detected. Please solve the challenge.'],
          oauthErrors: [],
          formData: { email: email || '', password: password || '' },
          nextUrl,
          requiresChallenge: true,
          challengePrompt: req.session.loginChallenge.prompt,
        });
      }
    }

    const result = await userRepo.verifyLogin(email, password);

    if (!result.success) {
      registerLoginFailure(riskKey);
      const shouldChallenge = isChallengeRequiredForKey(riskKey);
      if (shouldChallenge && (!req.session.loginChallenge || !req.session.loginChallenge.prompt)) {
        req.session.loginChallenge = createChallenge();
      }
      if (result.requiresVerification && result.email) {
        return renderVerifyEmail(req, res, {
          errors: result.errors,
          email: result.email,
          nextUrl,
        });
      }
      return res.status(400).render('login', {
        title: 'Login',
        errors: result.errors,
        oauthErrors: [],
        formData: { email: email || '', password: password || '' },
        nextUrl,
        requiresChallenge: shouldChallenge,
        challengePrompt: shouldChallenge ? req.session.loginChallenge.prompt : '',
      });
    }

    clearLoginFailures(riskKey);
    if (req.session && req.session.loginChallenge) {
      delete req.session.loginChallenge;
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
      return res.redirect(resolvePostAuthRedirect(nextUrl));
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

    if (honeypotTripped(req.body)) {
      return res.status(400).render('register', {
        title: 'Register',
        errors: ['We could not complete registration. Please try again later.'],
        oauthErrors: [],
        formData: { firstName: firstName || '', lastName: lastName || '', email: email || '' },
        nextUrl,
      });
    }

    if (isDisposableEmail(email)) {
      return res.status(400).render('register', {
        title: 'Register',
        errors: [
          'Disposable or temporary emails are not allowed. Please use a permanent email address.',
        ],
        oauthErrors: [],
        formData: { firstName: firstName || '', lastName: lastName || '', email: email || '' },
        nextUrl,
      });
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
      return res.status(400).render('register', {
        title: 'Register',
        errors: result.errors,
        oauthErrors: [],
        formData: { firstName: firstName || '', lastName: lastName || '', email: email || '' },
        nextUrl,
      });
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
      return res.redirect(resolvePostAuthRedirect(nextUrl));
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
