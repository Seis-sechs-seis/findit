const pool = require('../pool');
const { getSupabaseClient } = require('../supabase');

class ContactRequestReadStateRepository {
  #provider() {
    return (process.env.DB_PROVIDER || 'mysql').toLowerCase();
  }

  async getLastSeenAt(requestId, userId) {
    const rid = Number(requestId);
    const uid = Number(userId);
    if (!Number.isFinite(rid) || !Number.isFinite(uid)) {
      return null;
    }
    if (this.#provider() === 'supabase') {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('contact_request_read_state')
        .select('lastSeenAt')
        .eq('requestId', rid)
        .eq('userId', uid)
        .maybeSingle();
      if (error) {
        throw error;
      }
      return data && data.lastSeenAt ? new Date(data.lastSeenAt) : null;
    }
    const [rows] = await pool.query(
      'SELECT lastSeenAt FROM contact_request_read_state WHERE requestId = ? AND userId = ? LIMIT 1',
      [rid, uid]
    );
    if (!rows.length) {
      return null;
    }
    return rows[0].lastSeenAt ? new Date(rows[0].lastSeenAt) : null;
  }

  async touch(requestId, userId) {
    const rid = Number(requestId);
    const uid = Number(userId);
    if (!Number.isFinite(rid) || !Number.isFinite(uid)) {
      return;
    }
    if (this.#provider() === 'supabase') {
      const supabase = getSupabaseClient();
      const now = new Date().toISOString();
      const { error } = await supabase.from('contact_request_read_state').upsert(
        { requestId: rid, userId: uid, lastSeenAt: now },
        { onConflict: 'requestId,userId' }
      );
      if (error) {
        throw error;
      }
      return;
    }
    await pool.query(
      `INSERT INTO contact_request_read_state (requestId, userId, lastSeenAt)
       VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE lastSeenAt = NOW()`,
      [rid, uid]
    );
  }
}

module.exports = { ContactRequestReadStateRepository };
