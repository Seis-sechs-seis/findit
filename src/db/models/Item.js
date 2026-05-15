const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../pool');
const { getSupabaseClient } = require('../supabase');

const CATEGORIES = [
  'Electronics',
  'Clothing',
  'Accessories',
  'Documents',
  'Keys',
  'Bags & Wallets',
  'Books & Stationery',
  'Other',
];

/** Shown when an item has no uploaded images (replaces random picsum). */
const ITEM_PLACEHOLDER_LIGHT = '/images/item-placeholder-light.png';
const ITEM_PLACEHOLDER_DARK = '/images/item-placeholder-dark.png';

const REPORT_IMAGE_OVERRIDES = {
  'a1b2c3d4-0001-4000-8000-000000000001': '/images/leather-wallet.png',
  'a1b2c3d4-0002-4000-8000-000000000002': '/images/hydroflask.png',
  'a1b2c3d4-0003-4000-8000-000000000003': '/images/macbook-charger.png',
  'a1b2c3d4-0004-4000-8000-000000000004': '/images/hondakey.png',
  'a1b2c3d4-0005-4000-8000-000000000005': '/images/hero-red-notebook.png',
  'a1b2c3d4-0006-4000-8000-000000000006': '/images/hero-backpack.png',
  'a1b2c3d4-0007-4000-8000-000000000007': '/images/hero-headphones.png',
  'a1b2c3d4-0008-4000-8000-000000000008': '/images/hero-red-notebook.png',
  'a1b2c3d4-0009-4000-8000-000000000009': '/images/macbook-charger.png',
  'a1b2c3d4-000a-4000-8000-00000000000a': '/images/ic_transparent.png',
  'a1b2c3d4-000b-4000-8000-00000000000b': '/images/auth-showcase.jpg',
  'a1b2c3d4-000c-4000-8000-00000000000c': '/images/app-icon.png',
};

/** Item ids kept when running scripts/clean-items-and-chats.js (demo seed + static card art). */
const PRESERVED_DEMO_ITEM_IDS = Object.freeze(Object.keys(REPORT_IMAGE_OVERRIDES));

/** Item ids from data/items.json (MySQL empty-table seed). Browse/home show a “Sample” badge. */
const SAMPLE_ITEMS_JSON_IDS = Object.freeze(
  new Set([
    'a1b2c3d4-0001-4000-8000-000000000001',
    'a1b2c3d4-0002-4000-8000-000000000002',
    'a1b2c3d4-0003-4000-8000-000000000003',
    'a1b2c3d4-0004-4000-8000-000000000004',
    'a1b2c3d4-0005-4000-8000-000000000005',
  ])
);

function isSampleItemsJsonItemId(id) {
  return SAMPLE_ITEMS_JSON_IDS.has(String(id || '').trim());
}

function buildReportImageUrl(row) {
  const id = String(row.id || '').trim();
  if (id && REPORT_IMAGE_OVERRIDES[id]) {
    return REPORT_IMAGE_OVERRIDES[id];
  }
  return ITEM_PLACEHOLDER_LIGHT;
}

function readRowImagesJson(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }
  const raw = row.imagesJson ?? row.images_json ?? row.imagesjson;
  if (raw == null || raw === '') {
    return null;
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)) {
    return raw.toString('utf8');
  }
  return raw;
}

function parseStoredImageUrls(raw) {
  if (raw == null || raw === '') {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw.map((u) => String(u).trim()).filter(Boolean);
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)) {
    return parseStoredImageUrls(raw.toString('utf8'));
  }
  if (typeof raw === 'object') {
    return [];
  }
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed.map((u) => String(u).trim()).filter(Boolean) : [];
  } catch (_err) {
    return [];
  }
}

