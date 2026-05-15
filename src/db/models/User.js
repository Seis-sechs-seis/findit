const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../pool');
const { getSupabaseClient } = require('../supabase');
const { normalizeEmail } = require('../../utils/email');

const SALT_ROUNDS = 10;
const ROLE_ADMIN = 'admin';
const ROLE_USER = 'user';
const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES || 10);
const OTP_RESEND_COOLDOWN_SECONDS = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 60);
const RESET_TOKEN_EXPIRY_MINUTES = Number(process.env.RESET_TOKEN_EXPIRY_MINUTES || 20);
const RESET_REQUEST_COOLDOWN_SECONDS = Number(process.env.RESET_REQUEST_COOLDOWN_SECONDS || 60);

function isAdminEmail(email) {
  const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL || '');
  return Boolean(adminEmail) && normalizeEmail(email) === adminEmail;
}

function resolveRole(role, email) {
  if (isAdminEmail(email)) {
    return ROLE_ADMIN;
  }
  return role === ROLE_ADMIN ? ROLE_ADMIN : ROLE_USER;
}

/**
 * True when profileImageUrl was set from app settings (upload), not from the OAuth IdP.
 * Those URLs must not be replaced on each OAuth sign-in.
 */
function isUserManagedProfileImageUrl(profileImageUrl) {
  const u = String(profileImageUrl || '').trim();
  if (!u) {
    return false;
  }
  if (u.startsWith('/uploads/avatars/')) {
    return true;
  }
  if (u.includes('/storage/v1/object/public/') && u.includes('/profiles/')) {
    return true;
  }
  return false;
}

async function isFirstUser(provider) {
  if (provider === 'supabase') {
    const supabase = getSupabaseClient();
    const { count, error } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true });
    if (error) {
      throw error;
    }
    return Number(count || 0) === 0;
  }

  const [rows] = await pool.query('SELECT COUNT(*) AS c FROM users');
  return Number(rows[0].c || 0) === 0;
}

class User {
  constructor({
    id,
    firstName,
    lastName,
    email,
    normalizedEmail,
    passwordHash,
    role,
    isVerified,
    otpHash,
    otpExpiresAt,
    otpLastSentAt,
    otpAttempts,
    resetTokenHash,
    resetTokenExpiresAt,
    resetLastSentAt,
    createdIp,
    createdAt,
    profileImageUrl,
  }) {
    this.id = id;
    this.firstName = firstName || '';
    this.lastName = lastName || '';
    this.email = String(email || '')
      .trim()
      .toLowerCase();
    this.normalizedEmail = normalizeEmail(normalizedEmail || this.email);
    this.passwordHash = passwordHash || '';
    this.role = resolveRole(role, this.email);
    this.isVerified = Boolean(isVerified);
    this.otpHash = otpHash || null;
    this.otpExpiresAt = otpExpiresAt || null;
    this.otpLastSentAt = otpLastSentAt || null;
    this.otpAttempts = Number(otpAttempts || 0);
    this.resetTokenHash = resetTokenHash || null;
    this.resetTokenExpiresAt = resetTokenExpiresAt || null;
    this.resetLastSentAt = resetLastSentAt || null;
    this.createdIp = createdIp || null;
    this.createdAt = createdAt;
    this.profileImageUrl = profileImageUrl || null;
  }

  validateForRegister(password, confirmPassword) {
    const errors = [];

    if (!this.firstName || this.firstName.trim().length < 1) {
      errors.push('First name is required.');
    }
    if (!this.lastName || this.lastName.trim().length < 1) {
      errors.push('Last name is required.');
    }
    if (!this.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email)) {
      errors.push('A valid email is required.');
    }
    if (!password || password.length < 8) {
      errors.push('Password must be at least 8 characters.');
    }
    if (password !== confirmPassword) {
      errors.push('Passwords do not match.');
    }

    return errors;
  }

  validateForLogin(password) {
    const errors = [];
    if (!this.email) {
      errors.push('Email is required.');
    }
    if (!password) {
      errors.push('Password is required.');
    }
    return errors;
  }
}

function mapUserRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    normalizedEmail: normalizeEmail(row.normalizedEmail || row.email),
    passwordHash: row.passwordHash,
    role: resolveRole(row.role, row.email),
    isVerified: Boolean(row.isVerified),
    otpHash: row.otpHash || null,
    otpExpiresAt: row.otpExpiresAt || null,
    otpLastSentAt: row.otpLastSentAt || null,
    otpAttempts: Number(row.otpAttempts || 0),
    resetTokenHash: row.resetTokenHash || null,
    resetTokenExpiresAt: row.resetTokenExpiresAt || null,
    resetLastSentAt: row.resetLastSentAt || null,
    createdIp: row.createdIp || null,
    createdAt: row.createdAt,
    profileImageUrl: row.profileImageUrl || row.profileimageurl || row['profileImageUrl'] || null,
    oauthProvider: row.oauthProvider || row.oauthprovider || null,
    oauthSubject: row.oauthSubject || row.oauthsubject || null,
  };
}

class UserRepository {
  async findByEmail(email) {
    return this.findByNormalizedEmail(normalizeEmail(email));
  }

  async findByNormalizedEmail(normalizedEmail) {
    const provider = (process.env.DB_PROVIDER || 'mysql').toLowerCase();
    if (provider === 'supabase') {
      return this.#findByNormalizedEmailSupabase(normalizedEmail);
    }

    const [rows] = await pool.query('SELECT * FROM users WHERE normalizedEmail = ? LIMIT 1', [
      normalizedEmail,
    ]);
    return mapUserRow(rows[0] || null);
  }

  async findById(id) {
    const provider = (process.env.DB_PROVIDER || 'mysql').toLowerCase();
    if (provider === 'supabase') {
      return this.#findByIdSupabase(id);
    }

    const [rows] = await pool.query('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
    return mapUserRow(rows[0] || null);
  }

  async create({ firstName, lastName, email, password, confirmPassword, createdIp }) {
    const provider = (process.env.DB_PROVIDER || 'mysql').toLowerCase();
    if (provider === 'supabase') {
      return this.#createSupabase({
        firstName,
        lastName,
        email,
        password,
        confirmPassword,
        createdIp,
      });
    }

    const user = new User({ firstName, lastName, email });
    const errors = user.validateForRegister(password, confirmPassword);
    if (errors.length) {
      return { success: false, errors };
    }

