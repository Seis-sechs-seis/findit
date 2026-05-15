const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ItemRepository, isSampleItemsJsonItemId } = require('../../db/models/Item');
const { toPublicItem } = require('../../utils/publicItem');
const { ContactRequestRepository } = require('../../db/models/ContactRequest');
const { UserRepository } = require('../../db/models/User');
const { getSupabaseClient } = require('../../db/supabase');
const { getSupabaseAvatarBucket } = require('../../config/supabaseStorage');

const itemRepo = new ItemRepository();
const requestRepo = new ContactRequestRepository();
const userRepo = new UserRepository();
const { markInboxListOpened, countUnreadForUser } = require('../services/inboxUnread.service');

async function home(req, res, next) {
  try {
    const [stats, recentRows] = await Promise.all([
      itemRepo.getStats(),
      itemRepo.getRecent(6, { excludeClaimed: true }),
    ]);
    const recentItems = recentRows.map((row) => ({
      ...toPublicItem(row),
      isSampleSeed: isSampleItemsJsonItemId(row.id),
    }));
    res.render('home', {
      title: 'Home',
      stats,
      recentItems,
      metaDescription:
        'FindIt – Report, search, and recover lost belongings in your community. Lost something? Found something? Start here.',
    });
  } catch (err) {
    next(err);
  }
}

async function requestsInbox(req, res, next) {
  try {
    const userId = req.session.user.id;
    await markInboxListOpened(userId);
    res.locals.requestsUnreadCount = await countUnreadForUser(userId);

    const [incoming, outgoing] = await Promise.all([
      requestRepo.getIncomingForOwner(userId),
      requestRepo.getOutgoingForRequester(userId),
    ]);
    const seen = new Set();
    const entries = [];
    for (const r of incoming) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        entries.push({ request: r, perspective: 'incoming' });
      }
    }
    for (const r of outgoing) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        entries.push({ request: r, perspective: 'outgoing' });
      }
    }
    entries.sort((a, b) => {
      const ta = new Date(a.request.updatedAt || a.request.createdAt).getTime();
      const tb = new Date(b.request.updatedAt || b.request.createdAt).getTime();
      return tb - ta;
    });

    const items = await Promise.all(entries.map((e) => itemRepo.getById(e.request.itemId)));
    const rowsAll = entries.map((e, i) => ({
      ...e,
      item: items[i],
    }));

    const viewRaw = String(req.query.view || 'approved').toLowerCase();
    const requestsView = viewRaw === 'closed' ? 'closed' : 'approved';

    const inApprovedTab = (status) => status === 'approved' || status === 'pending';
    const inClosedTab = (status) =>
      status === 'closed' || status === 'rejected' || status === 'cancelled';

    const countApprovedTab = rowsAll.filter((row) => inApprovedTab(row.request.status)).length;
    const countClosedTab = rowsAll.filter((row) => inClosedTab(row.request.status)).length;

    const rows = rowsAll.filter((row) =>
      requestsView === 'closed'
        ? inClosedTab(row.request.status)
        : inApprovedTab(row.request.status)
    );

    res.render('requests-inbox', {
      title: 'Requests',
      rows,
      rowsAll,
      requestsView,
      countApprovedTab,
      countClosedTab,
      metaDescription: 'Contact requests and conversations for your lost & found activity.',
    });
  } catch (err) {
    next(err);
  }
}

