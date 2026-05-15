const nodemailer = require('nodemailer');

function escapeHtmlAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Public site origin for email assets (logo). */
function originFromSiteUrl() {
  const raw = String(process.env.SITE_URL || '').trim();
  if (!raw) {
    return '';
  }
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return u.origin;
  } catch {
    return '';
  }
}

function originFromResetUrl(resetUrl) {
  if (!resetUrl) {
    return '';
  }
  try {
    return new URL(resetUrl).origin;
  } catch {
    return '';
  }
}

function logoUrlForOrigin(origin) {
  if (!origin) {
    return '';
  }
  return `${origin.replace(/\/+$/, '')}/images/app-icon.png`;
}

/**
 * Minimal, table-safe layout — works in common mail clients.
 * @param {{ appName: string; logoSrc: string; innerHtml: string }} opts
 */
function transactionalShell({ appName, logoSrc, innerHtml }) {
  const brand = escapeHtmlAttr(appName);
  const logoBlock = logoSrc
    ? `<img src="${escapeHtmlAttr(logoSrc)}" alt="${brand}" width="52" height="52" style="display:block;margin:0 auto 22px;border-radius:14px;box-shadow:0 4px 16px rgba(108,92,231,0.2);" />`
    : `<p style="margin:0 0 20px;font-size:22px;font-weight:800;color:#6c5ce7;letter-spacing:-0.03em;text-align:center;">${brand}</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef0f6;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef0f6;">
<tr><td align="center" style="padding:44px 16px;">
<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;max-width:480px;background:#ffffff;border-radius:22px;border:1px solid rgba(15,23,42,0.06);box-shadow:0 16px 48px rgba(15,23,42,0.1);">
<tr><td style="height:3px;background:#6c5ce7;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:38px 32px 34px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
${logoBlock}
${innerHtml}
<p style="margin:28px 0 0;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#94a3b8;text-align:center;">${brand}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildOtpHtml(otpCode, appName) {
  const origin = originFromSiteUrl();
  const logoSrc = logoUrlForOrigin(origin);
  const code = escapeHtmlAttr(otpCode);
  const inner = `
<h1 style="margin:0 0 10px;font-size:20px;font-weight:700;color:#0f172a;text-align:center;letter-spacing:-0.02em;">Verification code</h1>
<p style="margin:0 0 22px;font-size:15px;line-height:1.5;color:#64748b;text-align:center;">Finish signing up — enter the code below.</p>
<div style="margin:0 auto 14px;padding:20px 16px;background:#f8f7ff;border:1px solid #ebe7ff;border-radius:16px;text-align:center;">
<span style="font-family:ui-monospace,'Cascadia Mono','Segoe UI Mono',Menlo,Consolas,monospace;font-size:28px;font-weight:700;letter-spacing:0.42em;color:#5b4bc4;">${code}</span>
</div>
<p style="margin:0;font-size:13px;color:#94a3b8;text-align:center;">Expires in 10 minutes.</p>`;
  return transactionalShell({ appName, logoSrc, innerHtml: inner });
}

function buildPasswordResetHtml(resetUrl, appName) {
  const origin = originFromResetUrl(resetUrl) || originFromSiteUrl();
  const logoSrc = logoUrlForOrigin(origin);
  const href = escapeHtmlAttr(resetUrl);
  const inner = `
<h1 style="margin:0 0 10px;font-size:20px;font-weight:700;color:#0f172a;text-align:center;letter-spacing:-0.02em;">Reset your password</h1>
<p style="margin:0 0 26px;font-size:15px;line-height:1.5;color:#64748b;text-align:center;">Use the button below to set a new password.</p>
<div style="text-align:center;margin:0 0 18px;">
<a href="${href}" style="display:inline-block;background:#6c5ce7;color:#ffffff !important;text-decoration:none;font-weight:600;font-size:15px;padding:14px 36px;border-radius:12px;box-shadow:0 8px 24px rgba(108,92,231,0.32);">Reset password</a>
</div>
<p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;line-height:1.5;">Link expires soon · ignore if you didn’t request this.</p>`;
  return transactionalShell({ appName, logoSrc, innerHtml: inner });
}

async function sendViaSmtp({ toEmail, fromEmail, subject, html }) {
  const smtpHost = String(process.env.SMTP_HOST || '').trim();
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpUser = String(process.env.SMTP_USER || '').trim();
  const smtpPass = String(process.env.SMTP_PASS || '').trim();
  const smtpSecure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';

  if (!smtpHost || !smtpUser || !smtpPass) {
    throw new Error('Missing SMTP_HOST/SMTP_USER/SMTP_PASS for smtp provider.');
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  await transporter.sendMail({
    from: fromEmail || smtpUser,
    to: toEmail,
    subject,
    html,
  });
}

/** Only set when OTP_EMAIL_MODE=log (for local scripts/tests; do not use in production). */
let lastLoggedOtp = null;

function otpEmailMode() {
  return String(process.env.OTP_EMAIL_MODE || 'smtp')
    .toLowerCase()
    .trim();
}

function clearLastLoggedOtp() {
  lastLoggedOtp = null;
}

/**
 * Read the last OTP written in log mode (same process). Returns null if mode is not `log`.
 */
function peekLastLoggedOtp() {
  if (otpEmailMode() !== 'log') {
    return null;
  }
  return lastLoggedOtp;
}

async function sendOtpEmail({ toEmail, otpCode }) {
  const mode = otpEmailMode();
  if (mode === 'log') {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_OTP_EMAIL_LOG !== '1') {
      throw new Error(
        'OTP_EMAIL_MODE=log is not allowed in production (set ALLOW_OTP_EMAIL_LOG=1 to override).'
      );
    }
    lastLoggedOtp = {
      toEmail: String(toEmail || '').trim(),
      otpCode: String(otpCode || '').trim(),
    };
    console.error(`[otp-email] to=${lastLoggedOtp.toEmail} code=${lastLoggedOtp.otpCode}`);
    return { delivered: true, mode: 'log' };
  }

  const fromEmail = String(process.env.OTP_FROM_EMAIL || '').trim();
  const appName = process.env.APP_NAME || 'FindIt';

  const subject = `${appName} — verify your email`;
  const html = buildOtpHtml(otpCode, appName);

  await sendViaSmtp({ toEmail, fromEmail, subject, html });
  lastLoggedOtp = null;
  return { delivered: true, mode: 'smtp' };
}

async function sendPasswordResetEmail({ toEmail, resetUrl }) {
  const fromEmail = String(process.env.OTP_FROM_EMAIL || '').trim();
  const appName = process.env.APP_NAME || 'FindIt';
  const subject = `${appName} — reset your password`;
  const html = buildPasswordResetHtml(resetUrl, appName);
  await sendViaSmtp({ toEmail, fromEmail, subject, html });
  return { delivered: true, mode: 'smtp' };
}

module.exports = {
  sendOtpEmail,
  sendPasswordResetEmail,
  clearLastLoggedOtp,
  peekLastLoggedOtp,
};
