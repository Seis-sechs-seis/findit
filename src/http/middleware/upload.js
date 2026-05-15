const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const uploadRoot = path.join(__dirname, '..', '..', '..', 'public', 'uploads', 'avatars');
const itemUploadRoot = path.join(__dirname, '..', '..', '..', 'public', 'uploads', 'items');
const threadMessageUploadRoot = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'public',
  'uploads',
  'thread-messages'
);
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true';

/**
 * True when Supabase Storage is fully configured and should receive uploads.
 * When this is true we use memoryStorage so the controller gets file.buffer
 * and can stream it straight to the bucket — disk is skipped entirely.
 */
function isSupabaseStorageConfigured() {
  return Boolean(
    process.env.SUPABASE_URL &&
    (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) &&
    (process.env.SUPABASE_ITEM_IMAGES_BUCKET || process.env.SUPABASE_STORAGE_BUCKET)
  );
}

const useSupabaseStorage = isSupabaseStorageConfigured();

function ensureUploadDirSync() {
  try {
    fs.mkdirSync(uploadRoot, { recursive: true });
    return true;
  } catch (_err) {
    return false;
  }
}

function ensureItemUploadDirSync() {
  try {
    fs.mkdirSync(itemUploadRoot, { recursive: true });
    return true;
  } catch (_err) {
    return false;
  }
}

function ensureThreadMessageUploadDirSync() {
  try {
    fs.mkdirSync(threadMessageUploadRoot, { recursive: true });
    return true;
  } catch (_err) {
    return false;
  }
}

const canUseDiskStorage = !isVercel && !useSupabaseStorage && ensureUploadDirSync();
const canUseItemDiskStorage = !isVercel && !useSupabaseStorage && ensureUploadDirSync() && ensureItemUploadDirSync();
const canUseThreadMessageDiskStorage =
  !isVercel && !useSupabaseStorage && ensureUploadDirSync() && ensureThreadMessageUploadDirSync();

const storage = canUseDiskStorage
  ? multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadRoot),
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
        const userId = req.session && req.session.user ? req.session.user.id : 'guest';
        const rand = crypto.randomBytes(8).toString('hex');
        cb(null, `avatar-${userId}-${Date.now()}-${rand}${safeExt}`);
      },
    })
  : multer.memoryStorage();

const reportItemStorage = canUseItemDiskStorage
  ? multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, itemUploadRoot),
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
        const rand = crypto.randomBytes(10).toString('hex');
        cb(null, `item-${Date.now()}-${rand}${safeExt}`);
      },
    })
  : multer.memoryStorage();

const threadMessageAllowedExt = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.webm', '.mov']);

function threadMessageExtFromMime(mimetype, originalname) {
  const m = String(mimetype || '').toLowerCase();
  if (m === 'image/png') {
    return '.png';
  }
  if (m === 'image/webp') {
    return '.webp';
  }
  if (m === 'image/gif') {
    return '.gif';
  }
  if (m === 'video/mp4') {
    return '.mp4';
  }
  if (m === 'video/webm') {
    return '.webm';
  }
  if (m === 'video/quicktime') {
    return '.mov';
  }
  const ext = path.extname(originalname || '').toLowerCase();
  if (threadMessageAllowedExt.has(ext)) {
    return ext;
  }
  if (m.startsWith('image/')) {
    return '.jpg';
  }
  if (m.startsWith('video/')) {
    return '.mp4';
  }
  return '.bin';
}

const threadMessageStorage = canUseThreadMessageDiskStorage
  ? multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, threadMessageUploadRoot),
      filename: (req, file, cb) => {
        const ext = threadMessageExtFromMime(file.mimetype, file.originalname);
        const safeExt = threadMessageAllowedExt.has(ext) ? ext : ext === '.bin' ? '.jpg' : ext;
        const rand = crypto.randomBytes(10).toString('hex');
        cb(null, `thread-msg-${Date.now()}-${rand}${safeExt}`);
      },
    })
  : multer.memoryStorage();

function fileFilter(_req, file, cb) {
  const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
  if (!ok) {
    cb(new Error('Only JPG, PNG, or WEBP images are allowed.'));
    return;
  }
  cb(null, true);
}

const avatarUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 },
});

const reportImagesUpload = multer({
  storage: reportItemStorage,
  fileFilter,
  limits: { fileSize: 8 * 1024 * 1024 },
});

function threadMessageFileFilter(_req, file, cb) {
  const ok = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
    'video/quicktime',
  ].includes(String(file.mimetype || '').toLowerCase());
  if (!ok) {
    cb(new Error('Only JPG, PNG, WEBP, GIF images or MP4, WEBM, MOV video are allowed.'));
    return;
  }
  cb(null, true);
}

const threadMessageUpload = multer({
  storage: threadMessageStorage,
  fileFilter: threadMessageFileFilter,
  limits: { fileSize: 12 * 1024 * 1024 },
});

module.exports = {
  avatarUpload,
  reportImagesUpload,
  threadMessageUpload,
  canPersistItemImagesToDisk: canUseItemDiskStorage,
};