function mapRow(row) {
  if (!row) {
    return null;
  }
  const dateVal = row.date;
  const dateStr =
    dateVal instanceof Date ? dateVal.toISOString().split('T')[0] : String(dateVal).split('T')[0];
  const createdVal = row.createdAt;
  const createdAt = createdVal instanceof Date ? createdVal.toISOString() : createdVal;
  const rawImagesJson = readRowImagesJson(row);
  const storedUrls = parseStoredImageUrls(rawImagesJson);
  const imageUrl = storedUrls.length ? storedUrls[0] : buildReportImageUrl(row);
  const emptyImagePlaceholder = !storedUrls.length && imageUrl === ITEM_PLACEHOLDER_LIGHT;
  const imagesJsonNormalized =
    rawImagesJson == null || rawImagesJson === ''
      ? null
      : typeof rawImagesJson === 'string'
        ? rawImagesJson
        : JSON.stringify(rawImagesJson);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    location: row.location,
    date: dateStr,
    type: row.type,
    status: row.status,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    ownerUserId: row.ownerUserId == null ? null : Number(row.ownerUserId),
    verificationPrompt: row.verificationPrompt || '',
    hasVerification: Boolean(row.verificationAnswerHash),
    createdAt,
    imagesJson: imagesJsonNormalized,
    imageUrl,
    imageUrls: storedUrls.length ? storedUrls : null,
    emptyImagePlaceholder,
    placeholderImageDark: emptyImagePlaceholder ? ITEM_PLACEHOLDER_DARK : null,
  };
}

class Item {
  constructor({
    id,
    title,
    description,
    category,
    location,
    date,
    type,
    status,
    contactName,
    contactEmail,
    ownerUserId,
    verificationPrompt,
    verificationAnswerHash,
    imagesJson,
    createdAt,
  }) {
    this.id = id || crypto.randomUUID();
    this.title = title || '';
    this.description = description || '';
    this.category = category || 'Other';
    this.location = location || '';
    this.date = date || new Date().toISOString().split('T')[0];
    this.type = type || 'lost';
    this.status = status || 'active';
    this.contactName = contactName || '';
    this.contactEmail = contactEmail || '';
    this.ownerUserId = ownerUserId == null ? null : Number(ownerUserId);
    this.verificationPrompt = (verificationPrompt || '').trim();
    this.verificationAnswerHash = verificationAnswerHash || null;
    this.imagesJson = imagesJson == null || imagesJson === '' ? null : String(imagesJson);
    this.createdAt = createdAt || new Date().toISOString();
  }

  validate() {
    const errors = [];

    if (!this.title || this.title.trim().length < 3) {
      errors.push('Title must be at least 3 characters.');
    }
    if (!this.description || this.description.trim().length < 10) {
      errors.push('Description must be at least 10 characters.');
    }
    if (!CATEGORIES.includes(this.category)) {
      errors.push('Invalid category selected.');
    }
    if (!this.location || this.location.trim().length < 2) {
      errors.push('Location is required.');
    }
    if (!['lost', 'found'].includes(this.type)) {
      errors.push('Type must be either "lost" or "found".');
    }
    if (!this.contactName || this.contactName.trim().length < 2) {
      errors.push('Contact name is required.');
    }
    if (!this.contactEmail || !this.contactEmail.includes('@')) {
      errors.push('A valid contact email is required.');
    }
    if (this.verificationPrompt && this.verificationPrompt.length < 6) {
      errors.push('Verification question must be at least 6 characters.');
    }
    if (this.verificationPrompt.length > 255) {
      errors.push('Verification question must be at most 255 characters.');
    }

    return errors;
  }

  toJSON() {
    return {
      id: this.id,
      title: this.title,
      description: this.description,
      category: this.category,
      location: this.location,
      date: this.date,
      type: this.type,
      status: this.status,
      contactName: this.contactName,
      contactEmail: this.contactEmail,
      ownerUserId: this.ownerUserId,
      verificationPrompt: this.verificationPrompt,
      verificationAnswerHash: this.verificationAnswerHash,
      imagesJson: this.imagesJson,
      createdAt: this.createdAt,
    };
  }
}

