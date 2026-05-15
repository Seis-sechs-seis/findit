/** Lightweight client-only pw strength meter (signup / reset). No deps. */
(() => {
  'use strict';

  const TONE_COLORS = {
    danger: '#ef4444',
    warning: '#f59e0b',
    info: '#38bdf8',
    success: '#22c55e',
    muted: 'var(--border-strong)',
  };

  let docCloserBound = false;
  let arrowResizeBound = false;

  /** Compact checklist; symbols are one contiguous run (no spaces). */
  const HELP_INNER = `
    <p class="text-sm font-semibold text-main mb-2">Strong password</p>
    <ul class="mb-0 ps-3 text-xs text-secondary pw-help-list" style="display: grid; gap: 0.35rem;">
      <li><strong class="text-main">Length:</strong> <strong>8+</strong> characters (<strong>12+</strong> is better).</li>
      <li><strong class="text-main">Letters:</strong> upper (A–Z) and lower (a–z).</li>
      <li><strong class="text-main">Numbers:</strong> <strong>0–9</strong>.</li>
      <li class="mb-0">
        <strong class="text-main">Symbols:</strong> punctuation or specials — mix with letters/numbers.
        <code class="pw-symbols-inline text-break user-select-all" translate="no">!&quot;#$%&amp;&apos;()*+,-./:;&lt;=&gt;?@[]^_&#96;{|}~\\</code>
      </li>
    </ul>
    <p class="mb-0 mt-2 text-xs text-muted-custom">Skip names, birthdays, and obvious words.</p>
  `.trim();

  /** @param {string} p */
  function rate(p) {
    /** @typedef {{ pct: number, label: string, tone: keyof typeof BS }} R */
    if (!p.length) {
      /** @type {R} */
      const out = { pct: 0, label: '', tone: 'muted' };
      return { empty: true, ...out };
    }

    const cat = [/[a-z]/.test(p), /[A-Z]/.test(p), /\d/.test(p), /[^A-Za-z0-9]/.test(p)].filter(
      Boolean
    ).length;

    if (p.length < 8) {
      /** @type {R} */
      const out = {
        pct: Math.min(22 + Math.floor(p.length * 3), 42),
        label: 'Too short',
        tone: 'danger',
      };
      return { empty: false, ...out, showTips: true };
    }

    let tier = 1;
    if (cat >= 2 || p.length >= 12) tier = 2;
    if ((cat >= 3 && p.length >= 9) || (cat >= 2 && p.length >= 16)) tier = Math.max(tier, 3);
    if ((cat >= 4 && p.length >= 8) || (cat >= 3 && p.length >= 13)) tier = Math.max(tier, 4);

    /** @type {Record<number, R>} */
    const bands = {
      1: { pct: 34, label: 'Weak', tone: 'danger' },
      2: { pct: 54, label: 'Fair', tone: 'warning' },
      3: { pct: 78, label: 'Good', tone: 'info' },
      4: { pct: 100, label: 'Strong', tone: 'success' },
    };

    /** @type {R} */
    const out = bands[tier];
    return { empty: false, ...out, showTips: tier < 4 };
  }

  /** @param {HTMLElement} bar */
  function setBarTone(bar, tone) {
    const color = TONE_COLORS[tone] || TONE_COLORS.muted;
    bar.style.backgroundColor = color;
  }

  /** @param {HTMLElement} panel @param {HTMLButtonElement} btn */
  function closeHelp(panel, btn) {
    panel._pwSyncArrow = undefined;
    panel.style.removeProperty('--pw-arrow-x');
    panel.setAttribute('hidden', '');
    panel.classList.remove('pw-help-float-open');
    btn.setAttribute('aria-expanded', 'false');
    btn.classList.remove('is-active');
  }

  function bindArrowResizeSync() {
    if (arrowResizeBound) return;
    arrowResizeBound = true;

    let rafId = 0;
    const flushArrows = () => {
      rafId = 0;
      document.querySelectorAll('.pw-help-float-open').forEach((p) => {
        if (p instanceof HTMLElement && typeof p._pwSyncArrow === 'function') {
          p._pwSyncArrow();
        }
      });
    };
    const scheduleArrows = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(flushArrows);
    };

    window.addEventListener('resize', scheduleArrows, { passive: true });
    window.addEventListener('scroll', scheduleArrows, { passive: true });
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', scheduleArrows);
      vv.addEventListener('scroll', scheduleArrows);
    }
  }

  /** @param {HTMLInputElement} input */
  function bind(input) {
    const field = input.closest('.field, .mb-3, .mb-4');
    if (!field) return;

    const baseId = `pw-meter-${input.id || 'password'}`;
    const wrap = document.createElement('div');
    wrap.className = 'pw-meter mt-2 position-relative';
    wrap.id = baseId;
    wrap.setAttribute('hidden', '');
    wrap.innerHTML = `
      <div class="pw-meter-track" role="progressbar"
        aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-labelledby="${baseId}-lbl">
        <div class="pw-meter-bar" style="width:0%"></div>
      </div>
      <div class="pw-meter-caption">
        <span id="${baseId}-lbl" class="pw-meter-label"></span>
        <button type="button" class="pw-tip-btn"
          aria-expanded="false" aria-controls="${baseId}-help" hidden
          aria-label="Show strong password checklist">
          <i class="bi bi-lightbulb" aria-hidden="true"></i>
        </button>
      </div>
      <div id="${baseId}-help" role="dialog" aria-label="Strong password checklist" aria-modal="false"
        class="pw-help-float" hidden>
        <div class="pw-help-float__inner">${HELP_INNER}</div>
      </div>
    `.trim();

    const fb = field.querySelector('.invalid-feedback');
    if (fb) {
      fb.after(wrap);
    } else {
      field.appendChild(wrap);
    }

    const track = wrap.querySelector('.pw-meter-track');
    const bar = wrap.querySelector('.pw-meter-bar');
    const lbl = wrap.querySelector('.pw-meter-label');
    const tipBtn = wrap.querySelector('.pw-tip-btn');
    const helpPanel = wrap.querySelector('.pw-help-float');

    if (
      !(track instanceof HTMLElement) ||
      !(bar instanceof HTMLElement) ||
      !(lbl instanceof HTMLElement) ||
      !(tipBtn instanceof HTMLButtonElement) ||
      !(helpPanel instanceof HTMLElement)
    ) {
      wrap.remove();
      return;
    }

    const syncHelpArrow = () => {
      if (helpPanel.getAttribute('hidden') !== null) return;
      const wrapRect = wrap.getBoundingClientRect();
      const btnRect = tipBtn.getBoundingClientRect();
      const panelWidth = helpPanel.offsetWidth || 0;
      if (panelWidth < 8) return;

      const viewportPad = window.innerWidth <= 575 ? 8 : 12;
      const targetInset = window.innerWidth <= 575 ? 18 : 30;
      const btnCenter = btnRect.left + btnRect.width / 2;

      // Position the panel so the arrow is not pinned to the edge,
      // then clamp to viewport so it remains fully visible.
      const idealViewportLeft = btnCenter - (panelWidth - targetInset);
      const minLeft = viewportPad;
      const maxLeft = Math.max(minLeft, window.innerWidth - panelWidth - viewportPad);
      const clampedViewportLeft = Math.max(minLeft, Math.min(idealViewportLeft, maxLeft));
      const leftWithinWrap = clampedViewportLeft - wrapRect.left;

      helpPanel.style.left = `${Math.round(leftWithinWrap)}px`;
      helpPanel.style.right = 'auto';

      const panelRect = helpPanel.getBoundingClientRect();
      const center = btnCenter - panelRect.left;
      /** Keep arrow base inside panel with an edge gutter. */
      const half = window.innerWidth <= 575 ? 10 : 14;
      const clamped = Math.max(half, Math.min(center, panelRect.width - half));
      const px = `${Math.round(clamped)}px`;
      if (helpPanel.style.getPropertyValue('--pw-arrow-x') !== px) {
        helpPanel.style.setProperty('--pw-arrow-x', px);
      }
    };

    bindArrowResizeSync();

    tipBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (helpPanel.getAttribute('hidden') !== null) {
        helpPanel.removeAttribute('hidden');
        helpPanel.classList.add('pw-help-float-open');
        tipBtn.setAttribute('aria-expanded', 'true');
        tipBtn.classList.add('is-active');
        helpPanel._pwSyncArrow = syncHelpArrow;
        requestAnimationFrame(() => {
          syncHelpArrow();
        });
      } else {
        closeHelp(helpPanel, tipBtn);
      }
    });

    if (!docCloserBound) {
      docCloserBound = true;
      document.addEventListener('click', (event) => {
        if (!(event.target instanceof Element)) return;
        document.querySelectorAll('.pw-help-float-open').forEach((panel) => {
          if (!(panel instanceof HTMLElement)) return;
          const root = panel.closest('.pw-meter');
          if (root && root.contains(event.target)) return;
          const id = panel.id;
          if (!id) return;
          const btn = root && root.querySelector(`[aria-controls="${CSS.escape(id)}"]`);
          if (btn instanceof HTMLButtonElement) {
            closeHelp(panel, btn);
          }
        });
      });
    }

    /** @param {ReturnType<typeof rate>} state */
    const paint = (state) => {
      if (state.empty) {
        wrap.setAttribute('hidden', '');
        bar.style.width = '0%';
        track.setAttribute('aria-valuenow', '0');
        closeHelp(helpPanel, tipBtn);
        return;
      }

      closeHelp(helpPanel, tipBtn);

      wrap.removeAttribute('hidden');
      bar.style.width = `${state.pct}%`;
      track.setAttribute('aria-valuenow', String(Math.round(state.pct)));
      lbl.textContent = state.label;
      if (state.showTips) {
        tipBtn.removeAttribute('hidden');
      } else {
        tipBtn.setAttribute('hidden', '');
      }

      setBarTone(bar, state.tone || 'muted');
    };

    const onInput = () => paint(rate(String(input.value || '')));

    input.addEventListener('input', onInput);
    input.addEventListener('focus', onInput);
    onInput();

    window.addEventListener('pageshow', onInput);
  }

  function init() {
    document.querySelectorAll('input[data-pw-meter]').forEach((el) => {
      if (el instanceof HTMLInputElement) bind(el);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
