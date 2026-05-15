const path = require('path');
const ejs = require('ejs');
const crypto = require('crypto');
const { ItemRepository, CATEGORIES, isSampleItemsJsonItemId } = require('../../db/models/Item');
const { ContactRequestRepository } = require('../../db/models/ContactRequest');
const { ContactThreadMessageRepository } = require('../../db/models/ContactThreadMessage');
const { UserRepository } = require('../../db/models/User');
const { getSupabaseClient } = require('../../db/supabase');
const { getSupabaseItemImagesBucket } = require('../../config/supabaseStorage');
const { toPublicItem, pickItemPrivateFields } = require('../../utils/publicItem');
const {
  formatThreadMessageBodyToHtml,
  threadAttachmentKind,
} = require('../../utils/threadMessageBody');

const itemRepo = new ItemRepository();
const requestRepo = new ContactRequestRepository();
const threadMessageRepo = new ContactThreadMessageRepository();
const userRepo = new UserRepository();

const { markThreadOpened, countUnreadForUser, invalidateUnreadCountCacheForUser } = require('../services/inboxUnread.service');

function sanitizeText(value, maxLen) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLen);
}

/** Preserve newlines for thread messages (rich text / lists); trim length only. */
function sanitizeThreadMessageBody(value, maxLen) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{8,}/g, '\n\n\n\n\n\n\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+/g, ' ').replace(/\s+$/g, ''))
    .join('\n')
    .trim()
    .slice(0, maxLen);
}

function buildThreadPollEtag(freshContact, freshItem, maxMsgId) {
  const payload = [
    freshContact.id,
    freshContact.status,
    String(freshContact.updatedAt || freshContact.createdAt || ''),
    freshItem ? freshItem.status : '',
    Number(maxMsgId) || 0,
  ].join('|');
  const h = crypto.createHash('sha1').update(payload).digest('hex').slice(0, 24);
  return `W/"${h}"`;
}

function formatParticipantName(u) {
  if (!u) {
    return 'Member';
  }
  const n = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  if (n) {
    return n;
  }
  return u.email || 'Member';
}

/** Group persisted close/reopen pairs by anchor message id (0 = before first thread message). */
function buildPhaseTimelineByAfterMessageId(threadTimelineEvents) {
  const out = {};
  const arr = Array.isArray(threadTimelineEvents) ? threadTimelineEvents : [];
  let i = 0;
  while (i < arr.length) {
    const ev = arr[i];
    if (ev && ev.kind === 'closed') {
      const aid = Number(ev.afterMessageId) || 0;
      const closedAt = ev.at;
      i += 1;
      let reopenedAt = null;
      if (arr[i] && arr[i].kind === 'reopened') {
        reopenedAt = arr[i].at;
        i += 1;
      }
      const key = String(aid);
      if (!Object.prototype.hasOwnProperty.call(out, key)) {
        out[key] = [];
      }
      out[key].push({ closedAt, reopenedAt });
      continue;
    }
    i += 1;
  }
  return out;
}

/** Server-render thread feed HTML without Express res.render (avoids express-ejs-layouts / Accept quirks). */
function renderContactThreadFeedHtml(req, feedLocals) {
  const viewsRoot = req.app.get('views');
  const filePath = path.join(viewsRoot, 'partials', 'thread', 'feed.ejs');
  return new Promise((resolve, reject) => {
    ejs.renderFile(
      filePath,
      feedLocals,
      {
        views: [viewsRoot],
        filename: filePath,
        root: viewsRoot,
      },
      (err, str) => {
        if (err) {
          reject(err);
        } else {
          resolve(str);
        }
      }
    );
  });
}

function wantsThreadJson(req) {
  const accept = String(req.get('Accept') || '');
  if (accept.includes('application/json')) {
    return true;
  }
  return String(req.get('X-Requested-With') || '') === 'XMLHttpRequest';
}

/** Item primary key in URLs (numeric id or UUID string; never Number() a UUID). */
function itemPathSegment(id) {
  if (id == null || id === '') {
    return '';
  }
  return encodeURIComponent(String(id).trim());
}

function isInvalidThreadRouteParam(v) {
  const s = String(v == null ? '' : v).trim();
  return !s || s === 'NaN' || s === 'undefined' || s === 'null';
}

function buildThreadPollConfig({ item, contact, messages, user, participants }) {
  const lastMessageId = messages.reduce((max, m) => Math.max(max, Number(m.id) || 0), 0);
  const itemSeg = itemPathSegment(item && item.id);
  const reqSeg = itemPathSegment(contact && contact.id);
  return {
    pollUrl: `/items/${itemSeg}/contact/${reqSeg}/poll`,
    itemId: item && item.id,
    requestId: contact && contact.id,
    userId: Number(user.id),
    participants,
    lastMessageId,
    contactStatus: contact.status,
    itemStatus: item.status,
    pollMs: 4000,
  };
}

