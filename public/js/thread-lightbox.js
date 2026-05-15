(() => {
  const root = document.getElementById('thread-media-lightbox');
  if (!root) return;

  const backdrop = root.querySelector('[data-thread-lightbox-backdrop]');
  const closeBtn = root.querySelector('[data-thread-lightbox-close]');
  const img = root.querySelector('[data-thread-lightbox-img]');
  const video = root.querySelector('[data-thread-lightbox-video]');
  const panel = root.querySelector('[data-thread-lightbox-panel]');

  function hideAllMedia() {
    if (img) {
      img.classList.add('hidden');
      img.removeAttribute('src');
    }
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.classList.add('hidden');
      try {
        video.load();
      } catch (_e) {
        /* ignore */
      }
    }
  }

  function close() {
    root.classList.add('hidden');
    root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('thread-lightbox-open');
    hideAllMedia();
  }

  function open(type, src) {
    const u = String(src || '').trim();
    if (!u) return;
    hideAllMedia();
    root.classList.remove('hidden');
    root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('thread-lightbox-open');
    if (type === 'video' && video) {
      video.classList.remove('hidden');
      video.src = u;
      try {
        video.play().catch(() => {});
      } catch (_e) {
        /* ignore */
      }
    } else if (img) {
      img.classList.remove('hidden');
      img.src = u;
    }
    if (closeBtn) {
      closeBtn.focus({ preventScroll: true });
    } else if (panel) {
      panel.focus({ preventScroll: true });
    }
  }

  document.addEventListener(
    'click',
    (e) => {
      const btn = e.target.closest('[data-thread-lightbox-open]');
      if (!btn) return;
      const t = String(btn.getAttribute('data-thread-lightbox-type') || 'image').toLowerCase();
      const src = btn.getAttribute('data-thread-lightbox-src');
      if (!src) return;
      e.preventDefault();
      open(t === 'video' ? 'video' : 'image', src);
    },
    false
  );

  if (backdrop) {
    backdrop.addEventListener('click', () => close());
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', () => close());
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (root.classList.contains('hidden')) return;
    close();
  });
})();
