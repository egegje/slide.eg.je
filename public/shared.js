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
      // Real backdrop element (sibling of bar) — ::before pseudo can't reliably
      // catch click events across browsers, so use a real div.
      const backdrop = document.createElement('div');
      backdrop.className = 'topbar__backdrop';
      backdrop.setAttribute('aria-hidden', 'true');
      bar.parentNode.insertBefore(backdrop, bar.nextSibling);

      const close = () => {
        bar.classList.remove('topbar--open');
        burger.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('no-scroll');
      };
      burger.addEventListener('click', () => {
        const open = bar.classList.toggle('topbar--open');
        burger.setAttribute('aria-expanded', open ? 'true' : 'false');
        document.body.classList.toggle('no-scroll', open);
      });
      // Close on nav link click
      bar.querySelectorAll('.nav a').forEach((a) => {
        a.addEventListener('click', close);
      });
      // Close on backdrop tap
      backdrop.addEventListener('click', close);
      // Close on Escape
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && bar.classList.contains('topbar--open')) close();
      });
    });
  });
})();

  // === Unified edit mode ===
  // The site is editable ONLY inside the admin iframe (/admin → iframe with
  // ?draft=1). On the live site, even if the admin is logged in, we render
  // nothing — there is one single editing surface (/admin) instead of two.
  (function () {
    var inIframe = window.parent && window.parent !== window;
    var inDraft = (location.search || '').indexOf('draft=1') !== -1;
    if (!inIframe || !inDraft) return;

    var style = document.createElement('style');
    style.textContent =
      '[data-slot]{cursor:pointer;outline:1px dashed transparent;outline-offset:2px;transition:outline-color .15s}' +
      '[data-slot]:hover{outline-color:rgba(255,240,99,.65)}';
    document.head.appendChild(style);

    // Click on slot → postMessage to admin so the matching slot opens in the
    // rail. Skip clicks on photo controls and contenteditable text — those
    // have their own behavior.
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest && (t.closest('.df-photo-ctl') || t.closest('[contenteditable="true"]'))) return;
      var slotted = t.closest && t.closest('[data-slot]');
      if (!slotted) return;
      var a = t.closest && t.closest('a');
      if (a) {
        var href = a.getAttribute('href') || '';
        if (!href.startsWith('#')) e.preventDefault();
      }
      var slot = slotted.getAttribute('data-slot');
      try { window.parent.postMessage({ type: 'darkforce:slot-click', slot: slot }, '*'); } catch (err) {}
    }, true);
  }());

  // === Edit-mode indicator on live site (orange bar, no inline editing here) ===
  // When the admin is logged in and visits the public site directly (not via
  // /admin), show a slim orange bar so it's obvious that an admin session is
  // active. Editing itself happens only inside /admin.
  (async function () {
    var inIframe = window.parent && window.parent !== window;
    if (inIframe) return;
    if ((location.search || '').indexOf('draft=1') !== -1) return;
    if ((location.pathname || '').indexOf('/admin') === 0) return;
    try {
      var r = await fetch('/admin/api/whoami', { credentials: 'same-origin' });
      if (!r.ok) return;
      if (!(await r.json()).authed) return;
    } catch (e) { return; }

    var st = document.createElement('style');
    st.textContent =
      'body{padding-top:44px!important}' +
      '.df-edit-bar{position:fixed;top:0;left:0;right:0;height:44px;background:linear-gradient(90deg,#ff6b35,#c43d11);color:#fff;z-index:9999;display:flex;align-items:center;padding:0 16px;gap:14px;font:600 13px/1 Inter,Arial,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.3)}' +
      '.df-edit-bar b{color:#ffd23f;letter-spacing:.16em;text-transform:uppercase}' +
      '.df-edit-bar .sp{flex:1}' +
      '.df-edit-bar a,.df-edit-bar button{background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.4);color:#fff;font:inherit;padding:6px 12px;border-radius:6px;cursor:pointer;text-decoration:none;transition:background .15s}' +
      '.df-edit-bar a:hover,.df-edit-bar button:hover{background:rgba(255,255,255,.32)}' +
      '.df-edit-bar .danger{background:rgba(0,0,0,.3);border-color:rgba(255,180,180,.4)}';
    document.head.appendChild(st);

    var bar = document.createElement('div');
    bar.className = 'df-edit-bar';
    bar.innerHTML =
      '<span><b>Dark Force · режим редактирования</b></span>' +
      '<span class="sp"></span>' +
      '<a href="/admin">Открыть админку</a>' +
      '<button id="df-edit-logout" class="danger" type="button">Выйти</button>';
    document.body.appendChild(bar);
    document.getElementById('df-edit-logout').addEventListener('click', async () => {
      await fetch('/admin/logout', { method: 'POST', credentials: 'same-origin' });
      location.reload();
    });
  }());

  // === Photo overlay (Заменить / Сбросить / Кадрировать) inside admin iframe ===
  (function () {
    var inIframe = window.parent && window.parent !== window;
    var inDraft = (location.search || '').indexOf('draft=1') !== -1;
    if (!inIframe || !inDraft) return;

    var st = document.createElement('style');
    st.textContent =
      '[data-slot]{position:relative}' +
      '.df-photo-ctl{position:absolute;top:10px;right:10px;z-index:40;display:flex;flex-direction:column;gap:6px;align-items:flex-end;pointer-events:none}' +
      '.df-photo-ctl > *{pointer-events:auto}' +
      '.df-photo-btn{background:rgba(0,0,0,.88);color:#ffd23f;border:2px solid #ffd23f;border-radius:8px;padding:7px 12px;font:700 12px/1 Inter,Arial,sans-serif;cursor:pointer;opacity:.95;transition:transform .15s,box-shadow .2s,background .15s,color .15s;box-shadow:0 4px 14px rgba(0,0,0,.5);display:inline-flex;align-items:center;gap:6px;white-space:nowrap}' +
      '[data-slot]:hover .df-photo-btn{box-shadow:0 6px 22px rgba(255,210,63,.5)}' +
      '.df-photo-btn:hover{background:#ffd23f;color:#1a1a1a}' +
      '.df-photo-btn.danger{color:#ff8a80;border-color:#ff8a80}' +
      '.df-photo-btn.danger:hover{background:#ff8a80;color:#1a1a1a}' +
      '.df-photo-btn.on{background:#ffd23f;color:#1a1a1a}' +
      '[data-slot].df-cropping{outline:3px solid #ffd23f;outline-offset:-3px}' +
      '[data-slot].df-cropping .ph.has-photo,[data-slot].df-cropping .photo,[data-slot].df-cropping img{cursor:grab}' +
      '[data-slot].df-cropping .ph.has-photo.df-drag,[data-slot].df-cropping .photo.df-drag,[data-slot].df-cropping img.df-drag{cursor:grabbing}' +
      '.df-crop-hint{position:absolute;bottom:10px;left:10px;z-index:40;background:rgba(0,0,0,.88);color:#ffd23f;border:1px solid #ffd23f;border-radius:6px;padding:6px 10px;font:600 11px/1.3 Inter,Arial,sans-serif;pointer-events:none;max-width:60%}';
    document.head.appendChild(st);

    // ---- Cropper helpers (shared across all slots in inline edit mode) ----
    var saveTimers = new Map();
    function debouncedSaveFocal(slot, x, y, zoom) {
      clearTimeout(saveTimers.get(slot));
      saveTimers.set(slot, setTimeout(function () {
        fetch('/admin/api/save-focal', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slot: slot, x: x, y: y, zoom: zoom }),
        }).catch(function () {});
      }, 350));
    }
    function findPhotoEl(slotEl) {
      return slotEl.querySelector('.ph.has-photo')
        || slotEl.querySelector('.photo')
        || slotEl.querySelector('img');
    }
    function readFocal(slotEl) {
      var p = findPhotoEl(slotEl); if (!p) return { x: 50, y: 50, zoom: 1 };
      var x = parseFloat((p.style.getPropertyValue('--focal-x') || '50').replace('%','')) || 50;
      var y = parseFloat((p.style.getPropertyValue('--focal-y') || '50').replace('%','')) || 50;
      var z = parseFloat(p.style.getPropertyValue('--zoom')) || 1;
      return { x: x, y: y, zoom: z };
    }
    function applyFocal(slotEl, f) {
      var p = findPhotoEl(slotEl); if (!p) return;
      p.style.setProperty('--focal-x', f.x + '%');
      p.style.setProperty('--focal-y', f.y + '%');
      p.style.setProperty('--zoom', f.zoom);
      // Fallback for plain <img>
      if (p.tagName === 'IMG') {
        p.style.objectPosition = f.x + '% ' + f.y + '%';
        p.style.transform = 'scale(' + f.zoom + ')';
        p.style.transformOrigin = f.x + '% ' + f.y + '%';
      }
    }

    // Photo overlay (Заменить / Сбросить / Кадрировать) on every [data-slot]
    function attachPhotoOverlay(el) {
      var slot = el.getAttribute('data-slot');
      if (!slot) return;
      if (el.querySelector('.df-photo-ctl')) return;

      var ctl = document.createElement('div');
      ctl.className = 'df-photo-ctl';
      ctl.innerHTML =
        '<button type="button" class="df-photo-btn" data-act="replace">📷 Заменить</button>' +
        '<button type="button" class="df-photo-btn danger" data-act="reset">✕ Сбросить</button>' +
        '<button type="button" class="df-photo-btn" data-act="crop">🎯 Кадрировать</button>';
      el.appendChild(ctl);

      var btnReplace = ctl.querySelector('[data-act="replace"]');
      var btnReset   = ctl.querySelector('[data-act="reset"]');
      var btnCrop    = ctl.querySelector('[data-act="crop"]');

      btnReplace.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        var fi = document.createElement('input');
        fi.type = 'file'; fi.accept = 'image/*'; fi.style.display = 'none';
        document.body.appendChild(fi);
        fi.addEventListener('change', async function () {
          if (!fi.files[0]) return;
          var fd = new FormData();
          fd.append('file', fi.files[0], fi.files[0].name);
          fd.append('slot', slot);
          btnReplace.textContent = '⏳ Загрузка...';
          var rr = await fetch('/admin/api/upload-slot', { method: 'POST', credentials: 'same-origin', body: fd });
          btnReplace.textContent = '📷 Заменить';
          if (rr.ok) location.reload();
          else alert('Ошибка ' + rr.status);
          fi.remove();
        });
        fi.click();
      });

      btnReset.addEventListener('click', async function (e) {
        e.preventDefault(); e.stopPropagation();
        if (!confirm('Сбросить фото к стандартному?')) return;
        btnReset.textContent = '⏳';
        var rr = await fetch('/admin/api/delete-slot', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slot: slot }),
        });
        btnReset.textContent = '✕ Сбросить';
        if (rr.ok) location.reload();
        else alert('Ошибка ' + rr.status);
      });

      // Cropper toggle + interaction
      var cropping = false;
      var dragStart = null;
      var photoEl = null;
      var hint = null;

      function onMouseDown(ev) {
        if (!cropping) return;
        ev.preventDefault();
        var f = readFocal(el);
        dragStart = { sx: ev.clientX, sy: ev.clientY, x: f.x, y: f.y };
        photoEl && photoEl.classList.add('df-drag');
      }
      function onMouseMove(ev) {
        if (!cropping || !dragStart) return;
        var rect = el.getBoundingClientRect();
        // Drag right => focal moves left so content from the left becomes visible.
        var dx = (ev.clientX - dragStart.sx) / rect.width * 100;
        var dy = (ev.clientY - dragStart.sy) / rect.height * 100;
        var nx = Math.max(0, Math.min(100, dragStart.x - dx));
        var ny = Math.max(0, Math.min(100, dragStart.y - dy));
        var f = readFocal(el);
        applyFocal(el, { x: nx, y: ny, zoom: f.zoom });
        debouncedSaveFocal(slot, nx, ny, f.zoom);
      }
      function onMouseUp() {
        if (!dragStart) return;
        dragStart = null;
        photoEl && photoEl.classList.remove('df-drag');
      }
      function onWheel(ev) {
        if (!cropping) return;
        ev.preventDefault();
        var f = readFocal(el);
        var delta = -ev.deltaY / 500;
        var nz = Math.max(1, Math.min(3, f.zoom + delta));
        applyFocal(el, { x: f.x, y: f.y, zoom: nz });
        debouncedSaveFocal(slot, f.x, f.y, nz);
      }

      btnCrop.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        cropping = !cropping;
        btnCrop.classList.toggle('on', cropping);
        el.classList.toggle('df-cropping', cropping);
        photoEl = findPhotoEl(el);
        if (cropping) {
          btnCrop.textContent = '✓ Готово';
          if (!hint) {
            hint = document.createElement('div');
            hint.className = 'df-crop-hint';
            hint.textContent = 'Тяни — двигать, колесо — приближать';
            el.appendChild(hint);
          }
          el.addEventListener('mousedown', onMouseDown);
          window.addEventListener('mousemove', onMouseMove);
          window.addEventListener('mouseup', onMouseUp);
          el.addEventListener('wheel', onWheel, { passive: false });
        } else {
          btnCrop.textContent = '🎯 Кадрировать';
          if (hint) { hint.remove(); hint = null; }
          el.removeEventListener('mousedown', onMouseDown);
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
          el.removeEventListener('wheel', onWheel);
        }
      });
    }
    function applyOverlays() {
      document.querySelectorAll('[data-slot]').forEach(attachPhotoOverlay);
    }
    if (document.readyState === 'complete') applyOverlays();
    else document.addEventListener('DOMContentLoaded', () => setTimeout(applyOverlays, 100));
    var moPhoto = new MutationObserver(function () {
      clearTimeout(applyOverlays._t);
      applyOverlays._t = setTimeout(applyOverlays, 100);
    });
    moPhoto.observe(document.body, { childList: true, subtree: true });
  }());

  // === Inline editing of entity text (driver/car/track) — inside admin iframe only ===
  (function () {
    var inIframe = window.parent && window.parent !== window;
    var inDraft = (location.search || '').indexOf('draft=1') !== -1;
    if (!inIframe || !inDraft) return;

    var st = document.createElement('style');
    st.textContent =
      '[data-edit-field]{outline:1px dashed transparent;outline-offset:2px;cursor:text;transition:outline-color .15s}' +
      '[data-edit-field]:hover{outline-color:rgba(255,210,63,.6)}' +
      '[data-edit-field]:focus{outline:2px solid #ffd23f!important;background:rgba(255,210,63,.06)}';
    document.head.appendChild(st);

    function fieldsForSlot(slot) {
      // Driver fields editable inline: name (fold first+last) and car string.
      if (slot.startsWith('driver-')) return [
        { sel: '.name', field: 'name' },
        { sel: '.car', field: 'car' },
      ];
      if (slot.startsWith('car-')) return [
        { sel: '.name', field: 'name' },
        { sel: '.car', field: 'engine' },  // car cards show engine in .car
      ];
      if (slot.startsWith('track-')) return [
        { sel: '.name', field: 'name' },
      ];
      return [];
    }

    function patchUrlForSlot(slot) {
      if (slot.startsWith('driver-')) return '/admin/api/drivers/' + slot.slice(7);
      if (slot.startsWith('car-'))    return '/admin/api/cars/' + slot.slice(4);
      if (slot.startsWith('track-'))  return '/admin/api/tracks/' + encodeURIComponent(slot.slice(6));
      return null;
    }

    function activateSlot(el) {
      var slot = el.getAttribute('data-slot');
      if (!slot) return;
      var url = patchUrlForSlot(slot);
      if (!url) return;
      fieldsForSlot(slot).forEach(function (cfg) {
        var t = el.querySelector(cfg.sel);
        if (!t || t.dataset.editField) return;
        t.setAttribute('contenteditable', 'true');
        t.setAttribute('spellcheck', 'false');
        t.dataset.editField = cfg.field;
        t.dataset.patchUrl = url;
      });
    }

    var pending = new Map(); // url → {field: value}
    var saveTimer = null;

    function flush() {
      pending.forEach(function (body, url) {
        fetch(url, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(body),
        }).catch(function () {});
      });
      pending.clear();
    }

    document.addEventListener('input', function (e) {
      var el = e.target.closest && e.target.closest('[data-edit-field]');
      if (!el) return;
      var url = el.dataset.patchUrl;
      var field = el.dataset.editField;
      var val = (el.textContent || '').trim();
      var bag = pending.get(url) || {};
      bag[field] = val;
      pending.set(url, bag);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, 700);
    });
    document.addEventListener('blur', function (e) {
      if (e.target.closest && e.target.closest('[data-edit-field]')) {
        clearTimeout(saveTimer);
        flush();
      }
    }, true);

    // Run after DOM and after data-driven render. drift-data.js does sync XHR
    // before DOMContentLoaded, but card render is in inline scripts that fire
    // on DOMContentLoaded. Use a small delay + observer fallback.
    function applyAll() {
      document.querySelectorAll('[data-slot]').forEach(activateSlot);
    }
    if (document.readyState === 'complete') applyAll();
    else document.addEventListener('DOMContentLoaded', () => setTimeout(applyAll, 100));
    // Re-apply if DOM mutates (hot re-render)
    var mo = new MutationObserver(function () {
      clearTimeout(applyAll._t);
      applyAll._t = setTimeout(applyAll, 100);
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }());