function threadMessageToClientJson(row) {
  if (!row) {
    return null;
  }
  const ca = row.createdAt;
  let createdAt = '';
  if (ca instanceof Date && !Number.isNaN(ca.getTime())) {
    createdAt = ca.toISOString();
  } else if (typeof ca === 'string') {
    createdAt = ca;
  }
  const body = row.body || '';
  const attachmentUrl = row.attachmentUrl || null;
  return {
    id: row.id,
    authorUserId: row.authorUserId,
    body,
    bodyHtml: formatThreadMessageBodyToHtml(body),
    attachmentUrl,
    attachmentKind: threadAttachmentKind(attachmentUrl),
    createdAt,
  };
}

async function buildThreadFeedHtmlForPackage(req, { item, contact, user, participants, messages }) {
  const uid = Number(user.id);
  const isOwner = uid === Number(contact.ownerUserId);
  const isRequester = uid === Number(contact.requesterUserId);
  const threadOpen = contact.status === 'approved';
  const threadTimelineEvents = Array.isArray(contact.threadTimelineEvents)
    ? contact.threadTimelineEvents
    : [];
  const phaseTimelineByAfter = buildPhaseTimelineByAfterMessageId(threadTimelineEvents);
  return renderContactThreadFeedHtml(req, {
    user,
    item,
    contact,
    messages,
    participants,
    isOwner,
    isRequester,
    threadOpen,
    canPost: threadOpen,
    initialMessage: contact.message || '',
    initialVerification: contact.verificationResponse || '',
    threadTimelineEvents,
    phaseTimelineByAfter,
    formatThreadBody: formatThreadMessageBodyToHtml,
    threadAttachmentKind,
  });
}

