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
    // Toggle all [data-en] / [data-ru]
    document.querySelectorAll('[data-en]').forEach(el => {
      el.textContent = state.lang === 'ru' ? (el.dataset.ru || el.textContent) : el.dataset.en;
    });
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
  apply(state);

  // Language toggle (works even without tweaks panel)
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-lang-set]');
    if (!t) return;
    window.__drift.set({ lang: t.dataset.langSet });
    document.querySelectorAll('[data-lang-set]').forEach(b => {
      b.classList.toggle('on', b.dataset.langSet === t.dataset.langSet === true);
    });
    document.querySelectorAll('.lang button').forEach(b => {
      b.classList.toggle('on', b.dataset.langSet === state.lang);
    });
  });

  // Edit-mode protocol
  window.addEventListener('message', (ev) => {
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
})();
