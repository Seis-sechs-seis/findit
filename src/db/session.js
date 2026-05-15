'use strict';

const { Store } = require('express-session');
const { getSupabaseClient } = require('./supabase');

const TABLE = 'sessions';

class SupabaseSessionStore extends Store {
  constructor(options = {}) {
    super();
    this.ttl = options.ttl || 7 * 24 * 60 * 60; // seconds, default 7 days
  }

  #client() {
    return getSupabaseClient();
  }

  #expireAt(sess) {
    const ms = sess?.cookie?.expires
      ? new Date(sess.cookie.expires).getTime()
      : Date.now() + this.ttl * 1000;
    return new Date(ms).toISOString();
  }

  async get(sid, cb) {
    try {
      const { data, error } = await this.#client()
        .from(TABLE)
        .select('sess, expire')
        .eq('sid', sid)
        .maybeSingle();
      if (error) {
        return cb(error);
      }
      if (!data) {
        return cb(null, null);
      }
      if (new Date(data.expire) < new Date()) {
        await this.destroy(sid, () => {});
        return cb(null, null);
      }
      cb(null, data.sess);
    } catch (err) {
      cb(err);
    }
  }

  async set(sid, sess, cb) {
    try {
      const { error } = await this.#client()
        .from(TABLE)
        .upsert({ sid, sess, expire: this.#expireAt(sess) }, { onConflict: 'sid' });
      cb(error || null);
    } catch (err) {
      cb(err);
    }
  }

  async destroy(sid, cb) {
    try {
      const { error } = await this.#client().from(TABLE).delete().eq('sid', sid);
      cb(error || null);
    } catch (err) {
      cb(err);
    }
  }

  async touch(sid, sess, cb) {
    try {
      const { error } = await this.#client()
        .from(TABLE)
        .update({ expire: this.#expireAt(sess) })
        .eq('sid', sid);
      cb(error || null);
    } catch (err) {
      cb(err);
    }
  }
}

module.exports = SupabaseSessionStore;