function escapeHtmlForBrowse(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape HTML, then wrap case-insensitive matches of rawQuery in <mark class="browse-search-hit">…</mark>. */
function highlightBrowseMatches(text, rawQuery) {
  const t = String(text ?? '');
  const q = String(rawQuery ?? '').trim();
  if (!q) {
    return escapeHtmlForBrowse(t);
  }
  const pattern = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let re;
  try {
    re = new RegExp(pattern, 'gi');
  } catch (_e) {
    return escapeHtmlForBrowse(t);
  }
  const parts = [];
  let lastIndex = 0;
  for (const m of t.matchAll(re)) {
    parts.push(escapeHtmlForBrowse(t.slice(lastIndex, m.index)));
    parts.push(`<mark class="browse-search-hit">${escapeHtmlForBrowse(m[0])}</mark>`);
    lastIndex = m.index + m[0].length;
  }
  parts.push(escapeHtmlForBrowse(t.slice(lastIndex)));
  return parts.join('');
}

function wantsBrowseItemsPartial(req) {
  if (String(req.query.partial || '') !== '1') {
    return false;
  }
  const accept = String(req.get('Accept') || '');
  if (accept.includes('application/json')) {
    return true;
  }
  return String(req.get('X-Requested-With') || '') === 'XMLHttpRequest';
}

function renderBrowseItemsBodyHtml(req, locals) {
  const viewsRoot = req.app.get('views');
  const filePath = path.join(viewsRoot, 'partials', 'browse-items-body.ejs');
  return new Promise((resolve, reject) => {
    ejs.renderFile(
      filePath,
      locals,
      {
        views: [viewsRoot],
        filename: filePath,
        root: viewsRoot,
      },
      (err, str) => {
        if (err) {
          reject(err);
        } else {
          resolve(str);
        }
      }
    );
  });
}

function isSupabaseStorageConfigured() {
  return Boolean(
    process.env.SUPABASE_URL &&
    (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)
  );
}

function extFromMime(mimetype) {
  const m = String(mimetype || '').toLowerCase();
  if (m === 'image/png') {
    return 'png';
  }
  if (m === 'image/webp') {
    return 'webp';
  }
  return 'jpg';
}

function extFromMimeThreadAttachment(mimetype) {
  const m = String(mimetype || '').toLowerCase();
  if (m === 'image/png') {
    return 'png';
  }
  if (m === 'image/webp') {
    return 'webp';
  }
  if (m === 'image/gif') {
    return 'gif';
  }
  if (m === 'video/mp4') {
    return 'mp4';
  }
  if (m === 'video/webm') {
    return 'webm';
  }
  if (m === 'video/quicktime') {
    return 'mov';
  }
  if (m.startsWith('image/')) {
    return 'jpg';
  }
  if (m.startsWith('video/')) {
    return 'mp4';
  }
  return 'bin';
}

async function persistUploadedReportImages(req) {
  const files = Array.isArray(req.files) ? req.files : [];
  if (!files.length) {
    return null;
  }
  const urls = [];
  for (const file of files) {
    const diskName = (file.path && path.basename(file.path)) || file.filename || '';
    if (diskName) {
      urls.push(`/uploads/items/${diskName}`);
    } else if (file.buffer && file.buffer.length) {
      if (!isSupabaseStorageConfigured()) {
        const err = new Error(
          'Photo upload needs local disk (run outside Vercel) or Supabase Storage with a public bucket (set SUPABASE_ITEM_IMAGES_BUCKET).'
        );
        err.code = 'ITEM_IMAGE_UPLOAD_CONFIG';
        throw err;
      }
      const bucket = getSupabaseItemImagesBucket();
      if (!bucket) {
        const err = new Error(
          'Photo upload needs local disk (run outside Vercel) or Supabase Storage with a public bucket (set SUPABASE_ITEM_IMAGES_BUCKET).'
        );
        err.code = 'ITEM_IMAGE_UPLOAD_CONFIG';
        throw err;
      }
      const supabase = getSupabaseClient();
      const ext = extFromMime(file.mimetype);
      const objectPath = `reports/${crypto.randomUUID()}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(bucket)
        .upload(objectPath, file.buffer, {
          contentType: file.mimetype || 'image/jpeg',
          cacheControl: '3600',
          upsert: false,
        });
      if (upErr) {
        const err = new Error(upErr.message || 'Failed to upload image to storage.');
        err.code = 'ITEM_IMAGE_UPLOAD_FAILED';
        throw err;
      }
      const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
      if (!data || !data.publicUrl) {
        throw new Error('Failed to resolve public URL for uploaded item image.');
      }
      urls.push(data.publicUrl);
    }
  }
  return urls.length ? JSON.stringify(urls) : null;
}

/** Single image for a contact thread message (local disk or Supabase Storage). */
async function persistThreadMessageAttachment(req) {
  const file = req.file;
  if (!file) {
    return null;
  }
  const diskName = (file.path && path.basename(file.path)) || file.filename || '';
  if (diskName) {
    return `/uploads/thread-messages/${diskName}`;
  }
  if (file.buffer && file.buffer.length) {
    if (!isSupabaseStorageConfigured()) {
      const err = new Error(
        'Attachment upload needs local disk or Supabase Storage (set SUPABASE_ITEM_IMAGES_BUCKET).'
      );
      err.code = 'ITEM_IMAGE_UPLOAD_CONFIG';
      throw err;
    }
    const bucket = getSupabaseItemImagesBucket();
    if (!bucket) {
      const err = new Error(
        'Attachment upload needs local disk or Supabase Storage (set SUPABASE_ITEM_IMAGES_BUCKET).'
      );
      err.code = 'ITEM_IMAGE_UPLOAD_CONFIG';
      throw err;
    }
    const supabase = getSupabaseClient();
    const ext = extFromMimeThreadAttachment(file.mimetype);
    const objectPath = `thread-messages/${crypto.randomUUID()}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(objectPath, file.buffer, {
        contentType: file.mimetype || 'image/jpeg',
        cacheControl: '3600',
        upsert: false,
      });
    if (upErr) {
      const err = new Error(upErr.message || 'Failed to upload attachment.');
      err.code = 'ITEM_IMAGE_UPLOAD_FAILED';
      throw err;
    }
    const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
    if (!data || !data.publicUrl) {
      throw new Error('Failed to resolve public URL for attachment.');
    }
    return data.publicUrl;
  }
  return null;
}

function renderReportError(req, res, status, errors, body, type) {
  const u = req.session.user;
  const formData = { ...(body || {}) };
  if (u) {
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
    if (name && !formData.contactName) {
      formData.contactName = name;
    }
    if (u.email && !formData.contactEmail) {
      formData.contactEmail = u.email;
    }
  }
  return res.status(status).render('report', {
    title: 'Report an Item',
    categories: CATEGORIES,
    type: type || formData.type || 'lost',
    errors,
    formData,
  });
}

function contactRequestStatusByItem(requests) {
  const map = new Map();
  for (const req of requests || []) {
    if (!map.has(req.itemId)) {
      map.set(req.itemId, req);
    }
  }
  return map;
}

async function browse(req, res, next) {
  try {
    const { type, category, search, showClaimed } = req.query;
    const filters = {};

    if (type && type !== 'all') {
      filters.type = type;
    }
    if (category && category !== 'all') {
      filters.category = category;
    }
    if (search) {
      filters.search = search;
    }
    const includeClaimed = String(showClaimed || '') === '1';
    if (!includeClaimed) {
      filters.excludeClaimed = true;
    }

    const items = await itemRepo.getAll(filters);
    const publicItems = items.map((row) => {
      const pub = toPublicItem(row);
      return { ...pub, isSampleSeed: isSampleItemsJsonItemId(row.id) };
    });

    if (wantsBrowseItemsPartial(req)) {
      const browseSearchQuery = String(search || '').trim();
      const html = await renderBrowseItemsBodyHtml(req, {
        items: publicItems,
        browseSearchQuery,
        highlightBrowseMatches,
        escapeHtml: escapeHtmlForBrowse,
      });
      return res.status(200).set('Cache-Control', 'private, no-store').json({
        ok: true,
        count: publicItems.length,
        html,
      });
    }

    let requestStatusByItemId = new Map();
    if (req.session && req.session.user) {
      const outgoing = await requestRepo.getOutgoingForRequester(req.session.user.id);
      requestStatusByItemId = contactRequestStatusByItem(outgoing);
    }

    res.render('browse', {
      title: 'Browse Items',
      items: publicItems,
      requestStatusByItemId,
      categories: CATEGORIES,
      filters: {
        type: type || 'all',
        category: category || 'all',
        search: search || '',
        showClaimed: includeClaimed,
      },
      browseSearchQuery: String(search || '').trim(),
      highlightBrowseMatches,
      escapeHtml: escapeHtmlForBrowse,
      metaDescription:
        'Browse active lost and found items. Optionally include claimed reports from the filters panel.',
    });
  } catch (err) {
    next(err);
  }
}

function reportGet(req, res) {
  const type = req.query.type || 'lost';
  const u = req.session.user;
  const formData = {};
  if (u) {
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
    if (name) {
      formData.contactName = name;
    }
    if (u.email) {
      formData.contactEmail = u.email;
    }
  }
  res.render('report', {
    title: 'Report an Item',
    categories: CATEGORIES,
    type,
    errors: [],
    formData,
  });
}

async function reportPost(req, res, next) {
  try {
    if (req.uploadError) {
      const msg =
        req.uploadError.code === 'LIMIT_FILE_SIZE'
          ? 'Each image must be 8 MB or smaller.'
          : req.uploadError.message || 'Image upload failed.';
      return renderReportError(req, res, 400, [msg], req.body, req.body?.type);
    }

    const {
      title,
      description,
      category,
      location,
      date,
      type,
      contactName,
      contactEmail,
      verificationPrompt,
      verificationAnswer,
    } = req.body;

    let imagesJson = null;
    try {
      imagesJson = await persistUploadedReportImages(req);
    } catch (e) {
      return renderReportError(
        req,
        res,
        400,
        [e.message || 'Upload failed.'],
        {
          title,
          description,
          category,
          location,
          date,
          type,
          contactName,
          contactEmail,
          verificationPrompt,
          verificationAnswer,
        },
        type
      );
    }

    const data = {
      title,
      description,
      category,
      location,
      date,
      type,
      contactName,
      contactEmail,
      ownerUserId: req.session.user ? req.session.user.id : null,
      verificationPrompt: sanitizeText(verificationPrompt, 255),
      verificationAnswer: sanitizeText(verificationAnswer, 200),
      imagesJson,
    };

    const result = await itemRepo.create(data);

    if (!result.success) {
      return renderReportError(req, res, 400, result.errors, data, data.type);
    }

    res.redirect(`/items/${result.item.id}?posted=1`);
  } catch (err) {
    next(err);
  }
}

async function editGet(req, res, next) {
  try {
    const item = await itemRepo.getById(req.params.id);
    if (!item) {
      return res.status(404).render('404', { title: 'Item Not Found' });
    }
    return res.render('item-edit', {
      title: `Edit: ${item.title}`,
      categories: CATEGORIES,
      errors: [],
      item,
      formData: {
        title: item.title,
        description: item.description,
        category: item.category,
        location: item.location,
        date: item.date,
        type: item.type,
        status: item.status,
        contactName: item.contactName,
        contactEmail: item.contactEmail,
        verificationPrompt: item.verificationPrompt || '',
        verificationAnswer: '',
      },
    });
  } catch (err) {
    next(err);
  }
}

async function editPost(req, res, next) {
  try {
    const item = await itemRepo.getById(req.params.id);
    if (!item) {
      return res.status(404).render('404', { title: 'Item Not Found' });
    }
    const data = {
      title: req.body.title,
      description: req.body.description,
      category: req.body.category,
      location: req.body.location,
      date: req.body.date,
      type: req.body.type,
      status: req.body.status,
      contactName: req.body.contactName,
      contactEmail: req.body.contactEmail,
      verificationPrompt: sanitizeText(req.body.verificationPrompt, 255),
      verificationAnswer: sanitizeText(req.body.verificationAnswer, 200),
      imagesJson: item.imagesJson ?? null,
    };
    const result = await itemRepo.updateById(item.id, data);
    if (!result.success) {
      return res.status(400).render('item-edit', {
        title: `Edit: ${item.title}`,
        categories: CATEGORIES,
        errors: result.errors,
        item,
        formData: data,
      });
    }
    return res.redirect('/dashboard');
  } catch (err) {
    next(err);
  }
}

async function deletePost(req, res, next) {
  try {
    const item = await itemRepo.getById(req.params.id);
    if (!item) {
      return res.status(404).render('404', { title: 'Item Not Found' });
    }
    await itemRepo.deleteById(item.id);
    return res.redirect('/dashboard');
  } catch (err) {
    next(err);
  }
}

async function toggleStatusPost(req, res, next) {
  try {
    const item = await itemRepo.getById(req.params.id);
    if (!item) {
      return res.status(404).render('404', { title: 'Item Not Found' });
    }
    const nextStatus = item.status === 'claimed' ? 'active' : 'claimed';
    await itemRepo.updateStatusById(item.id, nextStatus);
    return res.redirect('/dashboard');
  } catch (err) {
    next(err);
  }
}

async function detail(req, res, next) {
  try {
    const item = await itemRepo.getById(req.params.id);

    if (!item) {
      return res.status(404).render('404', { title: 'Item Not Found' });
    }

    const user = req.session && req.session.user ? req.session.user : null;
    const isOwner = Boolean(
      user && item.ownerUserId && Number(user.id) === Number(item.ownerUserId)
    );
    const isAdmin = Boolean(user && user.role === 'admin');
    let ownerVerified = false;
    if (item.ownerUserId) {
      const owner = await userRepo.findById(item.ownerUserId);
      ownerVerified = Boolean(owner && owner.isVerified);
    }
    const publicItem = toPublicItem(item, { ownerVerified });
    const itemPrivate = isOwner || isAdmin ? pickItemPrivateFields(item) : null;
    let ownRequest = null;
    if (user && !isOwner) {
      const outgoing = await requestRepo.getOutgoingForRequester(user.id);
      ownRequest = outgoing.find((r) => r.itemId === item.id) || null;
    }

    const descSnippet = item.description
      ? item.description.substring(0, 120) + (item.description.length > 120 ? '…' : '')
      : '';
    const metaDescription =
      `${item.type === 'lost' ? 'Lost' : 'Found'}: ${item.title} – ${item.location}. ${descSnippet}`.trim();
    res.render('item-detail', {
      title: item.title,
      item: publicItem,
      itemPrivate,
      ownRequest,
      isOwner,
      isAdmin,
      metaDescription,
    });
  } catch (err) {
    next(err);
  }
}

async function createContactRequest(req, res, next) {
  try {
    const user = req.session.user;
    const item = await itemRepo.getById(req.params.id);
    if (!item) {
      return res.status(404).render('404', { title: 'Item Not Found' });
    }
    if (item.status === 'claimed') {
      return res.status(400).render('404', {
        title: 'Request Not Allowed',
        message: 'This item is already marked as claimed.',
      });
    }
    if (!item.ownerUserId) {
      return res.status(400).render('404', {
        title: 'Request Not Available',
        message:
          'This report has no linked owner account yet, so contact requests are disabled for now.',
      });
    }
    if (item.ownerUserId && Number(item.ownerUserId) === Number(user.id)) {
      return res.status(400).render('404', {
        title: 'Request Not Allowed',
        message: 'You cannot send a contact request for your own report.',
      });
    }

    const message = sanitizeText(req.body.message, 500);
    const verificationResponse = sanitizeText(req.body.verificationResponse, 200);
    if (item.hasVerification && verificationResponse.length < 2) {
      return res.status(400).render('404', {
        title: 'Verification Required',
        message: 'Please provide an answer to the verification question.',
      });
    }

    const activeTicket = await requestRepo.getActiveTicketForItemAndRequester(item.id, user.id);
    if (activeTicket) {
      if (activeTicket.status === 'approved') {
        return res.redirect(`/items/${item.id}/contact/${activeTicket.id}`);
      }
      return res.status(400).render('404', {
        title: 'Request already in progress',
        message: 'You already have a pending contact request for this item.',
      });
    }

    await requestRepo.create({
      itemId: item.id,
      requesterUserId: user.id,
      ownerUserId: item.ownerUserId,
      message,
      verificationResponse: verificationResponse || null,
    });

    invalidateUnreadCountCacheForUser(Number(user.id));
    invalidateUnreadCountCacheForUser(Number(item.ownerUserId));

    console.log(`[notify] contact request created for item ${item.id}`);
    return res.redirect(`/items/${item.id}`);
  } catch (err) {
    next(err);
  }
}

async function approveContactRequest(req, res, next) {
  try {
    const user = req.session.user;
    const item = await itemRepo.getById(req.params.id);
    if (!item) {
      return res.status(404).render('404', { title: 'Item Not Found' });
    }
    const isAdmin = user.role === 'admin';
    const isOwner = item.ownerUserId && Number(item.ownerUserId) === Number(user.id);
    if (!isAdmin && !isOwner) {
      return res.status(403).render('404', { title: 'Access Denied' });
    }

    const request = await requestRepo.getById(req.params.requestId);
    if (!request || request.itemId !== item.id) {
      return res.status(404).render('404', { title: 'Request Not Found' });
    }
    if (request.status !== 'pending') {
      return res.status(400).render('404', {
        title: 'Invalid Action',
        message: 'Only pending requests can be approved.',
      });
    }

    await requestRepo.updateStatus({
      requestId: request.id,
      status: 'approved',
      ownerDecisionNote: sanitizeText(req.body.ownerDecisionNote, 300),
    });
    invalidateUnreadCountCacheForUser(Number(request.requesterUserId));
    invalidateUnreadCountCacheForUser(Number(request.ownerUserId));
    console.log(`[notify] contact request approved ${request.id}`);
    return res.redirect(`/items/${item.id}/contact/${request.id}`);
  } catch (err) {
    next(err);
  }
}

async function rejectContactRequest(req, res, next) {
  try {
    const user = req.session.user;
    const item = await itemRepo.getById(req.params.id);
    if (!item) {
      return res.status(404).render('404', { title: 'Item Not Found' });
    }
    const isAdmin = user.role === 'admin';
    const isOwner = item.ownerUserId && Number(item.ownerUserId) === Number(user.id);
    if (!isAdmin && !isOwner) {
      return res.status(403).render('404', { title: 'Access Denied' });
    }

    const request = await requestRepo.getById(req.params.requestId);
    if (!request || request.itemId !== item.id) {
      return res.status(404).render('404', { title: 'Request Not Found' });
    }
    if (request.status !== 'pending') {
      return res.status(400).render('404', {
        title: 'Invalid Action',
        message: 'Only pending requests can be rejected.',
      });
    }

    await requestRepo.updateStatus({
      requestId: request.id,
      status: 'rejected',
      ownerDecisionNote: sanitizeText(req.body.ownerDecisionNote, 300),
    });
    invalidateUnreadCountCacheForUser(Number(request.requesterUserId));
    invalidateUnreadCountCacheForUser(Number(request.ownerUserId));
    console.log(`[notify] contact request rejected ${request.id}`);
    return res.redirect(`/items/${item.id}/contact/${request.id}`);
  } catch (err) {
    next(err);
  }
}

async function cancelContactRequest(req, res, next) {
  try {
    const user = req.session.user;
    const item = await itemRepo.getById(req.params.id);
    if (!item) {
      return res.status(404).render('404', { title: 'Item Not Found' });
    }

    const request = await requestRepo.getById(req.params.requestId);
    if (!request || request.itemId !== item.id) {
      return res.status(404).render('404', { title: 'Request Not Found' });
    }
    if (Number(request.requesterUserId) !== Number(user.id)) {
      return res.status(403).render('404', { title: 'Access Denied' });
    }
    if (request.status !== 'pending') {
      return res.status(400).render('404', {
        title: 'Invalid Action',
        message: 'Only pending requests can be cancelled.',
      });
    }

    await requestRepo.updateStatus({
      requestId: request.id,
      status: 'cancelled',
      ownerDecisionNote: 'Cancelled by requester.',
    });
    invalidateUnreadCountCacheForUser(Number(request.requesterUserId));
    invalidateUnreadCountCacheForUser(Number(request.ownerUserId));
    console.log(`[notify] contact request cancelled ${request.id}`);
    return res.redirect(`/items/${item.id}/contact/${request.id}`);
  } catch (err) {
    next(err);
  }
}

async function contactThreadGet(req, res, next) {
  try {
    const user = req.session.user;
    const item = await itemRepo.getById(req.params.id);
    const contact = await requestRepo.getById(req.params.requestId);
    if (!item || !contact || contact.itemId !== item.id) {
      return res.status(404).render('404', { title: 'Not Found' });
    }
    const uid = Number(user.id);
    if (uid !== Number(contact.ownerUserId) && uid !== Number(contact.requesterUserId)) {
      return res.status(403).render('404', { title: 'Access Denied' });
    }

    const isOwner = uid === Number(contact.ownerUserId);
    const isRequester = uid === Number(contact.requesterUserId);

    const [ownerUser, requesterUser, messages] = await Promise.all([
      userRepo.findById(contact.ownerUserId),
      userRepo.findById(contact.requesterUserId),
      threadMessageRepo.listByRequestId(contact.id),
    ]);

    const participants = {
      [String(contact.ownerUserId)]: formatParticipantName(ownerUser),
      [String(contact.requesterUserId)]: formatParticipantName(requesterUser),
    };

    const threadOpen = contact.status === 'approved';

    await markThreadOpened(contact.id, uid);
    const threadFeedHtml = await buildThreadFeedHtmlForPackage(req, {
      item,
      contact,
      user,
      participants,
      messages,
    });
    const threadPollConfig = buildThreadPollConfig({ item, contact, messages, user, participants });
    res.locals.requestsUnreadCount = await countUnreadForUser(uid);

    res.render('contact-thread', {
      title: `Conversation · ${item.title}`,
      item,
      contact,
      participants,
      isOwner,
      isRequester,
      threadOpen,
      canPost: threadOpen,
      threadFeedHtml,
      threadPollConfig,
    });
  } catch (err) {
    next(err);
  }
}

/** Full message feed HTML + poll config (after fast shell paint). */
async function contactThreadBootstrapGet(req, res, next) {
  try {
    const user = req.session.user;
    if (isInvalidThreadRouteParam(req.params.id) || isInvalidThreadRouteParam(req.params.requestId)) {
      return res.status(400).json({ ok: false, error: 'bad_request', message: 'Invalid thread URL.' });
    }
    const item = await itemRepo.getById(req.params.id);
    const contact = await requestRepo.getById(req.params.requestId);
    if (!item || !contact || contact.itemId !== item.id) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }
    const uid = Number(user.id);
    if (uid !== Number(contact.ownerUserId) && uid !== Number(contact.requesterUserId)) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const [ownerUser, requesterUser, messages] = await Promise.all([
      userRepo.findById(contact.ownerUserId),
      userRepo.findById(contact.requesterUserId),
      threadMessageRepo.listByRequestId(contact.id),
    ]);

    const participants = {
      [String(contact.ownerUserId)]: formatParticipantName(ownerUser),
      [String(contact.requesterUserId)]: formatParticipantName(requesterUser),
    };

    await markThreadOpened(contact.id, uid);
    const requestsUnreadCount = await countUnreadForUser(uid);

    const html = await buildThreadFeedHtmlForPackage(req, {
      item,
      contact,
      user,
      participants,
      messages,
    });
    const poll = buildThreadPollConfig({ item, contact, messages, user, participants });

    return res.status(200).set('Cache-Control', 'private, no-store').json({
      ok: true,
      html,
      requestsUnreadCount,
      poll,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Contact thread messaging is server-mediated over HTTPS with session auth.
 * Messages and attachment URLs are not end-to-end encrypted in this codebase; privacy relies on
 * transport security, access control (owner/requester only), and safe storage. True E2EE would
 * require client-side crypto, key exchange, and key management — intentionally out of scope here.
 */
async function contactThreadPollGet(req, res, next) {
  try {
    const user = req.session.user;
    if (isInvalidThreadRouteParam(req.params.id) || isInvalidThreadRouteParam(req.params.requestId)) {
      return res.status(400).json({ ok: false, error: 'bad_request', message: 'Invalid thread URL.' });
    }
    const item = await itemRepo.getById(req.params.id);
    const contact = await requestRepo.getById(req.params.requestId);
    if (!item || !contact || contact.itemId !== item.id) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }
    const uid = Number(user.id);
    if (uid !== Number(contact.ownerUserId) && uid !== Number(contact.requesterUserId)) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const afterRaw = req.query.after;
    const afterId = afterRaw === undefined || afterRaw === '' ? 0 : Number(afterRaw);
    const safeAfter = Number.isFinite(afterId) && afterId >= 0 ? afterId : 0;

    const [freshContact, freshItem, newMessages, maxMsgId] = await Promise.all([
      requestRepo.getById(contact.id),
      itemRepo.getById(item.id),
      threadMessageRepo.listByRequestIdAfter(contact.id, safeAfter),
      threadMessageRepo.maxIdForRequest(contact.id),
    ]);

    if (!freshContact) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }

    const etag = buildThreadPollEtag(freshContact, freshItem || item, maxMsgId);
    const inm = req.get('if-none-match');
    if (inm && inm === etag) {
      return res.status(304).set('ETag', etag).set('Cache-Control', 'private, no-cache').end();
    }

    const threadOpen = freshContact.status === 'approved';

    return res
      .status(200)
      .set('ETag', etag)
      .set('Cache-Control', 'private, no-cache')
      .json({
        ok: true,
        meta: {
          contactStatus: freshContact.status,
          threadOpen,
          canPost: threadOpen,
          itemStatus: freshItem ? freshItem.status : item.status,
        },
        messages: newMessages.map((m) => threadMessageToClientJson(m)),
      });
  } catch (err) {
    next(err);
  }
}

async function contactThreadMessagePost(req, res, next) {
  try {
    const user = req.session.user;
    const item = await itemRepo.getById(req.params.id);
    const contact = await requestRepo.getById(req.params.requestId);
    const redirectUrl = `/items/${req.params.id}/contact/${req.params.requestId}`;
    const json = wantsThreadJson(req);

    const fail = (status, code, message) => {
      if (json) {
        return res.status(status).json({ ok: false, error: code, message: message || '' });
      }
      if (status === 404) {
        return res.status(404).render('404', { title: 'Not Found' });
      }
      if (status === 403) {
        return res.status(403).render('404', { title: 'Access Denied' });
      }
      return res.redirect(redirectUrl);
    };

    if (!item || !contact || contact.itemId !== item.id) {
      return fail(404, 'not_found', 'Not found');
    }
    const uid = Number(user.id);
    if (uid !== Number(contact.ownerUserId) && uid !== Number(contact.requesterUserId)) {
      return fail(403, 'forbidden', 'Forbidden');
    }
    if (contact.status !== 'approved') {
      return json
        ? res.status(409).json({ ok: false, error: 'thread_closed', message: 'This thread is not open for messages.' })
        : res.redirect(redirectUrl);
    }

    if (req.uploadError) {
      const msg =
        req.uploadError.code === 'LIMIT_FILE_SIZE'
          ? 'File is too large.'
          : req.uploadError.message || 'Upload failed.';
      return json ? res.status(400).json({ ok: false, error: 'upload', message: msg }) : res.redirect(redirectUrl);
    }

    const body = sanitizeThreadMessageBody(req.body.message, 4000);
    let attachmentUrl = null;
    try {
      attachmentUrl = await persistThreadMessageAttachment(req);
    } catch (e) {
      if (json) {
        return res.status(500).json({ ok: false, error: 'upload', message: e.message || 'Upload failed.' });
      }
      return next(e);
    }

    if (body.length < 1 && !attachmentUrl) {
      return json
        ? res.status(400).json({ ok: false, error: 'empty', message: 'Message cannot be empty.' })
        : res.redirect(redirectUrl);
    }

    const row = await threadMessageRepo.create({
      requestId: contact.id,
      authorUserId: uid,
      body,
      attachmentUrl,
    });
    invalidateUnreadCountCacheForUser(Number(contact.ownerUserId));
    invalidateUnreadCountCacheForUser(Number(contact.requesterUserId));

    if (json) {
      const requestsUnreadCount = await countUnreadForUser(uid);
      return res.status(200).json({
        ok: true,
        message: threadMessageToClientJson(row),
        requestsUnreadCount,
      });
    }
    return res.redirect(redirectUrl);
  } catch (err) {
    next(err);
  }
}

async function contactThreadClosePost(req, res, next) {
  try {
    const user = req.session.user;
    const item = await itemRepo.getById(req.params.id);
    const contact = await requestRepo.getById(req.params.requestId);
    const redirectUrl = `/items/${req.params.id}/contact/${req.params.requestId}`;
    if (!item || !contact || contact.itemId !== item.id) {
      return res.status(404).render('404', { title: 'Not Found' });
    }
    const uid = Number(user.id);
    if (uid !== Number(contact.ownerUserId) && uid !== Number(contact.requesterUserId)) {
      return res.status(403).render('404', { title: 'Access Denied' });
    }

    try {
      await requestRepo.closeThread(contact.id, uid);
    } catch (e) {
      return res.status(400).render('404', {
        title: 'Cannot close',
        message: e.message || 'This conversation cannot be closed.',
      });
    }
    invalidateUnreadCountCacheForUser(Number(contact.ownerUserId));
    invalidateUnreadCountCacheForUser(Number(contact.requesterUserId));
    return res.redirect(redirectUrl);
  } catch (err) {
    next(err);
  }
}

async function contactThreadReopenPost(req, res, next) {
  try {
    const user = req.session.user;
    const item = await itemRepo.getById(req.params.id);
    const contact = await requestRepo.getById(req.params.requestId);
    const redirectUrl = `/items/${req.params.id}/contact/${req.params.requestId}`;
    if (!item || !contact || contact.itemId !== item.id) {
      return res.status(404).render('404', { title: 'Not Found' });
    }
    const uid = Number(user.id);
    if (uid !== Number(contact.ownerUserId) && uid !== Number(contact.requesterUserId)) {
      return res.status(403).render('404', { title: 'Access Denied' });
    }

    try {
      await requestRepo.reopenThread(contact.id, uid);
    } catch (e) {
      return res.status(400).render('404', {
        title: 'Cannot reopen',
        message: e.message || 'This conversation cannot be reopened.',
      });
    }
    invalidateUnreadCountCacheForUser(Number(contact.ownerUserId));
    invalidateUnreadCountCacheForUser(Number(contact.requesterUserId));
    return res.redirect(redirectUrl);
  } catch (err) {
    next(err);
  }
}

async function claimAsOwnerPost(req, res, next) {
  try {
    const user = req.session.user;
    const item = await itemRepo.getById(req.params.id);
    if (!item) {
      return res.status(404).render('404', { title: 'Item Not Found' });
    }
    if (!item.ownerUserId || Number(item.ownerUserId) !== Number(user.id)) {
      return res.status(403).render('404', { title: 'Access Denied' });
    }
    if (item.status === 'claimed') {
      const nextUrl = String(req.body.next || '').trim();
      if (nextUrl.startsWith('/') && !nextUrl.startsWith('//')) {
        return res.redirect(nextUrl);
      }
      return res.redirect(`/items/${item.id}`);
    }

    await itemRepo.updateStatusById(item.id, 'claimed');
    const nextUrl = String(req.body.next || '').trim();
    if (nextUrl.startsWith('/') && !nextUrl.startsWith('//')) {
      return res.redirect(nextUrl);
    }
    return res.redirect(`/items/${item.id}`);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  browse,
  reportGet,
  reportPost,
  editGet,
  editPost,
  deletePost,
  toggleStatusPost,
  detail,
  createContactRequest,
  approveContactRequest,
  rejectContactRequest,
  cancelContactRequest,
  contactThreadGet,
  contactThreadBootstrapGet,
  contactThreadPollGet,
  contactThreadMessagePost,
  contactThreadClosePost,
  contactThreadReopenPost,
  claimAsOwnerPost,
};
