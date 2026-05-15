(() => {
  const cfgEl = document.getElementById('contact-thread-poll-config');
  const scroller = document.querySelector('[data-thread-scroller]');
  const list = document.querySelector('[data-thread-message-list]');
  const threadRoot = document.getElementById('contact-thread-root');
  if (!cfgEl || !scroller || !list) return;

  let cfg;
  try {
    cfg = JSON.parse(cfgEl.textContent || '{}');
  } catch (_e) {
    return;
  }
  if (!cfg.pollUrl || cfg.userId == null) return;

  if (/\/items\/NaN\//.test(String(cfg.pollUrl)) || /\/contact\/NaN\//.test(String(cfg.pollUrl))) {
    window.location.reload();
    return;
  }

  const etagKey =
    cfg.itemId != null && cfg.requestId != null
      ? `findit:threadPollEtag:${cfg.itemId}:${cfg.requestId}`
      : null;

  const state = {
    lastMessageId: Number(cfg.lastMessageId) || 0,
    contactStatus: String(cfg.contactStatus || ''),
    itemStatus: String(cfg.itemStatus || ''),
    pollEtag: '',
    failureStreak: 0,
  };

  try {
    if (etagKey && typeof sessionStorage !== 'undefined') {
      const saved = sessionStorage.getItem(etagKey);
      if (saved) state.pollEtag = saved;
    }
  } catch (_e) {
    /* private mode */
  }

  function formatTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function toIsoAttr(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString();
  }

  function participantName(id) {
    const p = cfg.participants || {};
    return p[String(id)] || 'Member';
  }

  function avatarLetter(name) {
    const c = String(name || '').trim().charAt(0);
    return c ? c.toUpperCase() : '?';
  }

  function isNearBottom(el, px) {
    return el.scrollHeight - el.scrollTop - el.clientHeight < (px || 140);
  }

  function lastChatMessageRow() {
    const rows = list.querySelectorAll('.thread-discord__msg[data-msg-id]');
    return rows.length ? rows[rows.length - 1] : null;
  }

  function inferAttachmentKind(url) {
    const u = String(url || '').toLowerCase();
    if (!u) return 'none';
    if (/\.(mp4|webm|mov)(\?|$)/i.test(u)) return 'video';
    if (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(u)) return 'image';
    return 'file';
  }

  function appendThreadAttachment(bubble, m, mine, afterText) {
    const url = m.attachmentUrl;
    if (!url) return;
    let kind = m.attachmentKind;
    if (!kind || kind === 'none') {
      kind = inferAttachmentKind(url);
    }
    const wrap = document.createElement('div');
    wrap.className = `thread-attach thread-attach--${kind} ${mine ? 'thread-attach--mine' : ''} ${
      afterText ? 'thread-attach--after-text' : ''
    }`;
    wrap.setAttribute('data-thread-attach', '');

    if (kind === 'video') {
      const shell = document.createElement('div');
      shell.className = 'thread-attach__shell thread-attach__shell--video';
      const video = document.createElement('video');
      video.className = 'thread-attach__video';
      video.src = url;
      video.controls = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.referrerPolicy = 'no-referrer';
      shell.appendChild(video);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'thread-attach__zoom';
      btn.setAttribute('data-thread-lightbox-open', '');
      btn.setAttribute('data-thread-lightbox-type', 'video');
      btn.setAttribute('data-thread-lightbox-src', url);
      btn.setAttribute('aria-label', 'Expand video');
      btn.innerHTML = '<i class="bi bi-arrows-fullscreen" aria-hidden="true"></i>';
      shell.appendChild(btn);
      wrap.appendChild(shell);
    } else if (kind === 'image') {
      const shell = document.createElement('div');
      shell.className = 'thread-attach__shell thread-attach__shell--image';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'thread-attach__img-btn';
      btn.setAttribute('data-thread-lightbox-open', '');
      btn.setAttribute('data-thread-lightbox-type', 'image');
      btn.setAttribute('data-thread-lightbox-src', url);
      btn.setAttribute('aria-label', 'View image full size');
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'Attachment';
      img.className = 'thread-attach__img';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      btn.appendChild(img);
      shell.appendChild(btn);
      wrap.appendChild(shell);
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.className = 'thread-attach__file card-surface';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.innerHTML =
        '<i class="bi bi-file-earmark-arrow-down" aria-hidden="true"></i><span>Open attachment</span>';
      wrap.appendChild(a);
    }
    bubble.appendChild(wrap);
  }

  function appendMessage(m) {
    if (list.querySelector(`[data-msg-id="${String(m.id)}"]`)) {
      return;
    }
    const mine = String(m.authorUserId) === String(cfg.userId);
    const name = participantName(m.authorUserId);
    const prev = lastChatMessageRow();
    const cluster =
      prev &&
      prev.dataset.authorUserId &&
      String(prev.dataset.authorUserId) === String(m.authorUserId);

    const row = document.createElement('div');
    row.className = `thread-discord__msg${mine ? ' thread-discord__msg--mine' : ''}${
      cluster ? ' thread-discord__msg--cluster' : ''
    } thread-discord__msg--pop`;
    row.dataset.msgId = String(m.id);
    row.dataset.authorUserId = String(m.authorUserId);
    row.setAttribute('role', 'listitem');

    const av = document.createElement('div');
    av.className = mine ? 'thread-discord__avatar thread-discord__avatar--mine' : 'thread-discord__avatar';
    if (cluster) {
      av.classList.add('thread-discord__avatar--cluster');
    }
    av.setAttribute('aria-hidden', 'true');
    av.textContent = avatarLetter(name);

    const stack = document.createElement('div');
    stack.className = 'thread-discord__stack';

    if (!cluster) {
      const meta = document.createElement('div');
      meta.className = 'thread-discord__msg-meta';
      const strong = document.createElement('strong');
      strong.className = 'thread-discord__msg-author';
      strong.textContent = name;
      meta.appendChild(strong);
      stack.appendChild(meta);
    }

    const bubble = document.createElement('div');
    bubble.className = `thread-discord__bubble${mine ? ' thread-discord__bubble--mine' : ' thread-discord__bubble--them'}`;

    const richWrap = document.createElement('div');
    richWrap.className = 'thread-discord__bubble-rich';
    const text = String(m.body || '').trim();
    const html = String(m.bodyHtml || '').trim();
    if (html) {
      const tpl = document.createElement('template');
      tpl.innerHTML = html;
      richWrap.appendChild(tpl.content);
    } else if (text) {
      const p = document.createElement('p');
      p.className = 'thread-discord__bubble-text mb-0';
      p.style.whiteSpace = 'pre-wrap';
      p.textContent = m.body || '';
      richWrap.appendChild(p);
    }
    bubble.appendChild(richWrap);

    appendThreadAttachment(bubble, m, mine, !!text || !!html);

    const stampWrap = document.createElement('div');
    stampWrap.className = 'thread-discord__msg-stamp-wrap';
    const timeEl = document.createElement('time');
    timeEl.className = 'thread-discord__msg-stamp';
    const iso = toIsoAttr(m.createdAt);
    if (iso) {
      timeEl.dateTime = iso;
    }
    timeEl.textContent = formatTime(m.createdAt);
    stampWrap.appendChild(timeEl);

    stack.appendChild(bubble);
    stack.appendChild(stampWrap);

    if (mine) {
      row.appendChild(stack);
      row.appendChild(av);
    } else {
      row.appendChild(av);
      row.appendChild(stack);
    }

    const near = isNearBottom(scroller);
    list.appendChild(row);
    if (near) {
      scroller.scrollTop = scroller.scrollHeight;
    }

    state.lastMessageId = Math.max(state.lastMessageId, Number(m.id) || 0);
  }

  window.__threadPollAppendMessage = appendMessage;

  const baseMs = Math.min(Math.max(Number(cfg.pollMs) || 4000, 2500), 15000);
  const maxBackoffMs = 60000;
  let timer = null;

  function clearTimer() {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function nextDelayMs() {
    if (state.failureStreak <= 0) {
      return baseMs;
    }
    const mult = Math.min(32, 2 ** Math.min(state.failureStreak, 5));
    return Math.min(maxBackoffMs, baseMs * mult);
  }

  function schedulePoll(delayMs) {
    clearTimer();
    timer = setTimeout(() => {
      runPoll();
    }, delayMs);
  }

  async function runPoll() {
    try {
      const url = `${cfg.pollUrl}?after=${encodeURIComponent(String(state.lastMessageId))}`;
      const headers = { Accept: 'application/json' };
      if (state.pollEtag) {
        headers['If-None-Match'] = state.pollEtag;
      }
      const res = await fetch(url, {
        credentials: 'same-origin',
        headers,
      });

      if (res.status === 401) {
        window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }

      if (res.status === 304) {
        state.failureStreak = 0;
        schedulePoll(baseMs);
        return;
      }

      if (!res.ok) {
        state.failureStreak = Math.min(state.failureStreak + 1, 10);
        schedulePoll(nextDelayMs());
        return;
      }

      const nextEtag = res.headers.get('ETag');
      if (nextEtag) {
        state.pollEtag = nextEtag;
        try {
          if (etagKey && typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem(etagKey, nextEtag);
          }
        } catch (_e) {
          /* ignore */
        }
      }

      let data;
      try {
        data = await res.json();
      } catch (_e) {
        data = null;
      }
      if (!data || !data.ok) {
        state.failureStreak = Math.min(state.failureStreak + 1, 10);
        schedulePoll(nextDelayMs());
        return;
      }

      state.failureStreak = 0;

      if (
        data.meta &&
        (data.meta.contactStatus !== state.contactStatus || data.meta.itemStatus !== state.itemStatus)
      ) {
        window.location.reload();
        return;
      }

      const arr = Array.isArray(data.messages) ? data.messages : [];
      for (let i = 0; i < arr.length; i += 1) {
        appendMessage(arr[i]);
      }

      schedulePoll(baseMs);
    } catch (_e) {
      state.failureStreak = Math.min(state.failureStreak + 1, 10);
      schedulePoll(nextDelayMs());
    }
  }

  schedulePoll(0);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimer();
    } else {
      schedulePoll(0);
    }
  });

  /* Mobile / coarse pointer: tap a message row to show timestamp; tap outside clears */
  if (threadRoot && list) {
    const fineHover = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    list.addEventListener('click', (e) => {
      if (fineHover()) return;
      const row = e.target.closest('.thread-discord__msg');
      if (!row || !list.contains(row)) return;
      if (e.target.closest('a[href], button, label, textarea, input, video')) return;
      const wasOpen = row.classList.contains('thread-discord__msg--stamp-open');
      list.querySelectorAll('.thread-discord__msg--stamp-open').forEach((el) => {
        el.classList.remove('thread-discord__msg--stamp-open');
      });
      if (!wasOpen) {
        row.classList.add('thread-discord__msg--stamp-open');
      }
    });
    document.addEventListener('click', (e) => {
      if (!threadRoot.contains(e.target)) return;
      if (e.target.closest('.thread-discord__msg')) return;
      list.querySelectorAll('.thread-discord__msg--stamp-open').forEach((el) => {
        el.classList.remove('thread-discord__msg--stamp-open');
      });
    });
  }
})();
