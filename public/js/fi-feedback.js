/**
 * FindIt feedback: polished alerts, toasts, and enhancement hooks.
 * Respects prefers-reduced-motion.
 */
(function () {
  const reduceMotion = () =>
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const ICONS = {
    danger: 'bi-exclamation-circle',
    success: 'bi-check-circle',
    warning: 'bi-exclamation-triangle',
    info: 'bi-info-circle',
  };

  function typeFromAlert(el) {
    if (el.classList.contains('alert-danger')) return 'danger';
    if (el.classList.contains('alert-success')) return 'success';
    if (el.classList.contains('alert-warning')) return 'warning';
    if (el.classList.contains('alert-info')) return 'info';
    return 'info';
  }

  function resetEnhancement(el) {
    if (!el || el.nodeType !== 1) return;
    el.removeAttribute('data-fi-enhanced');
    el.classList.remove(
      'fi-notice',
      'fi-notice--in',
      'fi-notice--out',
      'fi-notice--danger',
      'fi-notice--success',
      'fi-notice--warning',
      'fi-notice--info',
      'fi-notice--shake-once',
      'fi-notice--no-leading-icon'
    );
    const icon = el.querySelector(':scope > .fi-notice__icon');
    const body = el.querySelector(':scope > .fi-notice__body');
    if (body) {
      while (body.firstChild) {
        el.insertBefore(body.firstChild, body);
      }
      body.remove();
    }
    if (icon) icon.remove();
  }

  function enhanceAlert(el) {
    if (!el || el.nodeType !== 1) return;
    if (!el.classList.contains('alert') || el.getAttribute('role') !== 'alert') return;
    if (el.dataset.fiEnhanced === '1') return;
    if (el.classList.contains('d-none') && !String(el.textContent || '').trim()) return;

    const type = typeFromAlert(el);
    const skipLeading = el.getAttribute('data-fi-leading-icon') === '0';

    el.dataset.fiEnhanced = '1';
    el.classList.add('fi-notice', `fi-notice--${type}`);
    if (skipLeading) {
      el.classList.add('fi-notice--no-leading-icon');
    }

    const body = document.createElement('div');
    body.className = 'fi-notice__body';
    while (el.firstChild) {
      body.appendChild(el.firstChild);
    }
    el.appendChild(body);

    if (!skipLeading) {
      const iconWrap = document.createElement('div');
      iconWrap.className = `fi-notice__icon fi-notice__icon--${type}`;
      iconWrap.setAttribute('aria-hidden', 'true');
      const i = document.createElement('i');
      i.className = `bi ${ICONS[type] || ICONS.info}`;
      iconWrap.appendChild(i);
      el.insertBefore(iconWrap, body);
    }

    if (!reduceMotion() && type === 'danger') {
      el.classList.add('fi-notice--shake-once');
      el.addEventListener(
        'animationend',
        () => {
          el.classList.remove('fi-notice--shake-once');
        },
        { once: true }
      );
    }

    const dismissMs = Number(el.getAttribute('data-fi-dismiss-ms') || '');
    if (Number.isFinite(dismissMs) && dismissMs > 0 && type === 'success') {
      window.setTimeout(() => dismissInlineAlert(el), dismissMs);
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.classList.add('fi-notice--in');
      });
    });
  }

  function dismissInlineAlert(el) {
    if (!el || !el.parentNode) return;
    if (reduceMotion()) {
      el.remove();
      return;
    }
    el.classList.add('fi-notice--out');
    el.addEventListener(
      'transitionend',
      () => {
        if (el.parentNode) el.remove();
      },
      { once: true }
    );
    window.setTimeout(() => {
      if (el.parentNode && el.classList.contains('fi-notice--out')) {
        el.remove();
      }
    }, 400);
  }

  function initDocumentAlerts() {
    document.querySelectorAll('.alert[role="alert"]:not([data-fi-skip])').forEach((el) => {
      try {
        enhanceAlert(el);
      } catch (_e) {
        /* ignore */
      }
    });
  }

  let toastSeq = 0;
  const MAX_TOASTS = 4;
  const DEFAULT_DURATION = 4200;

  function getStack() {
    let stack = document.getElementById('fi-toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'fi-toast-stack';
      stack.className = 'fi-toast-stack';
      stack.setAttribute('aria-live', 'polite');
      stack.setAttribute('aria-relevant', 'additions');
      document.body.appendChild(stack);
    }
    return stack;
  }

  function removeToastNode(node) {
    if (!node || !node.parentNode) return;
    if (reduceMotion()) {
      node.remove();
      return;
    }
    node.classList.add('fi-toast--leave');
    node.addEventListener(
      'transitionend',
      () => node.remove(),
      { once: true }
    );
    window.setTimeout(() => {
      if (node.parentNode) node.remove();
    }, 320);
  }

  function showToast(opts) {
    const type = ['success', 'error', 'warning', 'info'].includes(opts && opts.type) ? opts.type : 'info';
    const message = String((opts && opts.message) || '').trim();
    if (!message) return null;

    const mapType = type === 'error' ? 'danger' : type;
    const bi = ICONS[mapType] || ICONS.info;

    const stack = getStack();
    while (stack.children.length >= MAX_TOASTS) {
      removeToastNode(stack.firstElementChild);
    }

    const id = `fi-toast-${++toastSeq}`;
    const node = document.createElement('div');
    node.id = id;
    node.className = `fi-toast fi-toast--${mapType}`;
    node.setAttribute('role', type === 'error' || type === 'warning' ? 'alert' : 'status');

    const icon = document.createElement('div');
    icon.className = `fi-toast__icon fi-toast__icon--${mapType}`;
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = `<i class="bi ${bi}"></i>`;

    const text = document.createElement('div');
    text.className = 'fi-toast__content';
    if (opts.title) {
      const t = document.createElement('p');
      t.className = 'fi-toast__title';
      t.textContent = opts.title;
      text.appendChild(t);
    }
    const p = document.createElement('p');
    p.className = 'fi-toast__message';
    p.textContent = message;
    text.appendChild(p);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'fi-toast__close';
    close.setAttribute('aria-label', 'Dismiss');
    close.innerHTML = '<i class="bi bi-x-lg" aria-hidden="true"></i>';
    close.addEventListener('click', () => removeToastNode(node));

    node.appendChild(icon);
    node.appendChild(text);
    node.appendChild(close);
    stack.appendChild(node);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => node.classList.add('fi-toast--in'));
    });

    const duration = Number(opts.duration);
    const ms = Number.isFinite(duration) && duration >= 0 ? duration : DEFAULT_DURATION;
    if (ms > 0) {
      window.setTimeout(() => removeToastNode(node), ms);
    }

    return id;
  }

  function reenhance(el) {
    if (!el) return;
    resetEnhancement(el);
    enhanceAlert(el);
  }

  window.finditFeedback = {
    enhanceAlert,
    reenhance,
    resetEnhancement,
    dismissInlineAlert,
    showToast,
    dismissToast: (id) => {
      const n = document.getElementById(id);
      if (n) removeToastNode(n);
    },
    refresh: initDocumentAlerts,
  };

  function scheduleEnhanceNewAlerts() {
    let timer;
    return () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        document.querySelectorAll('.alert[role="alert"]:not([data-fi-skip]):not([data-fi-enhanced])').forEach((el) => {
          try {
            enhanceAlert(el);
          } catch (_e) {
            /* ignore */
          }
        });
      }, 40);
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        initDocumentAlerts();
        const run = scheduleEnhanceNewAlerts();
        try {
          new MutationObserver(run).observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'hidden'],
          });
        } catch (_e) {
          /* ignore */
        }
      },
      { once: true }
    );
  } else {
    initDocumentAlerts();
    const run = scheduleEnhanceNewAlerts();
    try {
      new MutationObserver(run).observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'hidden'],
      });
    } catch (_e) {
      /* ignore */
    }
  }
})();
