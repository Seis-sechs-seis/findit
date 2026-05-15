const pool = require('../pool');
const { getSupabaseClient } = require('../supabase');
const { ContactThreadMessageRepository } = require('./ContactThreadMessage');

const threadMessageRepo = new ContactThreadMessageRepository();

const REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'closed'];

function mapRow(row) {
  if (!row) {
    return null;
  }
  let threadTimelineEvents = [];
  const rawTl = row.threadTimelineJson ?? row.threadtimelinejson;
  if (rawTl != null && String(rawTl).trim() !== '') {
    try {
      const p = typeof rawTl === 'string' ? JSON.parse(rawTl) : rawTl;
      threadTimelineEvents = Array.isArray(p) ? p : [];
    } catch (_e) {
      threadTimelineEvents = [];
    }
  }
  return {
    id: Number(row.id),
    itemId: row.itemId,
    requesterUserId: Number(row.requesterUserId),
    ownerUserId: row.ownerUserId == null ? null : Number(row.ownerUserId),
    message: row.message || '',
    verificationResponse: row.verificationResponse || '',
    status: row.status,
    ownerDecisionNote: row.ownerDecisionNote || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt || null,
    threadTimelineJson:
      typeof rawTl === 'string'
        ? rawTl
        : rawTl != null
          ? JSON.stringify(threadTimelineEvents)
          : null,
    threadTimelineEvents,
  };
}

