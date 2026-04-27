// Shared bits: Tweaks, lang, edit-mode protocol

(function () {
  const root = document.documentElement;

  // Defaults live in /*EDITMODE-BEGIN*/.../*EDITMODE-END*/ in index.html;
  // each variant page just reads window.DRIFT_TWEAKS if set.
  const defaults = window.DRIFT_TWEAKS || {
    accent: 'orange',
    density: 'comfy',
    motion: true,
    hero: 'video',
    lang: 'en',
  };

  function apply(state) {
    root.setAttribute('data-accent', state.accent);
    root.setAttribute('data-density', state.density);
    root.setAttribute('data-motion', state.motion ? 'on' : 'off');
    root.setAttribute('data-hero', state.hero);
    root.setAttribute('lang', state.lang);
  }

  let state = { ...defaults };
  window.__drift = {
    get state() { return state; },
    set(patch) {
      state = { ...state, ...patch };
      apply(state);
      try {
        window.parent.postMessage({ type: '__edit_mode_set_keys', edits: patch }, '*');
      } catch (e) {}
    },
  };
  apply(state);  window.addEventListener('message', (ev) => {
    const d = ev.data || {};
    if (d.type === '__activate_edit_mode') {
      document.querySelector('.tweaks')?.classList.add('on');
    } else if (d.type === '__deactivate_edit_mode') {
      document.querySelector('.tweaks')?.classList.remove('on');
    }
  });
  try { window.parent.postMessage({ type: '__edit_mode_available' }, '*'); } catch (e) {}

  // Tweaks panel wiring (delegated)
  document.addEventListener('click', (e) => {
    const sw = e.target.closest('[data-tweak-accent]');
    if (sw) {
      window.__drift.set({ accent: sw.dataset.tweakAccent });
      document.querySelectorAll('[data-tweak-accent]').forEach(b =>
        b.classList.toggle('on', b.dataset.tweakAccent === sw.dataset.tweakAccent));
    }
    const tg = e.target.closest('[data-tweak-toggle]');
    if (tg) {
      const key = tg.dataset.tweakToggle;
      const next = !state[key];
      window.__drift.set({ [key]: next });
      tg.classList.toggle('on', next);
    }
    const sel = e.target.closest('[data-tweak-set]');
    if (sel) {
      const [key, val] = sel.dataset.tweakSet.split(':');
      window.__drift.set({ [key]: val });
      document.querySelectorAll(`[data-tweak-set^="${key}:"]`).forEach(b =>
        b.classList.toggle('on', b.dataset.tweakSet === sel.dataset.tweakSet));
    }
  });

  // Initialize active states
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-tweak-accent]').forEach(b =>
      b.classList.toggle('on', b.dataset.tweakAccent === state.accent));
    document.querySelectorAll(`[data-tweak-set^="density:"]`).forEach(b =>
      b.classList.toggle('on', b.dataset.tweakSet === `density:${state.density}`));
    document.querySelectorAll(`[data-tweak-set^="hero:"]`).forEach(b =>
      b.classList.toggle('on', b.dataset.tweakSet === `hero:${state.hero}`));
    document.querySelectorAll('[data-tweak-toggle="motion"]').forEach(b =>
      b.classList.toggle('on', state.motion));
    document.querySelectorAll('.lang button').forEach(b =>
      b.classList.toggle('on', b.dataset.langSet === state.lang));
  });

  // For every .ph.has-photo: convert the inline background-image to a CSS
  // variable (--photo-url) and apply per-photo focal data (x/y/zoom) so the
  // ::before pseudo-element handles pan/zoom without disturbing the
  // element's own layout. The render JS in each variant page sets
  // background-image inline; we run after DOMContentLoaded which fires
  // after those inline scripts complete.
  function applyFocals() {
    var data = window.DRIFT_DATA || {};
    document.querySelectorAll('.ph.has-photo').forEach(function (el) {
      if (!el.style.getPropertyValue('--photo-url')) {
        var bg = el.style.backgroundImage;
        if (bg && bg !== 'none') el.style.setProperty('--photo-url', bg);
      }
      // Find the closest ancestor with data-slot to look up focal data.
      var slotted = el.closest('[data-slot]');
      var slot = slotted && slotted.getAttribute('data-slot');
      var focal = lookupFocal(slot, data) || { x: 50, y: 50, zoom: 1 };
      el.style.setProperty('--focal-x', focal.x + '%');
      el.style.setProperty('--focal-y', focal.y + '%');
      el.style.setProperty('--zoom', focal.zoom);
    });
  }
  function lookupFocal(slot, data) {
    if (!slot) return null;
    if (slot === 'hero') return (data.eventPoster || {}).photoFocal || null;
    if (slot.startsWith('driver-')) {
      var rank = parseInt(slot.slice(7), 10);
      var d = (data.drivers || []).find(function (x) { return x.rank === rank; });
      return d ? d.photoFocal || null : null;
    }
    if (slot.startsWith('track-')) {
      var slug = slot.slice(6);
      var t = (data.tracks || []).find(function (x) { return x.slug === slug; });
      return t ? t.photoFocal || null : null;
    }
    if (slot.startsWith('car-')) {
      var idx = parseInt(slot.slice(4), 10);
      var c = (data.cars || []).find(function (x) { return x.id === idx; });
      return c ? c.photoFocal || null : null;
    }
    return null;
  }
  document.addEventListener('DOMContentLoaded', applyFocals);
  // Re-apply when admin postMessages a focal update (so the iframe preview
  // refreshes without a full reload while the admin is dragging the photo).
  window.addEventListener('message', (ev) => {
    if (ev.data && ev.data.type === '__focal_preview' && ev.data.slot) {
      var slotted = document.querySelector('[data-slot="' + ev.data.slot + '"]');
      if (!slotted) return;
      var ph = slotted.querySelector('.ph.has-photo');
      if (!ph) return;
      ph.style.setProperty('--focal-x', ev.data.x + '%');
      ph.style.setProperty('--focal-y', ev.data.y + '%');
      ph.style.setProperty('--zoom', ev.data.zoom);
    }
  });

  // Inject mobile hamburger + drawer toggle into every .topbar
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.topbar').forEach((bar) => {
      const inner = bar.querySelector('.topbar__inner');
      if (!inner || bar.querySelector('.topbar__burger')) return;
      const burger = document.createElement('button');
      burger.className = 'topbar__burger';
      burger.setAttribute('aria-label', 'Open menu');
      burger.setAttribute('aria-expanded', 'false');
      burger.innerHTML = '<span></span><span></span><span></span>';
      inner.appendChild(burger);
      burger.addEventListener('click', () => {
        const open = bar.classList.toggle('topbar--open');
        burger.setAttribute('aria-expanded', open ? 'true' : 'false');
        document.body.classList.toggle('no-scroll', open);
      });
      // Close on nav link click
      bar.querySelectorAll('.nav a').forEach((a) => {
        a.addEventListener('click', () => {
          bar.classList.remove('topbar--open');
          burger.setAttribute('aria-expanded', 'false');
          document.body.classList.remove('no-scroll');
        });
      });
    });
  });
})();