async function dashboard(req, res, next) {
  try {
    const user = req.session.user;
    const isAdmin = user && user.role === 'admin';

    let stats;
    let items;
    let myItems = [];
    let incomingRequests = [];
    let outgoingRequests = [];
    if (isAdmin) {
      [stats, items, myItems, incomingRequests, outgoingRequests] = await Promise.all([
        itemRepo.getStats(),
        itemRepo.getAll(),
        itemRepo.getByOwner(user.id),
        requestRepo.getAll(),
        requestRepo.getOutgoingForRequester(user.id),
      ]);
    } else {
      [items, incomingRequests, outgoingRequests] = await Promise.all([
        itemRepo.getByOwner(user.id),
        requestRepo.getIncomingForOwner(user.id),
        requestRepo.getOutgoingForRequester(user.id),
      ]);
      myItems = items;
      stats = {
        total: items.length,
        lost: items.filter((i) => i.type === 'lost').length,
        found: items.filter((i) => i.type === 'found').length,
        claimed: items.filter((i) => i.status === 'claimed').length,
      };
    }

    const itemsById = new Map(items.map((it) => [it.id, it]));
    const requestItemIds = new Set([...incomingRequests, ...outgoingRequests].map((r) => r.itemId));
    const missingItemIds = [...requestItemIds].filter((id) => !itemsById.has(id));
    if (missingItemIds.length) {
      const extraItems = await Promise.all(missingItemIds.map((id) => itemRepo.getById(id)));
      for (let i = 0; i < missingItemIds.length; i += 1) {
        const extraItem = extraItems[i];
        if (extraItem) {
          itemsById.set(missingItemIds[i], extraItem);
        }
      }
    }
    incomingRequests = incomingRequests.map((req) => ({
      ...req,
      item: itemsById.get(req.itemId) || null,
    }));
    outgoingRequests = outgoingRequests.map((req) => ({
      ...req,
      item: itemsById.get(req.itemId) || null,
    }));

    res.render('dashboard', {
      title: isAdmin ? 'Admin Dashboard' : 'My Dashboard',
      stats,
      items,
      myItems,
      incomingRequests,
      outgoingRequests,
      isAdmin,
    });
  } catch (err) {
    next(err);
  }
}

function reportHub(req, res) {
  res.render('report-hub', {
    title: 'Choose Report Type',
  });
}

function terms(req, res) {
  res.render('terms', {
    title: 'Terms of Service',
    updatedAt: 'May 9, 2026',
  });
}

function privacy(req, res) {
  res.render('privacy', {
    title: 'Privacy Policy',
    updatedAt: 'May 9, 2026',
  });
}

async function settings(req, res, next) {
  try {
    const user = await userRepo.findById(req.session.user.id);
    res.render('settings', {
      title: 'Settings',
      errors: [],
      success: '',
      profile: user || req.session.user,
    });
  } catch (err) {
    next(err);
  }
}

