/**
 * Safe, lightweight rich text for contact threads (no HTML from users; output is escaped + limited tags).
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSafeHttpUrl(href) {
  const t = String(href || '').trim();
  if (!t) {
    return false;
  }
  try {
    const u = new URL(t);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function linkifyEscapedText(t) {
  let out = t;
  const emailRe = /\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
  out = out.replace(emailRe, (em) => {
    const safe = escapeHtml(em);
    const href = `mailto:${encodeURIComponent(em)}`;
    return `<a href="${escapeHtml(href)}" class="thread-msg-rich__a">${safe}</a>`;
  });
  const urlRe = /\b(https?:\/\/[^\s<&]+[^\s<&.,;:!?)])\b/gi;
  out = out.replace(urlRe, (url) => {
    if (!isSafeHttpUrl(url)) {
      return escapeHtml(url);
    }
    const safe = escapeHtml(url);
    return `<a href="${safe}" class="thread-msg-rich__a" target="_blank" rel="noopener noreferrer">${safe}</a>`;
  });
  return out;
}

/**
 * Escape + linkify + light markdown (**bold**, *italic*, `code`, > quotes, - lists, newlines).
 */
function formatThreadMessageBodyToHtml(raw) {
  const input = String(raw || '');
  if (!input.trim()) {
    return '';
  }

  let t = escapeHtml(input);

  const codeSlots = [];
  t = t.replace(/`([^`]+)`/g, (_m, code) => {
    const i = codeSlots.length;
    codeSlots.push(`<code class="thread-msg-rich__code">${escapeHtml(code)}</code>`);
    return `\uE000C${i}\uE001`;
  });

  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong class="thread-msg-rich__strong">$1</strong>');
  t = t.replace(/\*([^*]+)\*/g, '<em class="thread-msg-rich__em">$1</em>');

  t = linkifyEscapedText(t);

  for (let i = 0; i < codeSlots.length; i += 1) {
    const html = codeSlots[i];
    t = t.replace(`\uE000C${i}\uE001`, html);
  }

  const lines = t.split('\n');
  const blocks = [];
  let quoteBuf = [];
  let listBuf = [];

  const flushQuote = () => {
    if (!quoteBuf.length) {
      return;
    }
    const inner = quoteBuf.map((ln) => `<p class="thread-msg-rich__qp">${ln}</p>`).join('');
    blocks.push(`<blockquote class="thread-msg-rich__bq">${inner}</blockquote>`);
    quoteBuf = [];
  };
  const flushList = () => {
    if (!listBuf.length) {
      return;
    }
    const inner = listBuf.map((ln) => `<li class="thread-msg-rich__li">${ln}</li>`).join('');
    blocks.push(`<ul class="thread-msg-rich__ul">${inner}</ul>`);
    listBuf = [];
  };

  for (const line of lines) {
    const q = line.match(/^&gt;\s?(.*)$/);
    const li = line.match(/^-\s+(.*)$/);
    if (q) {
      flushList();
      quoteBuf.push(q[1] || '');
      continue;
    }
    flushQuote();
    if (li) {
      listBuf.push(li[1] || '');
      continue;
    }
    flushList();
    if (line.trim() === '') {
      blocks.push('<br class="thread-msg-rich__br" />');
    } else {
      blocks.push(`<p class="thread-msg-rich__p">${line}</p>`);
    }
  }
  flushQuote();
  flushList();

  return `<div class="thread-msg-rich">${blocks.join('')}</div>`;
}

function threadAttachmentKind(url) {
  const u = String(url || '').toLowerCase();
  if (!u) {
    return 'none';
  }
  if (/\.(mp4|webm|mov)(\?|$)/i.test(u)) {
    return 'video';
  }
  if (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(u)) {
    return 'image';
  }
  return 'file';
}

module.exports = {
  escapeHtml,
  formatThreadMessageBodyToHtml,
  threadAttachmentKind,
};
