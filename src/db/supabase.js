const { createClient } = require('@supabase/supabase-js');

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const key = serviceKey || anonKey;

  if (!url || !key) {
    const err = new Error(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY).'
    );
    err.code = 'SUPABASE_CONFIG_MISSING';
    throw err;
  }

  // Warn loudly: anon key does not bypass RLS. All tables must have deny-all
  // RLS policies (see supabase-rls.sql) or data is publicly accessible.
  if (!serviceKey) {
    console.warn(
      '[security] SUPABASE_SERVICE_ROLE_KEY is not set — falling back to anon key. ' +
        'Ensure supabase-rls.sql has been applied to all tables.'
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

module.exports = { getSupabaseClient };
