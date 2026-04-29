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

  // === Draft mode bidirectional click → admin slot ===
  // When the page is opened inside the admin preview iframe with ?draft=1,
  // any click on a [data-slot] element posts back to the admin so it can
  // open the matching photo / entity slot. Hovering paints a yellow outline.
  (function () {
    var inIframe = window.parent && window.parent !== window;
    var inDraft = (location.search || '').indexOf('draft=1') !== -1;
    if (!inIframe || !inDraft) return;

    var style = document.createElement('style');
    style.textContent =
      '[data-slot]{cursor:pointer;outline:1px dashed transparent;outline-offset:2px;transition:outline-color .15s}' +
      '[data-slot]:hover{outline-color:rgba(255,240,99,.65)}';
    document.head.appendChild(style);

    document.addEventListener('click', function (e) {
      var slotted = e.target.closest && e.target.closest('[data-slot]');
      if (!slotted) return;
      var a = e.target.closest && e.target.closest('a');
      if (a) {
        var href = a.getAttribute('href') || '';
        if (!href.startsWith('#')) e.preventDefault();
      }
      var slot = slotted.getAttribute('data-slot');
      try { window.parent.postMessage({ type: 'darkforce:slot-click', slot: slot }, '*'); } catch (err) {}
    }, true);
  }());

  // === Inline edit mode (when admin is logged in, OUTSIDE the admin iframe) ===
  (async function () {
    var inIframe = window.parent && window.parent !== window;
    if (inIframe) return;  // admin iframe already has the overlay
    if ((location.search || '').indexOf('draft=1') !== -1) return; // explicit draft preview only
    try {
      var r = await fetch('/admin/api/whoami', { credentials: 'same-origin' });
      if (!r.ok) return;
      var who = await r.json();
      if (!who.authed) return;
    } catch (e) { return; }

    var st = document.createElement('style');
    st.textContent =
      'body{padding-top:44px!important}' +
      '.df-edit-bar{position:fixed;top:0;left:0;right:0;height:44px;background:linear-gradient(90deg,#ff6b35,#c43d11);color:#fff;z-index:9999;display:flex;align-items:center;padding:0 16px;gap:14px;font:600 13px/1 Inter,Arial,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.3)}' +
      '.df-edit-bar b{color:#ffd23f;letter-spacing:.16em;text-transform:uppercase}' +
      '.df-edit-bar .sp{flex:1}' +
      '.df-edit-bar a,.df-edit-bar button{background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.4);color:#fff;font:inherit;padding:6px 12px;border-radius:6px;cursor:pointer;text-decoration:none;transition:background .15s}' +
      '.df-edit-bar a:hover,.df-edit-bar button:hover{background:rgba(255,255,255,.32)}' +
      '.df-edit-bar .danger{background:rgba(0,0,0,.3);border-color:rgba(255,180,180,.4)}' +
      '[data-slot]{position:relative}' +
      '[data-slot]::after{content:""}' +
      '.df-photo-btn{position:absolute;top:10px;right:10px;z-index:40;background:rgba(0,0,0,.78);color:#ffd23f;border:1px solid #ffd23f;border-radius:6px;padding:6px 12px;font:600 12px/1 Inter,Arial,sans-serif;cursor:pointer;opacity:0;transition:opacity .2s}' +
      '[data-slot]:hover .df-photo-btn{opacity:1}' +
      '.df-photo-btn:hover{background:#ffd23f;color:#000}';
    document.head.appendChild(st);

    var bar = document.createElement('div');
    bar.className = 'df-edit-bar';
    bar.innerHTML =
      '<span><b>Dark Force · режим редактирования</b></span>' +
      '<span class="sp"></span>' +
      '<a href="/admin">Полная админка</a>' +
      '<button id="df-edit-logout" class="danger" type="button">Выйти</button>';
    document.body.appendChild(bar);
    document.getElementById('df-edit-logout').addEventListener('click', async () => {
      await fetch('/admin/logout', { method: 'POST', credentials: 'same-origin' });
      location.reload();
    });

    // Photo replace overlay on every [data-slot]
    document.querySelectorAll('[data-slot]').forEach(function (el) {
      var slot = el.getAttribute('data-slot');
      if (!slot) return;
      if (el.querySelector('.df-photo-btn')) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'df-photo-btn';
      btn.textContent = '📷 Заменить';
      el.appendChild(btn);
      btn.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        var fi = document.createElement('input');
        fi.type = 'file'; fi.accept = 'image/*'; fi.style.display = 'none';
        document.body.appendChild(fi);
        fi.addEventListener('change', async function () {
          if (!fi.files[0]) return;
          var fd = new FormData();
          fd.append('file', fi.files[0], fi.files[0].name);
          fd.append('slot', slot);
          btn.textContent = '⏳ Загрузка...';
          var rr = await fetch('/admin/api/upload-slot', { method: 'POST', credentials: 'same-origin', body: fd });
          btn.textContent = '📷 Заменить';
          if (rr.ok) location.reload();
          else alert('Ошибка ' + rr.status);
          fi.remove();
        });
        fi.click();
      });
    });
  }());
