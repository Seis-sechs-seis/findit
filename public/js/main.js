document.addEventListener('DOMContentLoaded', () => {
  const root = document.documentElement;
  const getTheme = () => root.getAttribute('data-bs-theme') || 'light';
  const setTheme = (theme) => {
    root.setAttribute('data-bs-theme', theme);
    root.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('findit-theme', theme);
    } catch (_e) {}
    const dark = theme === 'dark';
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      const icon = btn.querySelector('i');
      const label = btn.querySelector('[data-theme-toggle-label]');
      if (icon) {
        icon.className = dark ? 'bi bi-sun' : 'bi bi-moon-stars';
      }
      if (label) {
        label.textContent = dark ? 'Light' : 'Dark';
      }
      btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    });
  };

  setTheme(getTheme());
  document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const reduceMotionClick =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!reduceMotionClick) {
        btn.classList.remove('theme-icon-anim');
        void btn.offsetWidth;
        btn.classList.add('theme-icon-anim');
      }
      const next = getTheme() === 'dark' ? 'light' : 'dark';
      setTheme(next);
    });
  });

  const reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!reduceMotion) {
    document.documentElement.classList.add('scroll-animations-ready');
  }

  // Scroll-in animations: add .is-visible when element enters viewport
  const animated = document.querySelectorAll('[data-animate]');
  if (!reduceMotion && animated.length && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.04 }
    );
    animated.forEach((el) => observer.observe(el));
  } else if (reduceMotion) {
    animated.forEach((el) => el.classList.add('is-visible'));
  }

  // Hero: stagger reveals on first paint (CSS keyframes tied to .is-visible)
  const heroInner = document.querySelector('.hero-section .hero-inner');
  if (heroInner) {
    const reveal = () => heroInner.classList.add('is-visible');
    if (reduceMotion || !('requestAnimationFrame' in window)) {
      reveal();
    } else {
      requestAnimationFrame(() => requestAnimationFrame(reveal));
    }
  }

  document.querySelectorAll('.alert-dismissible').forEach((alert) => {
    setTimeout(() => {
      if (window.finditFeedback && typeof window.finditFeedback.dismissInlineAlert === 'function') {
        if (alert.classList.contains('fi-notice')) {
          window.finditFeedback.dismissInlineAlert(alert);
          return;
        }
      }
      if (typeof alert.remove === 'function') {
        alert.remove();
      } else {
        alert.classList.add('d-none');
      }
    }, 5000);
  });

  // DEFAULT DATE to today on report form
  const dateInput = document.getElementById('date');
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }

  // CHARACTER COUNTER for description
  const descriptionField = document.getElementById('description');
  if (descriptionField) {
    const counter = document.createElement('div');
    counter.className = 'form-text text-end';
    counter.textContent = `${descriptionField.value.length} characters`;
    descriptionField.parentNode.appendChild(counter);

    descriptionField.addEventListener('input', () => {
      counter.textContent = `${descriptionField.value.length} characters`;
    });
  }

  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (e) => {
      const targetId = anchor.getAttribute('href');
      if (targetId === '#') return;
      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
      }
    });
  });

  // Mobile drawer navbar
  const drawerPanel = document.querySelector('[data-drawer-panel]');
  const drawerBackdrop = document.querySelector('[data-drawer-backdrop]');
  const openButtons = document.querySelectorAll('[data-drawer-open]');
  const closeButtons = document.querySelectorAll('[data-drawer-close]');

  if (drawerPanel && drawerBackdrop && openButtons.length) {
    let lastActiveEl = null;
    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const setDrawerOpen = (open) => {
      drawerPanel.classList.toggle('is-open', open);
      drawerPanel.setAttribute('aria-hidden', String(!open));
      drawerBackdrop.toggleAttribute('hidden', !open);
      openButtons.forEach((btn) => btn.setAttribute('aria-expanded', String(open)));
    };

    const openDrawer = () => {
      lastActiveEl = document.activeElement;
      setDrawerOpen(true);
      const firstClose = closeButtons[0] || drawerPanel.querySelector('[data-drawer-close]');
      if (firstClose && typeof firstClose.focus === 'function') firstClose.focus();
    };

    const closeDrawer = () => {
      setDrawerOpen(false);
      if (lastActiveEl && typeof lastActiveEl.focus === 'function') lastActiveEl.focus();
    };

    openButtons.forEach((btn) => btn.addEventListener('click', openDrawer));
    closeButtons.forEach((btn) => btn.addEventListener('click', closeDrawer));
    drawerBackdrop.addEventListener('click', closeDrawer);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && drawerPanel.classList.contains('is-open')) {
        const focusables = Array.from(drawerPanel.querySelectorAll(focusableSelector));
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
      if (e.key === 'Escape' && drawerPanel.classList.contains('is-open')) {
        closeDrawer();
      }
    });

    // Close the drawer when a navigation link is activated.
    drawerPanel.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', closeDrawer);
    });

    // Drawer accordion behavior: keep only one expandable section open.
    const expandableSections = drawerPanel.querySelectorAll('.app-drawer__expand');
    if (expandableSections.length) {
      expandableSections.forEach((section) => {
        section.addEventListener('toggle', () => {
          if (!section.open) return;
          expandableSections.forEach((other) => {
            if (other !== section) {
              other.removeAttribute('open');
            }
          });
        });
      });
    }

    // Prevent body scroll while drawer is open.
    const observer = new MutationObserver(() => {
      document.body.style.overflow = drawerPanel.classList.contains('is-open') ? 'hidden' : '';
    });
    observer.observe(drawerPanel, { attributes: true, attributeFilter: ['class'] });
  }

  // Close open nav dropdown details when clicking elsewhere.
  const navDetails = document.querySelectorAll('.app-dropdown');
  if (navDetails.length) {
    document.addEventListener('click', (event) => {
      navDetails.forEach((detail) => {
        if (!detail.contains(event.target)) {
          detail.removeAttribute('open');
        }
      });
    });
  }

  // Verify email resend cooldown timer.
  const resendForm = document.querySelector('[data-otp-resend]');
  if (resendForm) {
    const button = resendForm.querySelector('[data-resend-button]');
    const label = resendForm.querySelector('[data-resend-label]');
    const hint = resendForm.querySelector('[data-resend-hint]');
    const cooldown = Number(resendForm.getAttribute('data-resend-cooldown')) || 60;
    let remaining = cooldown;
    let timerId = null;

    const renderCountdown = () => {
      if (!button || !label || !hint) return;
      if (remaining > 0) {
        button.disabled = true;
        label.textContent = `Resend in ${remaining}s`;
        hint.textContent = '';
      } else {
        button.disabled = false;
        label.textContent = 'Resend code';
        hint.textContent = 'Did not receive it? Resend now.';
      }
    };

    renderCountdown();
    if (remaining > 0) {
      timerId = window.setInterval(() => {
        remaining -= 1;
        renderCountdown();
        if (remaining <= 0 && timerId) {
          window.clearInterval(timerId);
        }
      }, 1000);
    }

    resendForm.addEventListener('submit', () => {
      if (button) {
        button.disabled = true;
      }
    });
  }
});