class ContactRequestRepository {
  #provider() {
    return (process.env.DB_PROVIDER || 'mysql').toLowerCase();
  }

  async create(data) {
    const ownerId = Number(data.ownerUserId);
    if (!Number.isFinite(ownerId) || ownerId <= 0) {
      throw new Error('This item does not have an assigned owner yet.');
    }

    if (this.#provider() === 'supabase') {
      return this.#createSupabase({ ...data, ownerUserId: ownerId });
    }
    const [result] = await pool.query(
      `INSERT INTO contact_requests
      (itemId, requesterUserId, ownerUserId, message, verificationResponse, status)
      VALUES (?, ?, ?, ?, ?, 'pending')`,
      [
        data.itemId,
        data.requesterUserId,
        ownerId,
        data.message || null,
        data.verificationResponse || null,
      ]
    );
    const [rows] = await pool.query('SELECT * FROM contact_requests WHERE id = ? LIMIT 1', [
      result.insertId,
    ]);
    return mapRow(rows[0]);
  }

  async #createSupabase(data) {
    const supabase = getSupabaseClient();
    const { data: row, error } = await supabase
      .from('contact_requests')
      .insert({
        itemId: data.itemId,
        requesterUserId: data.requesterUserId,
        ownerUserId: data.ownerUserId,
        message: data.message || null,
        verificationResponse: data.verificationResponse || null,
        status: 'pending',
      })
      .select('*')
      .single();
    if (error) {
      throw error;
    }
    return mapRow(row);
  }

  async getPendingByItemAndRequester(itemId, requesterUserId) {
    if (this.#provider() === 'supabase') {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('contact_requests')
        .select('*')
        .eq('itemId', itemId)
        .eq('requesterUserId', requesterUserId)
        .eq('status', 'pending')
        .limit(1);
      if (error) {
        throw error;
      }
      return mapRow((data || [])[0] || null);
    }
    const [rows] = await pool.query(
      `SELECT * FROM contact_requests
       WHERE itemId = ? AND requesterUserId = ? AND status = 'pending'
       ORDER BY createdAt DESC
       LIMIT 1`,
      [itemId, requesterUserId]
    );
    return mapRow(rows[0] || null);
  }

  /** Open ticket: pending (waiting on owner) or approved (conversation open). */
  async getActiveTicketForItemAndRequester(itemId, requesterUserId) {
    if (this.#provider() === 'supabase') {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('contact_requests')
        .select('*')
        .eq('itemId', itemId)
        .eq('requesterUserId', requesterUserId)
        .in('status', ['pending', 'approved'])
        .order('createdAt', { ascending: false })
        .limit(1);
      if (error) {
        throw error;
      }
      return mapRow((data || [])[0] || null);
    }
    const [rows] = await pool.query(
      `SELECT * FROM contact_requests
       WHERE itemId = ? AND requesterUserId = ? AND status IN ('pending', 'approved')
       ORDER BY createdAt DESC
       LIMIT 1`,
      [itemId, requesterUserId]
    );
    return mapRow(rows[0] || null);
  }

  async getById(id) {
    if (this.#provider() === 'supabase') {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('contact_requests')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) {
        throw error;
      }
      return mapRow(data || null);
    }
    const [rows] = await pool.query('SELECT * FROM contact_requests WHERE id = ? LIMIT 1', [id]);
    return mapRow(rows[0]);
  }

  async getIncomingForOwner(ownerUserId) {
    if (this.#provider() === 'supabase') {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('contact_requests')
        .select('*')
        .eq('ownerUserId', ownerUserId)
        .order('createdAt', { ascending: false });
      if (error) {
        throw error;
      }
      return (data || []).map(mapRow);
    }
    const [rows] = await pool.query(
      'SELECT * FROM contact_requests WHERE ownerUserId = ? ORDER BY createdAt DESC',
      [ownerUserId]
    );
    return rows.map(mapRow);
  }

  async getOutgoingForRequester(requesterUserId) {
    if (this.#provider() === 'supabase') {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('contact_requests')
        .select('*')
        .eq('requesterUserId', requesterUserId)
        .order('createdAt', { ascending: false });
      if (error) {
        throw error;
      }
      return (data || []).map(mapRow);
    }
    const [rows] = await pool.query(
      'SELECT * FROM contact_requests WHERE requesterUserId = ? ORDER BY createdAt DESC',
      [requesterUserId]
    );
    return rows.map(mapRow);
  }

  async getAll() {
    if (this.#provider() === 'supabase') {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('contact_requests')
        .select('*')
        .order('createdAt', { ascending: false });
      if (error) {
        throw error;
      }
      return (data || []).map(mapRow);
    }
    const [rows] = await pool.query('SELECT * FROM contact_requests ORDER BY createdAt DESC');
    return rows.map(mapRow);
  }

  async updateStatus({ requestId, status, ownerDecisionNote }) {
    if (!REQUEST_STATUSES.includes(status) || status === 'pending') {
      throw new Error('Invalid request status update.');
    }

    if (this.#provider() === 'supabase') {
      const supabase = getSupabaseClient();
      const payload = {
        status,
        ownerDecisionNote: ownerDecisionNote || null,
        resolvedAt: status === 'approved' ? null : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const { data, error } = await supabase
        .from('contact_requests')
        .update(payload)
        .eq('id', requestId)
        .select('*')
        .single();
      if (error) {
        throw error;
      }
      return mapRow(data);
    }

    if (status === 'approved') {
      await pool.query(
        `UPDATE contact_requests
         SET status = ?, ownerDecisionNote = ?, resolvedAt = NULL
         WHERE id = ?`,
        [status, ownerDecisionNote || null, requestId]
      );
    } else {
      await pool.query(
        `UPDATE contact_requests
         SET status = ?, ownerDecisionNote = ?, resolvedAt = NOW()
         WHERE id = ?`,
        [status, ownerDecisionNote || null, requestId]
      );
    }
    return this.getById(requestId);
  }

  async #appendTimelineEvent(requestId, event) {
    const row = await this.getById(requestId);
    if (!row) {
      throw new Error('Request not found.');
    }
    const events = Array.isArray(row.threadTimelineEvents) ? [...row.threadTimelineEvents] : [];
    events.push(event);
    const json = JSON.stringify(events);
    if (this.#provider() === 'supabase') {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('contact_requests')
        .update({
          threadTimelineJson: json,
          updatedAt: new Date().toISOString(),
        })
        .eq('id', requestId)
        .select('*')
        .single();
      if (error) {
        throw error;
      }
      return mapRow(data);
    }
    await pool.query(
      'UPDATE contact_requests SET threadTimelineJson = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
      [json, requestId]
    );
    return this.getById(requestId);
  }

  async closeThread(requestId, actorUserId) {
    const row = await this.getById(requestId);
    if (!row) {
      throw new Error('Request not found.');
    }
    if (row.status !== 'approved') {
      throw new Error('Only an open conversation can be closed.');
    }
    const actor = Number(actorUserId);
    if (actor !== Number(row.ownerUserId) && actor !== Number(row.requesterUserId)) {
      throw new Error('Not allowed.');
    }
    const afterMessageId = await threadMessageRepo.maxIdForRequest(requestId);
    await this.#appendTimelineEvent(requestId, {
      kind: 'closed',
      at: new Date().toISOString(),
      afterMessageId: Number.isFinite(afterMessageId) ? afterMessageId : 0,
    });
    return this.updateStatus({ requestId, status: 'closed', ownerDecisionNote: '' });
  }

  async reopenThread(requestId, actorUserId) {
    const row = await this.getById(requestId);
    if (!row) {
      throw new Error('Request not found.');
    }
    if (row.status !== 'closed') {
      throw new Error('Only a closed conversation can be reopened.');
    }
    const actor = Number(actorUserId);
    if (actor !== Number(row.ownerUserId) && actor !== Number(row.requesterUserId)) {
      throw new Error('Not allowed.');
    }
    await this.#appendTimelineEvent(requestId, {
      kind: 'reopened',
      at: new Date().toISOString(),
    });
    return this.updateStatus({
      requestId,
      status: 'approved',
      ownerDecisionNote: row.ownerDecisionNote != null ? row.ownerDecisionNote : null,
    });
  }
}

module.exports = { ContactRequestRepository, REQUEST_STATUSES };