class ItemRepository {
  async getAll(filters = {}) {
    const provider = (process.env.DB_PROVIDER || 'mysql').toLowerCase();
    if (provider === 'supabase') {
      return this.#getAllSupabase(filters);
    }

    const conditions = [];
    const params = [];

    if (filters.type) {
      conditions.push('type = ?');
      params.push(filters.type);
    }
    if (filters.category) {
      conditions.push('category = ?');
      params.push(filters.category);
    }
    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    } else if (filters.excludeClaimed) {
      conditions.push('status = ?');
      params.push('active');
    }
    if (filters.search) {
      conditions.push(
        '(LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(location) LIKE ?)'
      );
      const term = `%${filters.search.toLowerCase()}%`;
      params.push(term, term, term);
    }
    if (filters.ownerUserId != null) {
      conditions.push('ownerUserId = ?');
      params.push(Number(filters.ownerUserId));
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.query(`SELECT * FROM items ${where} ORDER BY createdAt DESC`, params);
    return rows.map(mapRow);
  }

  async getById(id) {
    const provider = (process.env.DB_PROVIDER || 'mysql').toLowerCase();
    if (provider === 'supabase') {
      return this.#getByIdSupabase(id);
    }

    const [rows] = await pool.query('SELECT * FROM items WHERE id = ? LIMIT 1', [id]);
    return mapRow(rows[0] || null);
  }

  async getByOwner(userId, filters = {}) {
    const ownerId = Number(userId);
    if (!Number.isFinite(ownerId)) {
      return [];
    }
    return this.getAll({ ...filters, ownerUserId: ownerId });
  }

  async create(data) {
    const provider = (process.env.DB_PROVIDER || 'mysql').toLowerCase();
    if (provider === 'supabase') {
      return this.#createSupabase(data);
    }

    const item = new Item(data);
    const errors = item.validate();

    const rawVerificationAnswer = (data.verificationAnswer || '').trim();
    if (item.verificationPrompt && rawVerificationAnswer.length < 2) {
      errors.push('Verification answer is required when a verification question is set.');
    }
    if (!item.verificationPrompt && rawVerificationAnswer) {
      errors.push('Add a verification question before setting an answer.');
    }
    if (rawVerificationAnswer.length > 200) {
      errors.push('Verification answer must be at most 200 characters.');
    }

    if (errors.length > 0) {
      return { success: false, errors };
    }

    if (item.verificationPrompt) {
      item.verificationAnswerHash = await bcrypt.hash(rawVerificationAnswer, 10);
    }

    const row = item.toJSON();
    await pool.query(
      `INSERT INTO items (
        id, title, description, category, location, date, type, status, contactName, contactEmail, ownerUserId, verificationPrompt, verificationAnswerHash, imagesJson, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.title,
        row.description,
        row.category,
        row.location,
        row.date,
        row.type,
        row.status,
        row.contactName,
        row.contactEmail,
        row.ownerUserId,
        row.verificationPrompt || null,
        row.verificationAnswerHash,
        row.imagesJson,
        new Date(row.createdAt),
      ]
    );

    return { success: true, item: row };
  }

  async getStats() {
    const provider = (process.env.DB_PROVIDER || 'mysql').toLowerCase();
    if (provider === 'supabase') {
      return this.#getStatsSupabase();
    }

    const [rows] = await pool.query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN type = 'lost' THEN 1 ELSE 0 END) AS lost,
        SUM(CASE WHEN type = 'found' THEN 1 ELSE 0 END) AS found,
        SUM(CASE WHEN status = 'claimed' THEN 1 ELSE 0 END) AS claimed
      FROM items
    `);
    const r = rows[0];
    return {
      total: Number(r.total) || 0,
      lost: Number(r.lost) || 0,
      found: Number(r.found) || 0,
      claimed: Number(r.claimed) || 0,
    };
  }