    const existing = await this.findByNormalizedEmail(user.normalizedEmail);
    if (existing) {
      if (existing.isVerified) {
        return { success: false, errors: ['An account with this email already exists.'] };
      }
      return {
        success: false,
        errors: ['Account exists but is not verified yet. Please verify your email.'],
      };
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const otpCode = this.#generateOtpCode();
    const otpHash = await bcrypt.hash(otpCode, SALT_ROUNDS);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    const now = new Date();
    let role = resolveRole(undefined, user.email);
    if (role !== ROLE_ADMIN && (await isFirstUser(provider))) {
      role = ROLE_ADMIN;
    }
    const [result] = await pool.query(
      `INSERT INTO users (
        firstName, lastName, email, normalizedEmail, passwordHash, role, isVerified, otpHash, otpExpiresAt, otpLastSentAt, otpAttempts, createdIp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.firstName.trim(),
        user.lastName.trim(),
        user.email,
        user.normalizedEmail,
        passwordHash,
        role,
        0,
        otpHash,
        expiresAt,
        now,
        0,
        createdIp || null,
      ]
    );

    return {
      success: true,
      requiresVerification: true,
      user: {
        id: result.insertId,
        firstName: user.firstName.trim(),
        lastName: user.lastName.trim(),
        email: user.email,
        normalizedEmail: user.normalizedEmail,
        role,
      },
      otpCode,
    };
  }

  async verifyLogin(email, password) {
    const provider = (process.env.DB_PROVIDER || 'mysql').toLowerCase();
    if (provider === 'supabase') {
      return this.#verifyLoginSupabase(email, password);
    }

    const user = new User({ email });
    const basicErrors = user.validateForLogin(password);
    if (basicErrors.length) {
      return { success: false, errors: basicErrors };
    }

    const row = await this.findByEmail(email);
    if (!row) {
      return { success: false, errors: ['Invalid email or password.'] };
    }

    if (!row.isVerified) {
      return {
        success: false,
        errors: ['Email not verified yet. Please verify your account first.'],
        requiresVerification: true,
        email: row.email,
      };
    }

    const match = await bcrypt.compare(password, row.passwordHash);
    if (!match) {
      return { success: false, errors: ['Invalid email or password.'] };
    }

    return {
      success: true,
      user: {
        id: row.id,
        firstName: row.firstName,
        lastName: row.lastName,
        email: row.email,
        role: row.role,
        profileImageUrl: row.profileImageUrl || null,
      },
    };
  }

  async #findByEmailSupabase(email) {
    return this.#findByNormalizedEmailSupabase(normalizeEmail(email));
  }

  async #findByNormalizedEmailSupabase(normalizedEmail) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('normalizedEmail', normalizedEmail)
      .maybeSingle();
    if (error) {
      throw error;
    }
    return mapUserRow(data || null);
  }

  async #findByIdSupabase(id) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
    if (error) {
      throw error;
    }
    return mapUserRow(data || null);
  }

  async #createSupabase({ firstName, lastName, email, password, confirmPassword, createdIp }) {
    const user = new User({ firstName, lastName, email });
    const errors = user.validateForRegister(password, confirmPassword);
    if (errors.length) {
      return { success: false, errors };
    }

    const existing = await this.#findByNormalizedEmailSupabase(user.normalizedEmail);
    if (existing) {
      if (existing.isVerified) {
        return { success: false, errors: ['An account with this email already exists.'] };
      }
      return {
        success: false,
        errors: ['Account exists but is not verified yet. Please verify your email.'],
      };
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const otpCode = this.#generateOtpCode();
    const otpHash = await bcrypt.hash(otpCode, SALT_ROUNDS);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();
    const nowIso = new Date().toISOString();
    const supabase = getSupabaseClient();
    let role = resolveRole(undefined, user.email);
    if (role !== ROLE_ADMIN && (await isFirstUser('supabase'))) {
      role = ROLE_ADMIN;
    }
    const { data, error } = await supabase
      .from('users')
      .insert({
        firstName: user.firstName.trim(),
        lastName: user.lastName.trim(),
        email: user.email,
        normalizedEmail: user.normalizedEmail,
        passwordHash,
        role,
        isVerified: false,
        otpHash,
        otpExpiresAt: expiresAt,
        otpLastSentAt: nowIso,
        otpAttempts: 0,
        createdIp: createdIp || null,
      })
      .select('id, firstName, lastName, email, normalizedEmail, role')
      .single();

    if (error) {
      throw error;
    }

    return {
      success: true,
      requiresVerification: true,
      user: {
        id: data.id,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        normalizedEmail: normalizeEmail(data.normalizedEmail || data.email),
        role: resolveRole(data.role, data.email),
      },
      otpCode,
    };
  }

  async #verifyLoginSupabase(email, password) {
    const user = new User({ email });
    const basicErrors = user.validateForLogin(password);
    if (basicErrors.length) {
      return { success: false, errors: basicErrors };
    }

    const row = await this.#findByEmailSupabase(email);
    if (!row) {
      return { success: false, errors: ['Invalid email or password.'] };
    }

    if (!row.isVerified) {
      return {
        success: false,
        errors: ['Email not verified yet. Please verify your account first.'],
        requiresVerification: true,
        email: row.email,
      };
    }

    const match = await bcrypt.compare(password, row.passwordHash);
    if (!match) {
      return { success: false, errors: ['Invalid email or password.'] };
    }

    return {
      success: true,
      user: {
        id: row.id,
        firstName: row.firstName,
        lastName: row.lastName,
        email: row.email,
        role: row.role,
        profileImageUrl: row.profileImageUrl || null,
      },
    };
  }

  async verifyEmailOtp({ email, otpCode }) {
    const candidate = String(otpCode || '').trim();
    if (!/^\d{6}$/.test(candidate)) {
      return { success: false, errors: ['Enter a valid 6-digit code.'] };
    }

    const row = await this.findByEmail(email);
    if (!row) {
      return { success: false, errors: ['Account not found for this email.'] };
    }
    if (row.isVerified) {
      return { success: false, errors: ['This account is already verified.'] };
    }
    if (!row.otpHash || !row.otpExpiresAt) {
      return { success: false, errors: ['No active OTP. Please resend a new code.'] };
    }
    if (new Date(row.otpExpiresAt).getTime() < Date.now()) {
      return { success: false, errors: ['OTP expired. Please resend a new code.'] };
    }
    if (row.otpAttempts >= 5) {
      return { success: false, errors: ['Too many failed attempts. Please resend a new code.'] };
    }

    const match = await bcrypt.compare(candidate, row.otpHash);
    if (!match) {
      await this.#incrementOtpAttempts(row.id);
      return { success: false, errors: ['Invalid code. Please try again.'] };
    }

    await this.#markVerified(row.id);
    return {
      success: true,
      user: {
        id: row.id,
        firstName: row.firstName,
        lastName: row.lastName,
        email: row.email,
        role: row.role,
        profileImageUrl: row.profileImageUrl || null,
      },
    };
  }

  async resendEmailOtp({ email }) {
    const row = await this.findByEmail(email);
    if (!row) {
      return { success: false, errors: ['Account not found for this email.'] };
    }
    if (row.isVerified) {
      return { success: false, errors: ['This account is already verified.'] };
    }

    const lastSentMs = row.otpLastSentAt ? new Date(row.otpLastSentAt).getTime() : 0;
    const nowMs = Date.now();
    const secondsSinceLast = Math.floor((nowMs - lastSentMs) / 1000);
    if (lastSentMs && secondsSinceLast < OTP_RESEND_COOLDOWN_SECONDS) {
      return {
        success: false,
        errors: [
          `Please wait ${OTP_RESEND_COOLDOWN_SECONDS - secondsSinceLast}s before requesting another code.`,
        ],
      };
    }

    const otpCode = this.#generateOtpCode();
    const otpHash = await bcrypt.hash(otpCode, SALT_ROUNDS);
    const expiresAt = new Date(nowMs + OTP_EXPIRY_MINUTES * 60 * 1000);
    await this.#storeOtp(row.id, otpHash, expiresAt);

    return { success: true, user: row, otpCode };
  }

  async requestPasswordReset({ email }) {
    const normalized = normalizeEmail(email);
    if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      return { success: true, shouldSend: false };
    }

    const row = await this.findByNormalizedEmail(normalized);
    if (!row || !row.isVerified) {
      return { success: true, shouldSend: false };
    }

    const lastSentMs = row.resetLastSentAt ? new Date(row.resetLastSentAt).getTime() : 0;
    const nowMs = Date.now();
    const secondsSinceLast = Math.floor((nowMs - lastSentMs) / 1000);
    if (lastSentMs && secondsSinceLast < RESET_REQUEST_COOLDOWN_SECONDS) {
      return { success: true, shouldSend: false };
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.#hashResetToken(token);
    const expiresAt = new Date(nowMs + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000);
    await this.#storeResetToken(row.id, tokenHash, expiresAt);

    return { success: true, shouldSend: true, token, user: row };
  }

  async resetPasswordByToken({ token, password, confirmPassword }) {
    const cleanToken = String(token || '').trim();
    if (!cleanToken || cleanToken.length < 20) {
      return { success: false, errors: ['Invalid or expired reset link.'] };
    }
    if (!password || password.length < 8) {
      return { success: false, errors: ['Password must be at least 8 characters.'] };
    }
    if (password !== confirmPassword) {
      return { success: false, errors: ['Passwords do not match.'] };
    }

    const tokenHash = this.#hashResetToken(cleanToken);
    const user = await this.#findByResetTokenHash(tokenHash);
    if (
      !user ||
      !user.resetTokenExpiresAt ||
      new Date(user.resetTokenExpiresAt).getTime() < Date.now()
    ) {
      return { success: false, errors: ['Invalid or expired reset link.'] };
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    await this.#updatePasswordAndClearReset(user.id, passwordHash);
    return { success: true };
  }

  async updateProfileImage(userId, profileImageUrl) {
    const provider = (process.env.DB_PROVIDER || 'mysql').toLowerCase();
    const normalizedUrl = String(profileImageUrl || '').trim() || null;
    if (provider === 'supabase') {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('users')
        .update({ profileImageUrl: normalizedUrl })
        .eq('id', userId)
        .select('*')
        .maybeSingle();
      if (error) {
        throw error;
      }
      return mapUserRow(data || null);
    }
    await pool.query('UPDATE users SET profileImageUrl = ? WHERE id = ?', [normalizedUrl, userId]);
    return this.findById(userId);
  }

  /**
   * @returns {{ success: true, user: object } | { success: false, errors: string[] }}
   */
  async updateProfileNames(userId, { firstName, lastName }) {
    const fn = String(firstName || '')
      .trim()
      .slice(0, 100);
    const ln = String(lastName || '')
      .trim()
      .slice(0, 100);
    const errors = [];
    if (fn.length < 1) {
      errors.push('First name is required.');
    }
    if (ln.length < 1) {
      errors.push('Last name is required.');
    }
    if (errors.length) {
      return { success: false, errors };
    }
    const provider = (process.env.DB_PROVIDER || 'mysql').toLowerCase();
    if (provider === 'supabase') {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('users')
        .update({ firstName: fn, lastName: ln })
        .eq('id', userId)
        .select('*')
        .maybeSingle();
      if (error) {
        throw error;
      }
      return { success: true, user: mapUserRow(data) };
    }
    await pool.query('UPDATE users SET firstName = ?, lastName = ? WHERE id = ?', [fn, ln, userId]);
    const user = await this.findById(userId);
    return { success: true, user };
  }

  async #incrementOtpAttempts(userId) {
    const provider = (process.env.DB_PROVIDER || 'mysql').toLowerCase();
    if (provider === 'supabase') {
      const supabase = getSupabaseClient();
      const current = await this.#findByIdSupabase(userId);
      const attempts = Number((current && current.otpAttempts) || 0) + 1;
      const { error } = await supabase
        .from('users')
        .update({ otpAttempts: attempts })
        .eq('id', userId);
      if (error) {
        throw error;
      }
      return;
    }
    await pool.query('UPDATE users SET otpAttempts = otpAttempts + 1 WHERE id = ?', [userId]);
  }

  async #markVerified(userId) {
    const provider = (process.env.DB_PROVIDER || 'mysql').toLowerCase();
    if (provider === 'supabase') {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('users')
        .update({
          isVerified: true,
          otpHash: null,
          otpExpiresAt: null,
          otpLastSentAt: null,
          otpAttempts: 0,
        })
        .eq('id', userId);
      if (error) {
        throw error;
      }
      return;
    }
    await pool.query(
      `UPDATE users
       SET isVerified = 1,
           otpHash = NULL,
           otpExpiresAt = NULL,
           otpLastSentAt = NULL,
           otpAttempts = 0
       WHERE id = ?`,
      [userId]
    );
  }

  async #storeOtp(userId, otpHash, expiresAt) {
    const provider = (process.env.DB_PROVIDER || 'mysql').toLowerCase();
    if (provider === 'supabase') {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('users')
        .update({
          otpHash,
          otpExpiresAt: expiresAt.toISOString(),
          otpLastSentAt: new Date().toISOString(),
          otpAttempts: 0,
        })
        .eq('id', userId);
      if (error) {
        throw error;
      }
      return;
    }
    await pool.query(
      `UPDATE users
       SET otpHash = ?, otpExpiresAt = ?, otpLastSentAt = ?, otpAttempts = 0
       WHERE id = ?`,
      [otpHash, expiresAt, new Date(), userId]
    );
  }

  async #storeResetToken(userId, tokenHash, expiresAt) {
    const provider = (process.env.DB_PROVIDER || 'mysql').toLowerCase();
    if (provider === 'supabase') {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('users')
        .update({
          resetTokenHash: tokenHash,
          resetTokenExpiresAt: expiresAt.toISOString(),
          resetLastSentAt: new Date().toISOString(),
        })
        .eq('id', userId);
      if (error) {
        throw error;
      }
      return;
    }

    await pool.query(
      `UPDATE users
       SET resetTokenHash = ?, resetTokenExpiresAt = ?, resetLastSentAt = ?
       WHERE id = ?`,
      [tokenHash, expiresAt, new Date(), userId]
    );
  }

  async #findByResetTokenHash(tokenHash) {
    const provider = (process.env.DB_PROVIDER || 'mysql').toLowerCase();
    if (provider === 'supabase') {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('resetTokenHash', tokenHash)
        .maybeSingle();
      if (error) {
        throw error;
      }
      return mapUserRow(data || null);
    }

    const [rows] = await pool.query('SELECT * FROM users WHERE resetTokenHash = ? LIMIT 1', [
      tokenHash,
    ]);
    return mapUserRow(rows[0] || null);
  }

  async #updatePasswordAndClearReset(userId, passwordHash) {
    const provider = (process.env.DB_PROVIDER || 'mysql').toLowerCase();
    if (provider === 'supabase') {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('users')
        .update({
          passwordHash,
          resetTokenHash: null,
          resetTokenExpiresAt: null,
        })
        .eq('id', userId);
      if (error) {
        throw error;
      }
      return;
    }

    await pool.query(
      `UPDATE users
       SET passwordHash = ?, resetTokenHash = NULL, resetTokenExpiresAt = NULL
       WHERE id = ?`,
      [passwordHash, userId]
    );
  }

  async findByOAuth(provider, subject) {
    const p = String(provider || '')
      .trim()
      .toLowerCase();
    const s = String(subject || '').trim();
    if (!p || !s) {
      return null;
    }
    const dbp = (process.env.DB_PROVIDER || 'mysql').toLowerCase();
    if (dbp === 'supabase') {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('oauthProvider', p)
        .eq('oauthSubject', s)
        .maybeSingle();
      if (error) {
        throw error;
      }
      return mapUserRow(data || null);
    }
    const [rows] = await pool.query(
      'SELECT * FROM users WHERE oauthProvider = ? AND oauthSubject = ? LIMIT 1',
      [p, s]
    );
    return mapUserRow(rows[0] || null);
  }

  /**
   * Create or load user for OAuth (email verified by IdP). Rejects disposable emails.
   * @returns {{ success: true, user: object } | { success: false, errors: string[] }}
   */
  async signInWithOAuthProfile({
    email,
    firstName,
    lastName,
    provider,
    subject,
    profileImageUrl,
    createdIp,
  }) {
    const p = String(provider || '')
      .trim()
      .toLowerCase();
    const s = String(subject || '').trim();
    const em = String(email || '')
      .trim()
      .toLowerCase();
    const norm = normalizeEmail(em);
    if (!p || !s || !norm) {
      return { success: false, errors: ['Invalid OAuth profile.'] };
    }

    const existingOAuth = await this.findByOAuth(p, s);
    if (existingOAuth) {
      if (!existingOAuth.isVerified) {
        await this.#markVerified(existingOAuth.id);
      }
      const nextAvatar = String(profileImageUrl || '').trim() || null;
      const prevAvatar = existingOAuth.profileImageUrl || null;
      let row = existingOAuth;
      const shouldSyncAvatarFromOAuth =
        Boolean(nextAvatar) &&
        nextAvatar !== prevAvatar &&
        !isUserManagedProfileImageUrl(prevAvatar);
      if (shouldSyncAvatarFromOAuth) {
        const updated = await this.updateProfileImage(existingOAuth.id, nextAvatar);
        if (updated) {
          row = updated;
        }
      }
      return {
        success: true,
        user: {
          id: row.id,
          firstName: row.firstName,
          lastName: row.lastName,
          email: row.email,
          role: row.role,
          profileImageUrl: row.profileImageUrl || null,
        },
      };
    }

    const existingEmail = await this.findByNormalizedEmail(norm);
    if (existingEmail) {
      return {
        success: false,
        errors: [
          'An account with this email already exists. Log in with your email and password, or use the same provider you used before.',
        ],
      };
    }

    const dbp = (process.env.DB_PROVIDER || 'mysql').toLowerCase();
    if (dbp === 'supabase') {
      return this.#signInWithOAuthSupabase({
        email: em,
        normalizedEmail: norm,
        firstName,
        lastName,
        provider: p,
        subject: s,
        profileImageUrl,
        createdIp,
      });
    }
    return this.#signInWithOAuthMysql({
      email: em,
      normalizedEmail: norm,
      firstName,
      lastName,
      provider: p,
      subject: s,
      profileImageUrl,
      createdIp,
    });
  }

  async #signInWithOAuthMysql({
    email,
    normalizedEmail,
    firstName,
    lastName,
    provider,
    subject,
    profileImageUrl,
    createdIp,
  }) {
    const passwordHash = await bcrypt.hash(
      crypto.randomBytes(48).toString('base64url'),
      SALT_ROUNDS
    );
    let role = resolveRole(undefined, email);
    if (role !== ROLE_ADMIN && (await isFirstUser('mysql'))) {
      role = ROLE_ADMIN;
    }
    try {
      const [result] = await pool.query(
        `INSERT INTO users (
          firstName, lastName, email, normalizedEmail, passwordHash, role, isVerified,
          oauthProvider, oauthSubject,
          otpHash, otpExpiresAt, otpLastSentAt, otpAttempts,
          createdIp, profileImageUrl
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, NULL, NULL, 0, ?, ?)`,
        [
          String(firstName || 'Member')
            .slice(0, 100)
            .trim(),
          String(lastName || 'User')
            .slice(0, 100)
            .trim(),
          email,
          normalizedEmail,
          passwordHash,
          role,
          provider,
          subject,
          createdIp || null,
          profileImageUrl || null,
        ]
      );
      return {
        success: true,
        user: {
          id: result.insertId,
          firstName: String(firstName || 'Member').trim(),
          lastName: String(lastName || 'User').trim(),
          email,
          role,
          profileImageUrl: profileImageUrl || null,
        },
      };
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        const row = await this.findByOAuth(provider, subject);
        if (row) {
          return {
            success: true,
            user: {
              id: row.id,
              firstName: row.firstName,
              lastName: row.lastName,
              email: row.email,
              role: row.role,
              profileImageUrl: row.profileImageUrl || null,
            },
          };
        }
        return { success: false, errors: ['Account conflict. Try again or use email login.'] };
      }
      throw err;
    }
  }

  async #signInWithOAuthSupabase({
    email,
    normalizedEmail,
    firstName,
    lastName,
    provider,
    subject,
    profileImageUrl,
    createdIp,
  }) {
    const passwordHash = await bcrypt.hash(
      crypto.randomBytes(48).toString('base64url'),
      SALT_ROUNDS
    );
    let role = resolveRole(undefined, email);
    if (role !== ROLE_ADMIN && (await isFirstUser('supabase'))) {
      role = ROLE_ADMIN;
    }
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('users')
      .insert({
        firstName: String(firstName || 'Member')
          .slice(0, 100)
          .trim(),
        lastName: String(lastName || 'User')
          .slice(0, 100)
          .trim(),
        email,
        normalizedEmail,
        passwordHash,
        role,
        isVerified: true,
        oauthProvider: provider,
        oauthSubject: subject,
        otpHash: null,
        otpExpiresAt: null,
        otpLastSentAt: null,
        otpAttempts: 0,
        createdIp: createdIp || null,
        profileImageUrl: profileImageUrl || null,
      })
      .select('id, firstName, lastName, email, role, profileImageUrl')
      .single();
    if (error) {
      if (
        String(error.code || '') === '23505' ||
        /duplicate|unique/i.test(String(error.message || ''))
      ) {
        const row = await this.findByOAuth(provider, subject);
        if (row) {
          return {
            success: true,
            user: {
              id: row.id,
              firstName: row.firstName,
              lastName: row.lastName,
              email: row.email,
              role: row.role,
              profileImageUrl: row.profileImageUrl || null,
            },
          };
        }
        return { success: false, errors: ['Account conflict. Try again or use email login.'] };
      }
      throw error;
    }
    return {
      success: true,
      user: {
        id: data.id,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        role: resolveRole(data.role, data.email),
        profileImageUrl: data.profileImageUrl || null,
      },
    };
  }

  #hashResetToken(token) {
    return crypto
      .createHash('sha256')
      .update(String(token || ''))
      .digest('hex');
  }

  #generateOtpCode() {
    const min = 10 ** (OTP_LENGTH - 1);
    const max = 10 ** OTP_LENGTH - 1;
    return String(Math.floor(Math.random() * (max - min + 1)) + min);
  }
}

module.exports = { User, UserRepository };
