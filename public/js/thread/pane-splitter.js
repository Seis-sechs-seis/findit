/**
 * Mobile (≤991px): drag handle at top of chat column resizes listing vs chat (CSS grid rows).
 * Double-click handle resets to default layout. Desktop clears any inline rows.
 */
(function () {
  const root = document.getElementById('contact-thread-root');
  if (!root) return;

  const layout = root.querySelector('.contact-thread-layout');
  const aside = root.querySelector('.thread-discord-side');
  const splitter = root.querySelector('[data-thread-pane-splitter]');
  if (!layout || !aside || !splitter) return;

  const mq = window.matchMedia('(max-width: 991px)');
  let dragging = false;
  let startY = 0;
  let startAsideH = 0;

  function narrow() {
    return mq.matches;
  }

  function maxListingPx() {
    const vh = window.innerHeight || document.documentElement.clientHeight || 600;
    const natural = aside.scrollHeight || 0;
    return Math.max(72, Math.min(natural + 32, vh * 0.72));
  }

  function setListingRowPx(h) {
    const x = Math.max(0, Math.min(maxListingPx(), Math.round(h)));
    layout.style.gridTemplateRows = `${x}px minmax(0, 1fr)`;
  }

  function clearCustomRows() {
    layout.style.gridTemplateRows = '';
  }

  function onViewportMode() {
    if (!narrow()) {
      dragging = false;
      document.body.classList.remove('thread-pane-resizing');
      clearCustomRows();
    }
  }

  splitter.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !narrow()) return;
    e.preventDefault();
    dragging = true;
    startY = e.clientY;
    startAsideH = aside.getBoundingClientRect().height;
    setListingRowPx(startAsideH);
    splitter.setPointerCapture(e.pointerId);
    document.body.classList.add('thread-pane-resizing');
  });

  splitter.addEventListener('pointermove', (e) => {
    if (!dragging || !narrow()) return;
    const dy = e.clientY - startY;
    setListingRowPx(startAsideH + dy);
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('thread-pane-resizing');
    if (e && typeof e.pointerId === 'number') {
      try {
        splitter.releasePointerCapture(e.pointerId);
      } catch (_err) {
        /* ignore */
      }
    }
  }

  splitter.addEventListener('pointerup', endDrag);
  splitter.addEventListener('pointercancel', endDrag);
  splitter.addEventListener('lostpointercapture', () => {
    dragging = false;
    document.body.classList.remove('thread-pane-resizing');
  });

  splitter.addEventListener('dblclick', () => {
    if (!narrow()) return;
    clearCustomRows();
  });

  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', onViewportMode);
  } else if (typeof mq.addListener === 'function') {
    mq.addListener(onViewportMode);
  }
  onViewportMode();
})();
