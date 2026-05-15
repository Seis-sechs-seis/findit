(() => {
  const root = document.querySelector('[data-thread-composer-root]');
  const form = document.querySelector('[data-thread-composer]');
  const fileInput = document.querySelector('[data-thread-attachment-input]');
  const trigger = document.querySelector('[data-thread-attach-trigger]');
  const dock = document.querySelector('[data-thread-attachment-dock]');
  const previewImg = dock?.querySelector('[data-thread-attachment-preview-img]');
  const previewVideo = dock?.querySelector('[data-thread-attachment-preview-video]');
  const clearBtn = dock?.querySelector('[data-thread-attachment-clear]');
  const fileNameEl = dock?.querySelector('[data-thread-attachment-filename]');
  const progressTrack = root?.querySelector('[data-thread-composer-progress-track]');
  const progressLine = root?.querySelector('[data-thread-composer-progress-line]');
  const errorEl = root?.querySelector('[data-thread-composer-error]');
  const ta = form?.querySelector('#thread-message');

  if (
    !root ||
    !form ||
    !fileInput ||
    !trigger ||
    !dock ||
    !previewImg ||
    !previewVideo ||
    !clearBtn ||
    !fileNameEl
  ) {
    return;
  }

  const MAX_BYTES = 12 * 1024 * 1024;
  const ALLOWED_TYPES = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|quicktime))$/i;

  function fileLooksAllowed(file) {
    const t = String(file.type || '').toLowerCase();
    if (ALLOWED_TYPES.test(t)) return true;
    const n = String(file.name || '').toLowerCase();
    return /\.(jpe?g|png|webp|gif|mp4|webm|mov)$/i.test(n);
  }

  let objectUrl = null;
  let inFlight = false;

  const submitBtn = form.querySelector('button[type="submit"]');

  const toastQuick = (type, message) => {
    if (
      typeof window.finditFeedback !== 'undefined' &&
      typeof window.finditFeedback.showToast === 'function'
    ) {
      window.finditFeedback.showToast({ type, message, duration: type === 'error' ? 4800 : 3600 });
    } else {
      window.alert(message);
    }
  };

  function applyUnreadCount(n) {
    const v = Math.max(0, Math.floor(Number(n) || 0));
    document.querySelectorAll('a[href="/requests"]').forEach((a) => {
      const label =
        v > 0
          ? a.classList.contains('nav-icon-btn')
            ? `Requests inbox, ${v} unread`
            : `Requests, ${v} unread`
          : a.classList.contains('nav-icon-btn')
            ? 'Requests inbox'
            : 'Requests';
      a.setAttribute('aria-label', label);
      if (a.title === 'Requests inbox' || a.getAttribute('title') === 'Requests inbox') {
        a.setAttribute('title', v > 0 ? `Requests inbox, ${v} unread` : 'Requests inbox');
      }
      let badge = a.querySelector('.app-requests-badge');
      if (v > 0) {
        if (!badge) {
          badge = document.createElement('span');
          if (a.classList.contains('nav-icon-btn')) {
            badge.className = 'app-requests-badge app-requests-badge--icon';
          } else if (a.classList.contains('drawer-link')) {
            badge.className = 'app-requests-badge app-requests-badge--drawer';
          } else {
            badge.className = 'app-requests-badge app-requests-badge--menu';
          }
          a.appendChild(badge);
        }
        badge.textContent = v > 99 ? '99+' : String(v);
        badge.title = `${v} unread`;
      } else if (badge) {
        badge.remove();
      }
    });
  }

  function setInlineError(msg) {
    if (!errorEl) return;
    if (msg) {
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
    } else {
      errorEl.textContent = '';
      errorEl.classList.add('hidden');
    }
  }

  function setProgressState(state, pct) {
    if (!progressTrack || !progressLine) return;
    if (state === 'idle') {
      progressTrack.classList.add('opacity-0');
      progressLine.classList.remove('thread-composer-progress-line--indeterminate');
      progressLine.style.width = '';
      return;
    }
    progressTrack.classList.remove('opacity-0');
    if (state === 'upload') {
      progressLine.classList.remove('thread-composer-progress-line--indeterminate');
      const p = Math.min(100, Math.max(0, Number(pct) || 0));
      progressLine.style.width = `${p}%`;
    } else {
      progressLine.classList.add('thread-composer-progress-line--indeterminate');
      progressLine.style.width = '';
    }
  }

  function setInFlight(on) {
    inFlight = on;
    if (submitBtn) {
      submitBtn.disabled = on;
      submitBtn.classList.toggle('fi-composer-busy', on);
      submitBtn.setAttribute('aria-busy', on ? 'true' : 'false');
    }
    if (on) {
      clearBtn.setAttribute('disabled', 'disabled');
    } else {
      clearBtn.removeAttribute('disabled');
    }
  }

  function hideDock() {
    dock.classList.add('hidden');
    dock.setAttribute('aria-hidden', 'true');
  }

  function showDock() {
    dock.classList.remove('hidden');
    dock.setAttribute('aria-hidden', 'false');
  }

  function clearPreview() {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    previewImg.removeAttribute('src');
    previewImg.classList.add('hidden');
    try {
      previewVideo.pause();
    } catch (_e) {
      /* ignore */
    }
    previewVideo.removeAttribute('src');
    previewVideo.classList.add('hidden');
    fileInput.value = '';
    fileNameEl.textContent = '';
    hideDock();
  }

  function showPreview(file) {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
    objectUrl = URL.createObjectURL(file);
    const isVideo = /^video\//i.test(file.type || '') || /\.(mp4|webm|mov)$/i.test(file.name || '');
    if (isVideo) {
      previewImg.classList.add('hidden');
      previewImg.removeAttribute('src');
      previewVideo.classList.remove('hidden');
      previewVideo.src = objectUrl;
      try {
        previewVideo.load();
      } catch (_e) {
        /* ignore */
      }
    } else {
      previewVideo.classList.add('hidden');
      previewVideo.removeAttribute('src');
      previewImg.src = objectUrl;
      previewImg.classList.remove('hidden');
    }
    fileNameEl.textContent = file.name || (isVideo ? 'Video' : 'Image');
    showDock();
  }

  function pickFileFromList(files) {
    if (!files || !files.length) return null;
    const f = files[0];
    if (!fileLooksAllowed(f)) {
      toastQuick('error', 'Please choose a JPG, PNG, WEBP, GIF image or MP4, WEBM, MOV video.');
      return null;
    }
    if (f.size > MAX_BYTES) {
      toastQuick('error', 'Attachment must be 12 MB or smaller.');
      return null;
    }
    return f;
  }

  function assignFileToInput(file) {
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
    } catch (_e) {
      /* DataTransfer unsupported — user can re-pick */
      toastQuick('error', 'Could not attach this file here. Use the paperclip to choose a file.');
      return false;
    }
    return true;
  }

  function handleJsonResponse(res, rawText) {
    if (res.status === 401) {
      window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return { ok: false, message: '', auth: true };
    }
    let data = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (_e) {
      data = {};
    }
    if (!res.ok || !data || data.ok !== true) {
      const msg =
        (data && data.message) ||
        (res.status === 429 ? 'Too many requests. Wait a moment.' : 'Could not send. Try again.');
      return { ok: false, message: msg };
    }
    return { ok: true, data };
  }

  function dispatchMessage(m) {
    if (typeof window.__threadPollAppendMessage === 'function') {
      window.__threadPollAppendMessage(m);
    } else {
      window.location.reload();
    }
  }

  function threadCsrfToken() {
    return (
      (typeof window !== 'undefined' && window.__FINDIT_CSRF__) ||
      document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ||
      ''
    );
  }

  trigger.addEventListener('click', () => fileInput.click());

  clearBtn.addEventListener('click', () => {
    if (inFlight) return;
    clearPreview();
  });

  fileInput.addEventListener('change', () => {
    if (inFlight) return;
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      clearPreview();
      return;
    }
    const ok = pickFileFromList([file]);
    if (!ok) {
      clearPreview();
      return;
    }
    showPreview(ok);
  });

  form.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  form.addEventListener('drop', (e) => {
    e.preventDefault();
    if (inFlight) return;
    const file = pickFileFromList(e.dataTransfer && e.dataTransfer.files);
    if (!file) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) clearPreview();
      return;
    }
    if (!assignFileToInput(file)) return;
    showPreview(file);
  });

  root.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    if (inFlight) return;
    const file = pickFileFromList(e.dataTransfer && e.dataTransfer.files);
    if (!file) return;
    if (!assignFileToInput(file)) return;
    showPreview(file);
  });

  if (ta) {
    ta.addEventListener('paste', (e) => {
      if (inFlight) return;
      const items = e.clipboardData && e.clipboardData.items;
      if (!items || !items.length) return;
      for (let i = 0; i < items.length; i += 1) {
        const it = items[i];
        if (it.kind !== 'file') continue;
        const f = it.getAsFile();
        if (!f) continue;
        const ok = pickFileFromList([f]);
        if (!ok) continue;
        e.preventDefault();
        if (!assignFileToInput(ok)) return;
        showPreview(ok);
        break;
      }
    });
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = ta && ta.value ? ta.value.trim() : '';
    const hasFile = fileInput.files && fileInput.files.length > 0;
    if (!text && !hasFile) {
      return;
    }
    if (inFlight) {
      return;
    }
    setInlineError('');
    setInFlight(true);

    const url = form.action;
    const csrf = threadCsrfToken();
    const headers = {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    };
    if (csrf) {
      headers['X-CSRF-Token'] = csrf;
    }

    if (hasFile) {
      const fd = new FormData();
      fd.append('message', text);
      fd.append('attachment', fileInput.files[0]);
      if (csrf) {
        fd.append('_csrf', csrf);
      }

      setProgressState('upload', 0);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.withCredentials = true;
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      if (csrf) {
        xhr.setRequestHeader('X-CSRF-Token', csrf);
      }

      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && ev.total > 0) {
          const pct = Math.round((100 * ev.loaded) / ev.total);
          setProgressState('upload', pct);
        }
      };

      xhr.onerror = () => {
        setProgressState('idle');
        setInlineError('Network error. Try again.');
        setInFlight(false);
      };

      xhr.onload = () => {
        setProgressState('idle');
        const raw = xhr.responseText || '';
        const result = handleJsonResponse(
          { status: xhr.status, ok: xhr.status >= 200 && xhr.status < 300 },
          raw
        );
        if (result.auth) {
          setInFlight(false);
          return;
        }
        if (!result.ok) {
          setInlineError(result.message || 'Could not send.');
          setInFlight(false);
          return;
        }
        const { data } = result;
        if (data.message) {
          dispatchMessage(data.message);
        }
        if (data.requestsUnreadCount != null) {
          applyUnreadCount(data.requestsUnreadCount);
        }
        if (ta) ta.value = '';
        clearPreview();
        setInFlight(false);
      };

      xhr.send(fd);
      return;
    }

    const fd = new FormData();
    fd.append('message', text);
    if (csrf) {
      fd.append('_csrf', csrf);
    }

    setProgressState('indeterminate');

    fetch(url, {
      method: 'POST',
      body: fd,
      credentials: 'same-origin',
      headers,
    })
      .then(async (res) => {
        const raw = await res.text();
        const result = handleJsonResponse(res, raw);
        if (result.auth) {
          return null;
        }
        if (!result.ok) {
          setInlineError(result.message || 'Could not send.');
          return null;
        }
        return result.data;
      })
      .then((data) => {
        setProgressState('idle');
        if (!data) return;
        if (data.message) {
          dispatchMessage(data.message);
        }
        if (data.requestsUnreadCount != null) {
          applyUnreadCount(data.requestsUnreadCount);
        }
        if (ta) ta.value = '';
      })
      .catch(() => {
        setProgressState('idle');
        setInlineError('Network error. Try again.');
      })
      .finally(() => {
        setInFlight(false);
      });
  });

  window.addEventListener('pageshow', (ev) => {
    if (ev.persisted) {
      setProgressState('idle');
      setInFlight(false);
      clearPreview();
    }
  });
})();
