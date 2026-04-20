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
