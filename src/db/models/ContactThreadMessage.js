const pool = require('../pool');
const { getSupabaseClient } = require('../supabase');

function mapRow(row) {
  if (!row) {
    return null;
  }
  const rawAttach = row.attachmentUrl ?? row.attachmenturl;
  return {
    id: Number(row.id),
    requestId: Number(row.requestId),
    authorUserId: Number(row.authorUserId),
    body: row.body || '',
    attachmentUrl: rawAttach != null && String(rawAttach).trim() ? String(rawAttach).trim() : null,
    createdAt: row.createdAt,
  };
}

class ContactThreadMessageRepository {
  #provider() {
    return (process.env.DB_PROVIDER || 'mysql').toLowerCase();
  }

  async listByRequestId(requestId) {
    const rid = Number(requestId);
    if (!Number.isFinite(rid)) {
      return [];
    }
    if (this.#provider() === 'supabase') {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('contact_request_messages')
        .select('*')
        .eq('requestId', rid)
        .order('createdAt', { ascending: true });
      if (error) {
        throw error;
      }
      return (data || []).map(mapRow);
    }
    const [rows] = await pool.query(
      'SELECT * FROM contact_request_messages WHERE requestId = ? ORDER BY createdAt ASC',
      [rid]
    );
    return rows.map(mapRow);
  }

  /** Messages with id strictly greater than afterId (for incremental poll). Use afterId 0 for all rows. */
  async listByRequestIdAfter(requestId, afterId) {
    const rid = Number(requestId);
    const after = Number(afterId);
    const minExclusive = Number.isFinite(after) && after >= 0 ? after : 0;
    if (!Number.isFinite(rid)) {
      return [];
    }

    if (this.#provider() === 'supabase') {
      const supabase = getSupabaseClient();
      let q = supabase
        .from('contact_request_messages')
        .select('*')
        .eq('requestId', rid)
        .order('createdAt', { ascending: true });
      if (minExclusive > 0) {
        q = q.gt('id', minExclusive);
      }
      const { data, error } = await q;
      if (error) {
        throw error;
      }
      return (data || []).map(mapRow);
    }

    const [rows] =
      minExclusive > 0
        ? await pool.query(
            'SELECT * FROM contact_request_messages WHERE requestId = ? AND id > ? ORDER BY createdAt ASC',
            [rid, minExclusive]
          )
        : await pool.query(
            'SELECT * FROM contact_request_messages WHERE requestId = ? ORDER BY createdAt ASC',
            [rid]
          );
    return rows.map(mapRow);
  }

  /** Highest message id for a request (0 if none). Used for poll ETags. */
  async maxIdForRequest(requestId) {
    const rid = Number(requestId);
    if (!Number.isFinite(rid)) {
      return 0;
    }
    if (this.#provider() === 'supabase') {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('contact_request_messages')
        .select('id')
        .eq('requestId', rid)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        throw error;
      }
      return data && data.id != null ? Number(data.id) : 0;
    }
    const [rows] = await pool.query(
      'SELECT COALESCE(MAX(id), 0) AS m FROM contact_request_messages WHERE requestId = ?',
      [rid]
    );
    return Number(rows[0]?.m || 0);
  }

  async create({ requestId, authorUserId, body, attachmentUrl }) {
    const rid = Number(requestId);
    const aid = Number(authorUserId);
    if (!Number.isFinite(rid) || !Number.isFinite(aid)) {
      throw new Error('Invalid message target.');
    }
    const text = String(body || '').trim();
    const attach =
      attachmentUrl != null && String(attachmentUrl).trim().length > 0
        ? String(attachmentUrl).trim().slice(0, 500)
        : null;
    if (text.length < 1 && !attach) {
      throw new Error('Message cannot be empty.');
    }
    const bodyStored = text.length > 0 ? text : '';

    if (this.#provider() === 'supabase') {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('contact_request_messages')
        .insert({
          requestId: rid,
          authorUserId: aid,
          body: bodyStored,
          attachmentUrl: attach,
        })
        .select('*')
        .single();
      if (error) {
        throw error;
      }
      return mapRow(data);
    }

    const [result] = await pool.query(
      'INSERT INTO contact_request_messages (requestId, authorUserId, body, attachmentUrl) VALUES (?, ?, ?, ?)',
      [rid, aid, bodyStored, attach]
    );
    const [rows] = await pool.query('SELECT * FROM contact_request_messages WHERE id = ? LIMIT 1', [
      result.insertId,
    ]);
    return mapRow(rows[0]);
  }

  /** True if another participant posted a thread message after `afterAt` (exclusive). */
  async hasFromOtherAfter(requestId, userId, afterAt) {
    const rid = Number(requestId);
    const uid = Number(userId);
    if (!Number.isFinite(rid) || !Number.isFinite(uid)) {
      return false;
    }
    const cutoff = afterAt instanceof Date && !Number.isNaN(afterAt.getTime()) ? afterAt : new Date(0);

    if (this.#provider() === 'supabase') {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('contact_request_messages')
        .select('id')
        .eq('requestId', rid)
        .neq('authorUserId', uid)
        .gt('createdAt', cutoff.toISOString())
        .limit(1);
      if (error) {
        throw error;
      }
      return (data || []).length > 0;
    }

    const [rows] = await pool.query(
      `SELECT id FROM contact_request_messages
       WHERE requestId = ? AND authorUserId != ? AND createdAt > ?
       LIMIT 1`,
      [rid, uid, cutoff]
    );
    return rows.length > 0;
  }
}

module.exports = { ContactThreadMessageRepository };
