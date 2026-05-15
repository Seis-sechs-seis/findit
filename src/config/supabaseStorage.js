/**
 * Supabase Storage bucket names from env, validated for Storage API (no slashes / traversal).
 */

function normalizeBucketName(raw) {
  const s = String(raw || '').trim();
  if (!s || s.length > 200) {
    return null;
  }
  // Supabase bucket names: letters, digits, dot, underscore, hyphen; must start with alphanumeric.
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(s)) {
    return null;
  }
  return s;
}

/** Public bucket for item report photos + thread attachments (buffer uploads). */
function getSupabaseItemImagesBucket() {
  const fromEnv =
    process.env.SUPABASE_ITEM_IMAGES_BUCKET || process.env.SUPABASE_STORAGE_BUCKET || '';
  return normalizeBucketName(fromEnv);
}

/** Bucket for profile avatars (default matches common Supabase tutorial name). */
function getSupabaseAvatarBucket() {
  const fromEnv = process.env.SUPABASE_AVATAR_BUCKET || 'avatars';
  return normalizeBucketName(fromEnv) || 'avatars';
}

module.exports = {
  getSupabaseItemImagesBucket,
  getSupabaseAvatarBucket,
};