async function postSettings(req, res, next) {
  try {
    const userId = req.session.user.id;
    const renderSettings = async (status, { errors, success, profileOverride }) => {
      const profile = profileOverride || (await userRepo.findById(userId)) || req.session.user;
      const payload = {
        title: 'Settings',
        errors: errors || [],
        success: success || '',
        profile,
      };
      if (status && status !== 200) {
        return res.status(status).render('settings', payload);
      }
      return res.render('settings', payload);
    };

    if (req.uploadError) {
      const message =
        req.uploadError.code === 'LIMIT_FILE_SIZE'
          ? 'Image is too large. Maximum size is 2MB.'
          : req.uploadError.message || 'Upload failed. Please try again.';
      return renderSettings(400, { errors: [message] });
    }

    const rawChoice = String(req.body?.avatarChoice || 'keep').toLowerCase();
    const avatarChoice = ['keep', 'remove', 'new'].includes(rawChoice) ? rawChoice : 'keep';

    const nameResult = await userRepo.updateProfileNames(userId, {
      firstName: req.body.firstName,
      lastName: req.body.lastName,
    });

    let profile = await userRepo.findById(userId);
    if (!nameResult.success) {
      const base = profile || req.session.user;
      const merged = {
        ...(base && typeof base === 'object' ? base : {}),
        firstName: String(req.body.firstName || ''),
        lastName: String(req.body.lastName || ''),
      };
      return renderSettings(400, {
        errors: nameResult.errors || ['Could not update name.'],
        profileOverride: merged,
      });
    }
    if (nameResult.user) {
      req.session.user.firstName = nameResult.user.firstName;
      req.session.user.lastName = nameResult.user.lastName;
    }
    profile = await userRepo.findById(userId);

    if (avatarChoice === 'new') {
      if (!req.file) {
        return renderSettings(400, {
          errors: ['Choose an image file for “Upload new”, or select another photo option.'],
          profileOverride: profile,
        });
      }
      const oldProfileImageUrl = profile && profile.profileImageUrl ? profile.profileImageUrl : '';
      let profileImageUrl = '';
      const localAvatarName =
        req.file.filename || (req.file.path && path.basename(req.file.path)) || '';
      if (isSupabaseStorageConfigured() && req.file.buffer && req.file.buffer.length) {
        profileImageUrl = await uploadAvatarToSupabase(userId, req.file);
      } else if (localAvatarName) {
        profileImageUrl = `/uploads/avatars/${localAvatarName}`;
      } else {
        return renderSettings(400, {
          errors: ['Upload failed. Configure Supabase Storage for cloud uploads in production.'],
          profileOverride: profile,
        });
      }
      const updated = await userRepo.updateProfileImage(userId, profileImageUrl);
      if (updated) {
        req.session.user.profileImageUrl = updated.profileImageUrl || null;
      }
      await removeSupabaseAvatarIfManaged(oldProfileImageUrl);
      await removeLocalAvatarIfManaged(oldProfileImageUrl);
    } else if (avatarChoice === 'remove') {
      const oldProfileImageUrl = profile && profile.profileImageUrl ? profile.profileImageUrl : '';
      const updated = await userRepo.updateProfileImage(userId, null);
      if (updated) {
        req.session.user.profileImageUrl = null;
      }
      await removeSupabaseAvatarIfManaged(oldProfileImageUrl);
      await removeLocalAvatarIfManaged(oldProfileImageUrl);
    }

    profile = await userRepo.findById(userId);
    return renderSettings(200, {
      success: 'Settings saved.',
      profileOverride: profile || req.session.user,
    });
  } catch (err) {
    next(err);
  }
}

function isSupabaseStorageConfigured() {
  return Boolean(
    process.env.SUPABASE_URL &&
    (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)
  );
}

function extFromFile(file) {
  const mime = String(file.mimetype || '').toLowerCase();
  if (mime === 'image/png') {
    return 'png';
  }
  if (mime === 'image/webp') {
    return 'webp';
  }
  return 'jpg';
}

async function uploadAvatarToSupabase(userId, file) {
  const bucket = getSupabaseAvatarBucket();
  const supabase = getSupabaseClient();
  const ext = extFromFile(file);
  const objectPath = `profiles/${userId}/avatar-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(objectPath, file.buffer, {
      contentType: file.mimetype || 'image/jpeg',
      cacheControl: '3600',
      upsert: false,
    });
  if (uploadError) {
    throw uploadError;
  }
  const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
  if (!data || !data.publicUrl) {
    throw new Error('Failed to resolve public URL for uploaded avatar.');
  }
  return data.publicUrl;
}

async function removeSupabaseAvatarIfManaged(profileImageUrl) {
  const value = String(profileImageUrl || '').trim();
  if (!value) {
    return;
  }
  const bucket = getSupabaseAvatarBucket();
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = value.indexOf(marker);
  if (idx === -1) {
    return;
  }
  const objectPath = value.slice(idx + marker.length);
  if (!objectPath) {
    return;
  }
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.storage.from(bucket).remove([objectPath]);
    if (error) {
      throw error;
    }
  } catch (_err) {
    // Best-effort cleanup; ignore not found/permission cleanup failures.
  }
}

async function removeLocalAvatarIfManaged(profileImageUrl) {
  const value = String(profileImageUrl || '').trim();
  if (!value.startsWith('/uploads/avatars/')) {
    return;
  }
  const fileName = path.basename(value);
  const absPath = path.join(__dirname, '..', '..', '..', 'public', 'uploads', 'avatars', fileName);
  try {
    await fs.promises.unlink(absPath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
}

module.exports = {
  home,
  requestsInbox,
  dashboard,
  reportHub,
  terms,
  privacy,
  settings,
  postSettings,
};