  /**
   * @param {number} limit
   * @param {{ excludeClaimed?: boolean }} [options]
   */
  async getRecent(limit = 6, options = {}) {
    const excludeClaimed = Boolean(options.excludeClaimed);
    const provider = (process.env.DB_PROVIDER || 'mysql').toLowerCase();
    if (provider === 'supabase') {
      return this.#getRecentSupabase(limit, { excludeClaimed });
    }

    const sql = excludeClaimed
      ? 'SELECT * FROM items WHERE status = ? ORDER BY createdAt DESC LIMIT ?'
      : 'SELECT * FROM items ORDER BY createdAt DESC LIMIT ?';
    const params = excludeClaimed ? ['active', limit] : [limit];
    const [rows] = await pool.query(sql, params);
    return rows.map(mapRow);
  }

  async #getAllSupabase(filters = {}) {
    const supabase = getSupabaseClient();
    let query = supabase.from('items').select('*').order('createdAt', { ascending: false });

    if (filters.type) {
      query = query.eq('type', filters.type);
    }
    if (filters.category) {
      query = query.eq('category', filters.category);
    }
    if (filters.status) {
      query = query.eq('status', filters.status);
    } else if (filters.excludeClaimed) {
      query = query.eq('status', 'active');
    }
    if (filters.ownerUserId != null) {
      query = query.eq('ownerUserId', Number(filters.ownerUserId));
    }
    if (filters.search) {
      const safe = String(filters.search).replace(/,/g, ' ');
      query = query.or(
        `title.ilike.%${safe}%,description.ilike.%${safe}%,location.ilike.%${safe}%`
      );
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }
    return (data || []).map(mapRow);
  }

  async #getByIdSupabase(id) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('items').select('*').eq('id', id).maybeSingle();
    if (error) {
      throw error;
    }
    return mapRow(data || null);
  }

  async #createSupabase(data) {
    const item = new Item(data);
    const errors = item.validate();
    const rawVerificationAnswer = (data.verificationAnswer || '').trim();
    if (item.verificationPrompt && rawVerificationAnswer.length < 2) {
      errors.push('Verification answer is required when a verification question is set.');
    }
    if (!item.verificationPrompt && rawVerificationAnswer) {
      errors.push('Add a verification question before setting an answer.');
    }
    if (rawVerificationAnswer.length > 200) {
      errors.push('Verification answer must be at most 200 characters.');
    }
    if (errors.length > 0) {
      return { success: false, errors };
    }

    if (item.verificationPrompt) {
      item.verificationAnswerHash = await bcrypt.hash(rawVerificationAnswer, 10);
    }

    const row = item.toJSON();
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('items').insert({
      ...row,
      verificationPrompt: row.verificationPrompt || null,
      imagesJson: row.imagesJson || null,
      createdAt: new Date(row.createdAt).toISOString(),
    });
    if (error) {
      throw error;
    }
    return { success: true, item: row };
  }

  async updateById(id, data) {
    const provider = (process.env.DB_PROVIDER || 'mysql').toLowerCase();
    const existing = await this.getById(id);
    if (!existing) {
      return { success: false, errors: ['Item not found.'] };
    }

    const item = new Item({
      ...existing,
      ...data,
      id: existing.id,
      ownerUserId: existing.ownerUserId,
      createdAt: existing.createdAt,
      imagesJson: data.imagesJson !== undefined ? data.imagesJson : existing.imagesJson,
    });
    const errors = item.validate();
    const rawVerificationAnswer = (data.verificationAnswer || '').trim();
    if (item.verificationPrompt && rawVerificationAnswer.length < 2) {
      errors.push('Verification answer is required when a verification question is set.');
    }
    if (!item.verificationPrompt && rawVerificationAnswer) {
      errors.push('Add a verification question before setting an answer.');
    }
    if (rawVerificationAnswer.length > 200) {
      errors.push('Verification answer must be at most 200 characters.');
    }
    if (errors.length > 0) {
      return { success: false, errors };
    }

    item.verificationAnswerHash = item.verificationPrompt
      ? await bcrypt.hash(rawVerificationAnswer, 10)
      : null;

    if (provider === 'supabase') {
      return this.#updateByIdSupabase(id, item.toJSON());
    }

    return this.#updateByIdMysql(id, item.toJSON());
  }

  async deleteById(id) {
    const provider = (process.env.DB_PROVIDER || 'mysql').toLowerCase();
    if (provider === 'supabase') {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from('items').delete().eq('id', id);
      if (error) {
        throw error;
      }
      return { success: true };
    }
    await pool.query('DELETE FROM items WHERE id = ?', [id]);
    return { success: true };
  }

  async updateStatusById(id, status) {
    const nextStatus = status === 'claimed' ? 'claimed' : 'active';
    const provider = (process.env.DB_PROVIDER || 'mysql').toLowerCase();
    if (provider === 'supabase') {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from('items').update({ status: nextStatus }).eq('id', id);
      if (error) {
        throw error;
      }
      return { success: true };
    }
    await pool.query('UPDATE items SET status = ? WHERE id = ?', [nextStatus, id]);
    return { success: true };
  }

  async #updateByIdMysql(id, row) {
    await pool.query(
      `UPDATE items
       SET title = ?, description = ?, category = ?, location = ?, date = ?, type = ?, status = ?,
           contactName = ?, contactEmail = ?, verificationPrompt = ?, verificationAnswerHash = ?, imagesJson = ?
       WHERE id = ?`,
      [
        row.title,
        row.description,
        row.category,
        row.location,
        row.date,
        row.type,
        row.status,
        row.contactName,
        row.contactEmail,
        row.verificationPrompt || null,
        row.verificationAnswerHash,
        row.imagesJson,
        id,
      ]
    );
    const updated = await this.getById(id);
    return { success: true, item: updated };
  }

  async #updateByIdSupabase(id, row) {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('items')
      .update({
        title: row.title,
        description: row.description,
        category: row.category,
        location: row.location,
        date: row.date,
        type: row.type,
        status: row.status,
        contactName: row.contactName,
        contactEmail: row.contactEmail,
        verificationPrompt: row.verificationPrompt || null,
        verificationAnswerHash: row.verificationAnswerHash,
        imagesJson: row.imagesJson || null,
      })
      .eq('id', id);
    if (error) {
      throw error;
    }
    const updated = await this.getById(id);
    return { success: true, item: updated };
  }

  async #getStatsSupabase() {
    const supabase = getSupabaseClient();

    const totalRes = await supabase.from('items').select('id', { count: 'exact', head: true });
    if (totalRes.error) {
      throw totalRes.error;
    }

    const lostRes = await supabase
      .from('items')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'lost');
    if (lostRes.error) {
      throw lostRes.error;
    }

    const foundRes = await supabase
      .from('items')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'found');
    if (foundRes.error) {
      throw foundRes.error;
    }

    const claimedRes = await supabase
      .from('items')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'claimed');
    if (claimedRes.error) {
      throw claimedRes.error;
    }

    return {
      total: Number(totalRes.count) || 0,
      lost: Number(lostRes.count) || 0,
      found: Number(foundRes.count) || 0,
      claimed: Number(claimedRes.count) || 0,
    };
  }

  async #getRecentSupabase(limit = 6, options = {}) {
    const excludeClaimed = Boolean(options.excludeClaimed);
    const supabase = getSupabaseClient();
    let query = supabase.from('items').select('*').order('createdAt', { ascending: false }).limit(limit);
    if (excludeClaimed) {
      query = query.eq('status', 'active');
    }
    const { data, error } = await query;
    if (error) {
      throw error;
    }
    return (data || []).map(mapRow);
  }
}

module.exports = {
  Item,
  ItemRepository,
  CATEGORIES,
  PRESERVED_DEMO_ITEM_IDS,
  SAMPLE_ITEMS_JSON_IDS,
  isSampleItemsJsonItemId,
  ITEM_PLACEHOLDER_LIGHT,
  ITEM_PLACEHOLDER_DARK,
};
