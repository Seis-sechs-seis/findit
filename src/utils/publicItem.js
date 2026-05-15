const crypto = require('crypto');

/** Four-char code from item id — looks like “member #A1B2”, not a real name. */
function reporterPseudonymSuffix(item) {
  const id = String(item && item.id != null ? item.id : '');
  const h = crypto.createHash('sha256').update(`findit|reporter|${id}`).digest('hex');
  return h.slice(0, 4).toUpperCase();
}

/** Label for “who reported this” on public pages (anonymous / verified / pseudonym). */
function buildPublicReporterLabel(item, ownerVerified) {
  const ownerId = item && item.ownerUserId;
  const hasOwner =
    ownerId != null && String(ownerId).trim() !== '' && Number.isFinite(Number(ownerId));
  if (!hasOwner) {
    return 'Anonymous reporter';
  }
  if (ownerVerified === true) {
    return 'Verified member';
  }
  return `Community member #${reporterPseudonymSuffix(item)}`;
}

/**
 * Drop contact + owner ids — fine for browse/detail when the viewer isn’t the owner.
 * @param {object} item
 * @param {{ ownerVerified?: boolean }} [options]
 */
function toPublicItem(item, options = {}) {
  if (!item) {
    return null;
  }
  const { ownerVerified } = options;
  const label = buildPublicReporterLabel(item, ownerVerified);
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    category: item.category,
    location: item.location,
    date: item.date,
    type: item.type,
    status: item.status,
    verificationPrompt: item.verificationPrompt || '',
    hasVerification: Boolean(item.hasVerification),
    createdAt: item.createdAt,
    imagesJson: item.imagesJson,
    imageUrl: item.imageUrl,
    imageUrls: item.imageUrls,
    emptyImagePlaceholder: Boolean(item.emptyImagePlaceholder),
    placeholderImageDark: item.placeholderImageDark || null,
    publicReporterLabel: label,
    canReceiveRequests: Boolean(item.ownerUserId),
  };
}

/** Owner/admin-only fields; keep off `res.locals` for guests. */
function pickItemPrivateFields(item) {
  if (!item) {
    return null;
  }
  return {
    contactName: item.contactName,
    contactEmail: item.contactEmail,
    ownerUserId: item.ownerUserId,
  };
}

module.exports = {
  buildPublicReporterLabel,
  toPublicItem,
  pickItemPrivateFields,
  reporterPseudonymSuffix,
};
