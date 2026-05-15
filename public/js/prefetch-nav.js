/**
 * Warm likely navigations: prefetch same-origin HTML on pointer down (before click completes).
 * Complements browser cache; safe no-op for external / hash-only / modifier clicks.
 */
(function prefetchNav() {
  const prefetched = new Set();
  const origin = window.location.origin;

  function prefetchDocument(url) {
    if (prefetched.has(url)) {
      return;
    }
    prefetched.add(url);
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = url;
    link.as = 'document';
    document.head.appendChild(link);
  }

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }
      const anchor = event.target && event.target.closest && event.target.closest('a[href]');
      if (!anchor || anchor.target === '_blank' || anchor.getAttribute('download')) {
        return;
      }
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) {
        return;
      }
      let url;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== origin) {
        return;
      }
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return;
      }
      prefetchDocument(url.pathname + url.search + url.hash);
    },
    { capture: true, passive: true }
  );
})();
