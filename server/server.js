import Fastify from "fastify";
import secureSession from "@fastify/secure-session";
import multipart from "@fastify/multipart";
import formbody from "@fastify/formbody";
import argon2 from "argon2";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { randomBytes } from "node:crypto";

const ROOT = "/opt/slide.eg.je";
const DATA_DIR = join(ROOT, "data");
const PUB = join(ROOT, "public");
const DRIFT_DATA = join(PUB, "drift-data.json");
const DRIFT_DATA_JS = join(PUB, "drift-data.js");
const USERS_FILE = join(DATA_DIR, "users.json");
const GALLERY_FILE = join(DATA_DIR, "gallery.json");
const SESSION_KEY_FILE = join(DATA_DIR, "session-secret");
const UPLOADS_LOG = join(DATA_DIR, "uploads.log");

const PHOTO_DIR = join(PUB, "photos");
const GALLERY_DIR = join(PUB, "gallery");

const PORT = Number(process.env.PORT || 3030);
const PHOTO_MAX = 25 * 1024 * 1024;
const VIDEO_MAX = 200 * 1024 * 1024;

const ALLOWED_PHOTO = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const ALLOWED_VIDEO = new Set([".mp4", ".mov", ".webm", ".m4v"]);

// Shared photo requirement specs surfaced to the admin UI under each upload
// widget. The exact px/MB numbers are advisory — the server still enforces
// PHOTO_MAX bytes and the ALLOWED_PHOTO extension set.
const PHOTO_SPECS = {
  hero:    { label: "Афиша · 16:9", min: "1600×900", max: "5 МБ", note: "JPG / PNG / WEBP. Лучше 1920×1080 или больше." },
  driver:  { label: "Пилот · 4:5",  min: "800×1000", max: "5 МБ", note: "Портрет, лицо в центре. JPG / PNG / WEBP." },
  track:   { label: "Трасса · 16:9", min: "1200×675", max: "5 МБ", note: "Аэро или панорама трассы. JPG / PNG / WEBP." },
  gallery: { label: "Галерея",       min: "—",         max: "25 МБ фото / 200 МБ видео", note: "Любые фото и видео." },
};

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; }
}

async function writeJson(path, data) {
  await writeFile(path, JSON.stringify(data, null, 2), "utf8");
}

// The public site (all three design variants) reads from drift-data.js which
// sets window.DRIFT_DATA. Whenever drift-data.json changes we mirror it into
// the .js so the front-end picks up the change on the next page load.
async function syncDriftDataJs(data) {
  const banner = "// Auto-generated from admin photo uploads.\n" +
    "// Edits here are overwritten on next change — change drift-data.json instead.\n";
  const body = "window.DRIFT_DATA = \n" + JSON.stringify(data) + "\n;\n";
  await writeFile(DRIFT_DATA_JS, banner + body, "utf8");
}

async function loadUsers() { return readJson(USERS_FILE, []); }

async function logUpload(user, kind, target, filename, size) {
  const line = JSON.stringify({ at: new Date().toISOString(), user, kind, target, filename, size });
  await writeFile(UPLOADS_LOG, line + "\n", { flag: "a" });
}

function safeFilename(name) {
  const cleaned = name.replace(/[/\\]/g, "_").replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 80);
  return cleaned || "file";
}

function uniqueName(dir, original) {
  const safe = safeFilename(original);
  const ext = extname(safe);
  const base = safe.slice(0, safe.length - ext.length);
  let name = `${base}${ext}`;
  let i = 1;
  while (existsSync(join(dir, name))) { name = `${base}-${i}${ext}`; i++; }
  return name;
}

const app = Fastify({ logger: { level: "info" } });

const sessionKey = await readFile(SESSION_KEY_FILE);
await app.register(secureSession, {
  key: Buffer.from(sessionKey.toString("utf8").trim(), "base64"),
  cookie: {
    path: "/admin", httpOnly: true, sameSite: "lax",
    secure: false, maxAge: 60 * 60 * 24 * 30,
  },
});
await app.register(formbody);
await app.register(multipart, { limits: { fileSize: VIDEO_MAX } });

const requireAuth = async (req, reply) => {
  const user = req.session.get("user");
  if (!user) {
    const wantsJson = (req.headers.accept || "").includes("application/json")
      || req.url.startsWith("/admin/api/");
    if (wantsJson) return reply.code(401).send({ error: "auth required" });
    return reply.redirect("/admin/login");
  }
  req.adminUser = user;
};

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// --- HTML pages ---
const PAGE_LOGIN = `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dark Force admin · login</title>
<style>
  body { margin:0; background:#0a0a0c; color:#f5f5f7; font:14px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif; min-height:100vh; display:flex; align-items:center; justify-content:center; }
  form { width:340px; padding:28px; background:#131318; border:1px solid #1f1f24; border-radius:14px; }
  h1 { font-size:14px; letter-spacing:0.12em; text-transform:uppercase; margin:0 0 22px; color:#ff3b30; }
  label { display:block; font-size:11px; color:#8b8b95; margin-bottom:4px; letter-spacing:0.08em; text-transform:uppercase; }
  input { width:100%; padding:11px 12px; background:#0d0d10; border:1px solid #1f1f24; border-radius:8px; color:#f5f5f7; font:inherit; margin-bottom:14px; }
  input:focus { outline:none; border-color:#ff3b30; }
  button { width:100%; padding:11px; background:#ff3b30; color:white; border:none; border-radius:8px; font:inherit; font-weight:600; cursor:pointer; }
  .err { color:#ff3b30; font-size:12px; min-height:18px; }
</style></head><body>
$BODY$
</body></html>`;

app.get("/admin/login", async (req, reply) => {
  reply.type("text/html").send(PAGE_LOGIN.replace("$BODY$", `
    <form method="post" action="/admin/login">
      <h1>Dark Force / admin</h1>
      <label>Логин</label>
      <input name="login" autofocus required>
      <label>Пароль</label>
      <input name="password" type="password" required>
      <button type="submit">Войти</button>
      <div class="err">${req.query.err ? "Неверный логин или пароль" : ""}</div>
    </form>`));
});

app.post("/admin/login", async (req, reply) => {
  const body = req.body ?? {};
  const login = String(body.login || "").trim().toLowerCase();
  const password = String(body.password || "");
  const users = await loadUsers();
  const u = users.find((x) => x.login.toLowerCase() === login);
  let ok = false;
  if (u) { try { ok = await argon2.verify(u.passwordHash, password); } catch {} }
  if (!ok) return reply.redirect("/admin/login?err=1");
  req.session.set("user", u.login);
  return reply.redirect("/admin");
});

app.post("/admin/logout", { preHandler: requireAuth }, async (req, reply) => {
  req.session.delete();
  return reply.redirect("/admin/login");
});

const DASH_HTML = `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dark Force admin</title>
<style>
  :root { --bg:#0a0a0c; --bg-2:#0d0d10; --fg:#f5f5f7; --muted:#8b8b95; --line:#1f1f24; --line-2:#2a2a30; --accent:#ff3b30; --ok:#30d158; }
  * { box-sizing: border-box; }
  body, html { margin:0; height:100%; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif; overflow: hidden; }
  a { color: var(--accent); text-decoration: none; }
  button { font: inherit; }
  .top { display: flex; justify-content: space-between; align-items: center; padding: 12px 18px; border-bottom: 1px solid var(--line); height: 52px; }
  .top h1 { margin: 0; font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
  .top .who { font-size: 12px; color: var(--muted); }
  .layout { display: grid; grid-template-columns: 360px 1fr; height: calc(100% - 52px); }
  .rail { border-right: 1px solid var(--line); overflow: auto; padding: 14px; }
  .preview { position: relative; background: #050507; }
  .preview__bar { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--line); height: 44px; background: var(--bg-2); }
  .preview__bar button { padding: 5px 10px; border-radius: 6px; border: 1px solid var(--line); background: #15151a; color: var(--muted); cursor: pointer; font-size: 12px; letter-spacing: 0.04em; }
  .preview__bar button.on { background: var(--fg); color: var(--bg); border-color: var(--fg); }
  .preview__bar .grow { flex: 1; }
  .preview__bar .url { font-size: 11px; color: var(--muted); font-family: ui-monospace, monospace; }
  .frame-wrap { position: absolute; top: 44px; left: 0; right: 0; bottom: 0; overflow: hidden; }
  .frame { width: 100%; height: 100%; border: 0; background: var(--bg); }

  .group { margin-bottom: 14px; }
  .group__title { font-size: 11px; letter-spacing: 0.12em; color: var(--muted); text-transform: uppercase; margin: 8px 0 8px; padding: 0 4px; display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .group__title b { color: var(--fg); }
  .group__title span { font-size: 10px; }
  .group__add { font-size: 11px; letter-spacing: 0.06em; padding: 4px 9px; border-radius: 6px; border: 1px solid var(--line); background: #1a1a20; color: var(--fg); cursor: pointer; }
  .group__add:hover { border-color: var(--accent); color: var(--accent); }
  .group__hint { font-size: 11px; color: var(--muted); padding: 0 4px 8px; line-height: 1.4; }
  .new-form { padding: 12px; border: 1px solid var(--accent); border-radius: 10px; background: #14080a; margin-bottom: 8px; }
  .new-form h4 { margin: 0 0 10px; font-size: 13px; }
  .new-form .row { margin-bottom: 8px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .new-form .row.full { grid-template-columns: 1fr; }
  .new-form input { width: 100%; padding: 7px 10px; background: var(--bg-2); border: 1px solid var(--line); border-radius: 6px; color: var(--fg); font: inherit; font-size: 12px; }
  .new-form input:focus { outline: none; border-color: var(--accent); }
  .new-form label { font-size: 10px; letter-spacing: 0.06em; color: var(--muted); text-transform: uppercase; display: block; margin-bottom: 3px; }
  .new-form .actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 6px; }
  .new-form button { padding: 6px 14px; border-radius: 6px; border: 1px solid var(--line); background: #1a1a20; color: var(--fg); cursor: pointer; font-size: 12px; }
  .new-form button.primary { background: var(--accent); color: white; border-color: var(--accent); }

  .slot { display: grid; grid-template-columns: 56px 1fr auto; gap: 10px; align-items: center; padding: 8px; border: 1px solid var(--line); border-radius: 10px; background: #0f0f13; transition: border-color .12s, background .12s; margin-bottom: 6px; }
  .slot:hover { border-color: var(--line-2); }
  .slot.active { border-color: var(--accent); background: #1a1015; }
  .slot.over { border-color: var(--accent); background: rgba(255,59,48,0.1); border-style: dashed; }
  .slot__thumb { width: 56px; height: 56px; border-radius: 8px; background: #15151a center/cover no-repeat; border: 1px solid var(--line); position: relative; flex-shrink: 0; cursor: pointer; }
  .slot__thumb.empty::after { content: "+"; color: var(--muted); position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 22px; }
  .slot__body { min-width: 0; display: flex; flex-direction: column; gap: 2px; justify-content: center; cursor: pointer; }
  .slot__name { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .slot__meta { color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .slot__status { font-size: 10px; color: var(--muted); margin-top: 2px; }
  .slot__status.has { color: var(--ok); }
  .slot__act { display: flex; flex-direction: column; gap: 4px; align-items: stretch; }
  .slot__pick { display: inline-block; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--line); background: #1a1a20; color: var(--fg); cursor: pointer; font-size: 11px; text-align: center; white-space: nowrap; }
  .slot__pick:hover { border-color: var(--accent); background: #20141a; }
  .slot__pick input { display: none; }
  .slot__del { padding: 4px 10px; border-radius: 6px; border: 1px solid var(--line); background: #1a1a20; color: var(--accent); cursor: pointer; font-size: 11px; }
  .slot__del:hover { background: var(--accent); color: white; border-color: var(--accent); }
  .slot__bar { grid-column: 1 / -1; height: 3px; background: var(--line); border-radius: 2px; overflow: hidden; display: none; }
  .slot__bar.show { display: block; }
  .slot__bar > i { display: block; height: 100%; background: var(--accent); width: 0%; transition: width .15s, background .25s; }
  .slot__bar.done > i { background: var(--ok); }

  .editor { padding: 14px; border: 1px solid var(--accent); border-radius: 12px; background: #14080a; margin-bottom: 14px; }
  .editor h3 { margin: 0 0 4px; font-size: 14px; }
  .editor .req { font-size: 11px; color: var(--muted); margin-bottom: 12px; line-height: 1.45; }
  .editor .req b { color: var(--fg); font-weight: 600; }
  .editor .row { margin-bottom: 10px; }
  .editor label { display: block; font-size: 10px; letter-spacing: 0.08em; color: var(--muted); text-transform: uppercase; margin-bottom: 4px; }
  .editor input[type="text"], .editor input[type="date"] { width: 100%; padding: 8px 10px; background: var(--bg-2); border: 1px solid var(--line); border-radius: 6px; color: var(--fg); font: inherit; }
  .editor input:focus { outline: none; border-color: var(--accent); }
  .editor .actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .editor .actions label.pick, .editor .actions button { padding: 7px 12px; border-radius: 6px; border: 1px solid var(--line); background: #1a1a20; color: var(--fg); cursor: pointer; font-size: 12px; }
  .editor .actions label.pick:hover, .editor .actions button:hover { border-color: var(--accent); }
  .editor .actions input[type="file"] { display: none; }
  .editor .actions .danger { color: var(--accent); }
  .editor .progress { height: 4px; background: var(--line); border-radius: 2px; overflow: hidden; margin-top: 8px; display: none; }
  .editor .progress.show { display: block; }
  .editor .progress > i { display: block; height: 100%; background: var(--accent); width: 0%; transition: width .15s, background .25s; }
  .editor .progress.done > i { background: var(--ok); }
  .editor .save-tag { font-size: 10px; color: var(--ok); display: none; margin-left: auto; align-self: center; }
  .editor .save-tag.show { display: inline; }

  .gallery-drop { display: block; border: 2px dashed var(--line); border-radius: 12px; padding: 22px 18px; text-align: center; color: var(--muted); margin-bottom: 14px; transition: border-color .15s, background .15s, color .15s; cursor: pointer; }
  .gallery-drop:hover { border-color: var(--accent); color: var(--fg); background: rgba(255,59,48,0.04); }
  .gallery-drop.over { border-color: var(--accent); background: rgba(255,59,48,0.1); color: var(--fg); }
  .gallery-drop b { color: var(--fg); display: block; margin-bottom: 4px; font-size: 13px; }
  .gallery-drop em { font-style: normal; color: var(--accent); }
  .gallery-drop input { display: none; }
  .gal-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .gal-item { position: relative; aspect-ratio: 1/1; background: #15151a; border-radius: 8px; overflow: hidden; }
  .gal-item img, .gal-item video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .gal-item button.del { position: absolute; top: 6px; right: 6px; width: 26px; height: 26px; padding: 0; border-radius: 50%; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.6); color: white; cursor: pointer; font-size: 14px; line-height: 1; }
  .gal-item button.del:hover { background: var(--accent); border-color: var(--accent); }
  .gal-item .meta { position: absolute; bottom: 0; left: 0; right: 0; padding: 4px 8px; font-size: 10px; color: white; background: linear-gradient(transparent, rgba(0,0,0,0.7)); pointer-events: none; }

  .toast { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); background: var(--fg); color: var(--bg); padding: 9px 16px; border-radius: 8px; font-size: 12px; z-index: 100; box-shadow: 0 6px 24px rgba(0,0,0,0.5); }

  @media (max-width: 900px) {
    .layout { grid-template-columns: 1fr; grid-template-rows: 50% 50%; }
    .rail { border-right: 0; border-bottom: 1px solid var(--line); }
  }
</style></head><body>
<div class="top">
  <h1>Dark Force / admin</h1>
  <div class="who">$WHO$ · <a href="#" onclick="logout();return false">выйти</a></div>
</div>
<div class="layout">
  <aside class="rail" id="rail"></aside>
  <main class="preview">
    <div class="preview__bar">
      <button data-variant="apex" class="on" onclick="setVariant('apex')">Apex</button>
      <button data-variant="paddock" onclick="setVariant('paddock')">Paddock</button>
      <button data-variant="telemetry" onclick="setVariant('telemetry')">Telemetry</button>
      <span class="grow"></span>
      <span class="url" id="frame-url">/apex/home.html</span>
    </div>
    <div class="frame-wrap"><iframe class="frame" id="frame" src="/apex/home.html"></iframe></div>
  </main>
</div>

<script>
  const SPECS = $SPECS$;

  let state = {
    variant: 'apex',
    page: 'home',
    activeSlot: null,
    newForm: null, // null | 'driver' | 'track' — controls which inline form is open
    drivers: [],
    tracks: [],
    eventPoster: null,
    gallery: [],
  };

  function escHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  async function api(path, opts) {
    const r = await fetch(path, { credentials: 'same-origin', ...opts });
    if (r.status === 401) { location.href = '/admin/login'; return null; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  async function logout() {
    await fetch('/admin/logout', { method: 'POST', credentials: 'same-origin' });
    location.href = '/admin/login';
  }

  function pageForSlot(slotId) {
    if (slotId === 'hero' || slotId.startsWith('driver-')) return 'home';
    if (slotId.startsWith('track-')) return 'tracks';
    return 'home';
  }

  function setVariant(v) {
    state.variant = v;
    document.querySelectorAll('.preview__bar button').forEach((b) => b.classList.toggle('on', b.dataset.variant === v));
    refreshFrame();
  }

  function refreshFrame() {
    const url = '/' + state.variant + '/' + state.page + '.html?v=' + Date.now() + (state.activeSlot ? '#slot-' + state.activeSlot : '');
    document.getElementById('frame-url').textContent = url.replace(/\\?v=\\d+/, '');
    document.getElementById('frame').src = url;
  }

  function selectSlot(slotId) {
    state.activeSlot = slotId;
    const newPage = pageForSlot(slotId);
    if (newPage !== state.page) { state.page = newPage; refreshFrame(); }
    else { highlightInFrame(slotId); }
    renderRail();
    // Scroll rail to top so the editor pane (for hero text fields) is visible.
    const rail = document.getElementById('rail');
    if (rail) rail.scrollTop = 0;
  }

  function highlightInFrame(slotId) {
    try {
      const doc = document.getElementById('frame').contentDocument;
      if (!doc) return;
      doc.querySelectorAll('[data-slot]').forEach((el) => {
        el.style.outline = el.getAttribute('data-slot') === slotId ? '3px solid #ff3b30' : '';
        el.style.outlineOffset = el.getAttribute('data-slot') === slotId ? '2px' : '';
      });
      const target = doc.querySelector('[data-slot="' + slotId + '"]');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) { /* cross-origin shouldn't happen, but ignore if it does */ }
  }

  async function loadAll() {
    const data = await api('/admin/api/all');
    if (!data) return;
    state.drivers = data.drivers || [];
    state.tracks = data.tracks || [];
    state.eventPoster = data.eventPoster || {};
    state.gallery = data.gallery || [];
    renderRail();
  }

  function renderRail() {
    const rail = document.getElementById('rail');
    const editor = state.activeSlot ? renderEditor() : '';
    const heroSlot = renderSlot('hero', 'Афиша главной', heroSubtitle(), state.eventPoster && state.eventPoster.photo, state.eventPoster && state.eventPoster.photo);
    const driverSlots = state.drivers.map((d) =>
      renderSlot('driver-' + d.rank, '#' + d.rank + ' · ' + (d.name || ''), (d.car || '') + ' · ' + (d.hp || '') + ' HP', !!d.photo, d.photo, 'driver', d.rank)
    ).join('');
    const trackSlots = state.tracks.map((t) =>
      renderSlot('track-' + t.slug, t.name, [t.city, t.region].filter(Boolean).join(', '), !!t.photo, t.photo, 'track', t.slug)
    ).join('');
    const gallerySection = renderGallerySection();

    const driverNew = state.newForm === 'driver' ? renderDriverForm() : '';
    const trackNew = state.newForm === 'track' ? renderTrackForm() : '';

    rail.innerHTML =
      editor +
      '<div class="group">' +
        '<div class="group__title"><b>Афиша ивента</b><span>1 слот</span></div>' +
        '<div class="group__hint">' + escHtml(SPECS.hero.label + ' · от ' + SPECS.hero.min + ' · до ' + SPECS.hero.max) + '</div>' +
        heroSlot +
      '</div>' +
      '<div class="group">' +
        '<div class="group__title"><b>Пилоты</b><span>' + state.drivers.length + '</span>' +
          '<button class="group__add" onclick="toggleNewForm(\\'driver\\')">+ Добавить</button>' +
        '</div>' +
        '<div class="group__hint">' + escHtml(SPECS.driver.label + ' · от ' + SPECS.driver.min + ' · до ' + SPECS.driver.max) + '</div>' +
        driverNew + driverSlots +
      '</div>' +
      '<div class="group">' +
        '<div class="group__title"><b>Трассы</b><span>' + state.tracks.length + '</span>' +
          '<button class="group__add" onclick="toggleNewForm(\\'track\\')">+ Добавить</button>' +
        '</div>' +
        '<div class="group__hint">' + escHtml(SPECS.track.label + ' · от ' + SPECS.track.min + ' · до ' + SPECS.track.max) + '</div>' +
        trackNew + trackSlots +
      '</div>' +
      '<div class="group">' +
        '<div class="group__title"><b>Галерея</b><span>' + state.gallery.length + ' файлов</span></div>' +
        '<div class="group__hint">' + escHtml(SPECS.gallery.note + ' · ' + SPECS.gallery.max) + '</div>' +
        gallerySection +
      '</div>';
  }

  function toggleNewForm(kind) {
    state.newForm = state.newForm === kind ? null : kind;
    renderRail();
  }

  function renderDriverForm() {
    return '<div class="new-form">' +
      '<h4>Новый пилот</h4>' +
      '<div class="row full"><div><label>Имя</label><input id="nf-name" placeholder="James Deane"></div></div>' +
      '<div class="row"><div><label>Страна</label><input id="nf-country" placeholder="Ирландия"></div>' +
                       '<div><label>Флаг (emoji)</label><input id="nf-flag" placeholder="🇮🇪"></div></div>' +
      '<div class="row full"><div><label>Машина</label><input id="nf-car" placeholder="Ford Mustang RTR"></div></div>' +
      '<div class="row"><div><label>Двигатель</label><input id="nf-engine" placeholder="455ci V8"></div>' +
                       '<div><label>Мощность (HP)</label><input id="nf-hp" type="number" placeholder="1249"></div></div>' +
      '<div class="row full"><div><label>Instagram (опц.)</label><input id="nf-instagram" placeholder="@..."></div></div>' +
      '<div class="actions">' +
        '<button onclick="toggleNewForm(\\'driver\\')">Отмена</button>' +
        '<button class="primary" onclick="createDriver()">Добавить</button>' +
      '</div>' +
    '</div>';
  }

  function renderTrackForm() {
    return '<div class="new-form">' +
      '<h4>Новая трасса</h4>' +
      '<div class="row full"><div><label>Название</label><input id="nf-tname" placeholder="Orlando Speed World"></div></div>' +
      '<div class="row"><div><label>Город</label><input id="nf-tcity" placeholder="Orlando"></div>' +
                       '<div><label>Страна</label><input id="nf-tcountry" placeholder="USA"></div></div>' +
      '<div class="row"><div><label>Регион</label><input id="nf-tregion" placeholder="Florida"></div>' +
                       '<div><label>Уровень</label><input id="nf-tlevel" placeholder="pro / pro-am / amateur"></div></div>' +
      '<div class="row full"><div><label>Описание (опц.)</label><input id="nf-tdesc" placeholder="Coротко о трассе"></div></div>' +
      '<div class="row full"><div><label>Google Maps URL (опц.)</label><input id="nf-tmaps" placeholder="https://maps.app.goo.gl/..."></div></div>' +
      '<div class="actions">' +
        '<button onclick="toggleNewForm(\\'track\\')">Отмена</button>' +
        '<button class="primary" onclick="createTrack()">Добавить</button>' +
      '</div>' +
    '</div>';
  }

  async function createDriver() {
    const body = {
      name: document.getElementById('nf-name').value.trim(),
      country: document.getElementById('nf-country').value.trim(),
      flag: document.getElementById('nf-flag').value.trim(),
      car: document.getElementById('nf-car').value.trim(),
      engine: document.getElementById('nf-engine').value.trim(),
      hp: document.getElementById('nf-hp').value.trim(),
      instagram: document.getElementById('nf-instagram').value.trim(),
    };
    if (!body.name || !body.country) { toast('Имя и страна обязательны'); return; }
    const r = await fetch('/admin/api/drivers', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) { toast('Ошибка: ' + r.status); return; }
    state.newForm = null;
    toast('Пилот добавлен — теперь можно загрузить фото');
    await loadAll();
    refreshFrame();
  }

  async function createTrack() {
    const body = {
      name: document.getElementById('nf-tname').value.trim(),
      city: document.getElementById('nf-tcity').value.trim(),
      country: document.getElementById('nf-tcountry').value.trim(),
      region: document.getElementById('nf-tregion').value.trim(),
      level: document.getElementById('nf-tlevel').value.trim(),
      description: document.getElementById('nf-tdesc').value.trim(),
      mapsUrl: document.getElementById('nf-tmaps').value.trim(),
    };
    if (!body.name) { toast('Название обязательно'); return; }
    const r = await fetch('/admin/api/tracks', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) { toast('Ошибка: ' + r.status); return; }
    state.newForm = null;
    toast('Трасса добавлена');
    await loadAll();
    refreshFrame();
  }

  async function deleteEntity(kind, id) {
    if (!confirm('Удалить ' + (kind === 'driver' ? 'пилота' : 'трассу') + ' полностью? (Не только фото.)')) return;
    const r = await fetch('/admin/api/' + (kind === 'driver' ? 'drivers/' + id : 'tracks/' + encodeURIComponent(id)), {
      method: 'DELETE', credentials: 'same-origin',
    });
    if (!r.ok) { toast('Ошибка: ' + r.status); return; }
    await loadAll();
    refreshFrame();
  }

  function heroSubtitle() {
    const ep = state.eventPoster || {};
    if (ep.title || ep.date || ep.track) return [ep.title, ep.date, ep.track].filter(Boolean).join(' · ');
    return 'не заполнена';
  }

  function renderSlot(id, name, meta, hasPhoto, photoUrl, entityKind, entityId) {
    const isActive = state.activeSlot === id;
    const thumbStyle = photoUrl ? 'background-image:url(' + escHtml(photoUrl) + '?v=' + Date.now() + ')' : '';
    const pickLabel = hasPhoto ? 'Заменить' : 'Загрузить';
    const removeBtn = (entityKind && entityId !== undefined)
      ? '<button class="slot__del" title="Удалить целиком" onclick="deleteEntity(\\'' + entityKind + '\\',\\'' + entityId + '\\')">✕</button>'
      : (hasPhoto ? '<button class="slot__del" title="Удалить фото" onclick="deleteFromSlot(\\'' + id + '\\')">×</button>' : '');
    return '<div class="slot ' + (isActive ? 'active' : '') + '" data-slotid="' + id + '" ' +
        'ondragover="onSlotDragOver(event,this)" ondragleave="onSlotDragLeave(this)" ondrop="onSlotDrop(event,\\'' + id + '\\')">' +
      '<div class="slot__thumb' + (hasPhoto ? '' : ' empty') + '" style="' + thumbStyle + '" onclick="selectSlot(\\'' + id + '\\')"></div>' +
      '<div class="slot__body" onclick="selectSlot(\\'' + id + '\\')">' +
        '<div class="slot__name">' + escHtml(name) + '</div>' +
        '<div class="slot__meta">' + escHtml(meta || '') + '</div>' +
        '<div class="slot__status ' + (hasPhoto ? 'has' : '') + '">' + (hasPhoto ? '✓ фото загружено' : 'фото не загружено') + '</div>' +
      '</div>' +
      '<div class="slot__act">' +
        '<label class="slot__pick">' + pickLabel +
          '<input type="file" accept="image/*" onchange="uploadFromSlot(\\'' + id + '\\', this)">' +
        '</label>' +
        removeBtn +
      '</div>' +
      '<div class="slot__bar"><i></i></div>' +
    '</div>';
  }

  function renderEditor() {
    const id = state.activeSlot;
    let kind, title, hasPhoto, photoUrl, fields = '';
    if (id === 'hero') {
      kind = 'hero'; title = 'Афиша главной';
      hasPhoto = !!(state.eventPoster && state.eventPoster.photo);
      photoUrl = state.eventPoster && state.eventPoster.photo;
      const ep = state.eventPoster || {};
      fields =
        '<div class="row"><label>Название ивента</label><input type="text" id="f-title" value="' + escHtml(ep.title || '') + '" placeholder="Round 01 — Orlando"></div>' +
        '<div class="row"><label>Дата</label><input type="text" id="f-date" value="' + escHtml(ep.date || '') + '" placeholder="12 SEP 2026"></div>' +
        '<div class="row"><label>Трасса</label><input type="text" id="f-track" value="' + escHtml(ep.track || '') + '" placeholder="Orlando Speed World"></div>' +
        '<div class="row"><label>Ссылка регистрации</label><input type="text" id="f-cta" value="' + escHtml(ep.ctaUrl || '') + '" placeholder="https://..."></div>';
    } else if (id.startsWith('driver-')) {
      kind = 'driver';
      const rank = parseInt(id.slice(7), 10);
      const d = state.drivers.find((x) => x.rank === rank);
      if (!d) return '';
      title = 'Фото пилота · #' + d.rank + ' ' + d.name;
      hasPhoto = !!d.photo; photoUrl = d.photo;
    } else if (id.startsWith('track-')) {
      kind = 'track';
      const slug = id.slice(6);
      const t = state.tracks.find((x) => x.slug === slug);
      if (!t) return '';
      title = 'Фото трассы · ' + t.name;
      hasPhoto = !!t.photo; photoUrl = t.photo;
    } else { return ''; }

    const spec = SPECS[kind] || {};
    const photoActions = hasPhoto
      ? '<label class="pick">Заменить фото<input type="file" accept="image/*" onchange="uploadSlot(this)"></label>' +
        '<button class="danger" onclick="deleteSlot()">Удалить</button>'
      : '<label class="pick">Загрузить фото<input type="file" accept="image/*" onchange="uploadSlot(this)"></label>';

    const saveBtn = (id === 'hero')
      ? '<button onclick="saveHeroFields()">Сохранить текст</button><span class="save-tag" id="save-tag">сохранено ✓</span>'
      : '';

    return '<div class="editor">' +
      '<h3>' + escHtml(title) + '</h3>' +
      '<div class="req"><b>Требования:</b> ' + escHtml(spec.min || '') + ' минимум · до ' + escHtml(spec.max || '') + '. ' + escHtml(spec.note || '') + '</div>' +
      fields +
      '<div class="actions">' + photoActions + saveBtn + '</div>' +
      '<div class="progress" id="progress"><i></i></div>' +
    '</div>';
  }

  function uploadFile(slotId, file, barEl) {
    return new Promise((resolve) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('slot', slotId);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/admin/api/upload-slot');
      const inner = barEl ? barEl.querySelector('i') : null;
      if (barEl) { barEl.classList.add('show'); barEl.classList.remove('done'); if (inner) inner.style.width = '0%'; }
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && inner) inner.style.width = ((e.loaded / e.total) * 100) + '%';
      };
      xhr.onload = async () => {
        if (xhr.status === 200) {
          if (inner) inner.style.width = '100%';
          if (barEl) barEl.classList.add('done');
          toast('Фото загружено');
          await loadAll();
          refreshFrame();
          resolve(true);
        } else {
          toast('Ошибка: ' + xhr.status + ' ' + xhr.responseText);
          if (barEl) barEl.classList.remove('show');
          resolve(false);
        }
      };
      xhr.onerror = () => {
        toast('Сетевая ошибка');
        if (barEl) barEl.classList.remove('show');
        resolve(false);
      };
      xhr.send(fd);
    });
  }

  async function uploadFromSlot(slotId, input) {
    const file = input.files[0];
    if (!file) return;
    const slotEl = document.querySelector('.slot[data-slotid="' + slotId + '"]');
    const bar = slotEl ? slotEl.querySelector('.slot__bar') : null;
    await uploadFile(slotId, file, bar);
  }

  async function deleteFromSlot(slotId) {
    if (!confirm('Удалить фото?')) return;
    await api('/admin/api/delete-slot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot: slotId }),
    });
    await loadAll();
    refreshFrame();
  }

  // The legacy editor-pane upload path (still used by hero) routes to the
  // same upload primitive so the single source of truth is uploadFile().
  async function uploadSlot(input) {
    const file = input.files[0]; if (!file) return;
    const id = state.activeSlot;
    const bar = document.getElementById('progress');
    await uploadFile(id, file, bar);
  }

  async function deleteSlot() {
    if (!confirm('Удалить фото?')) return;
    await api('/admin/api/delete-slot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot: state.activeSlot }),
    });
    await loadAll();
    refreshFrame();
  }

  function onSlotDragOver(e, el) {
    e.preventDefault();
    if (e.dataTransfer && Array.from(e.dataTransfer.items || []).some((it) => it.kind === 'file')) {
      el.classList.add('over');
    }
  }
  function onSlotDragLeave(el) { el.classList.remove('over'); }
  async function onSlotDrop(e, slotId) {
    e.preventDefault();
    const slotEl = document.querySelector('.slot[data-slotid="' + slotId + '"]');
    if (slotEl) slotEl.classList.remove('over');
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files[0]) return;
    const bar = slotEl ? slotEl.querySelector('.slot__bar') : null;
    await uploadFile(slotId, files[0], bar);
  }

  async function saveHeroFields() {
    const body = {
      title: document.getElementById('f-title').value.trim(),
      date: document.getElementById('f-date').value.trim(),
      track: document.getElementById('f-track').value.trim(),
      ctaUrl: document.getElementById('f-cta').value.trim(),
    };
    await api('/admin/api/save-hero-fields', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const tag = document.getElementById('save-tag');
    if (tag) { tag.classList.add('show'); setTimeout(() => tag.classList.remove('show'), 1800); }
    await loadAll();
    refreshFrame();
  }

  function renderGallerySection() {
    // Whole zone is a <label> so any click bubbles to the file input. The
    // older "click the small word 'выбери'" UX failed on desktop — users
    // didn't realize the link was a button.
    const drop = '<label class="gallery-drop" id="drop-zone" ondragover="onDrag(event,true)" ondragleave="onDrag(event,false)" ondrop="onDrop(event)">' +
      '<b>+ Добавить фото и видео</b>' +
      '<span>Перетащи файлы сюда или <em>нажми</em>, чтобы выбрать</span>' +
      '<input type="file" multiple accept="image/*,video/*" onchange="uploadGallery(this.files)">' +
      '<div style="font-size:10px;margin-top:6px;color:var(--muted)">Фото до 25 МБ · Видео до 200 МБ · можно сразу несколько</div>' +
      '</label>';
    const grid = state.gallery.length
      ? '<div class="gal-grid">' + state.gallery.map((g) =>
          '<div class="gal-item">' +
            (g.kind === 'video'
              ? '<video src="' + escHtml(g.url) + '" muted preload="metadata"></video>'
              : '<img src="' + escHtml(g.url) + '" alt="">') +
            '<div class="meta">' + escHtml(g.filename || '').slice(0, 24) + '</div>' +
            '<button class="del" onclick="removeGallery(\\'' + g.id + '\\')">×</button>' +
          '</div>').join('') +
        '</div>'
      : '';
    return drop + grid;
  }

  function onDrag(e, on) { e.preventDefault(); document.getElementById('drop-zone').classList.toggle('over', on); }
  function onDrop(e) { e.preventDefault(); document.getElementById('drop-zone').classList.remove('over'); uploadGallery(e.dataTransfer.files); }

  async function uploadGallery(files) {
    for (const f of files) {
      const fd = new FormData(); fd.append('file', f);
      const r = await fetch('/admin/api/upload-gallery', { method: 'POST', credentials: 'same-origin', body: fd });
      if (r.ok) toast('Загружен: ' + f.name);
      else toast('Ошибка ' + f.name + ': ' + r.status);
    }
    await loadAll();
  }

  async function removeGallery(id) {
    if (!confirm('Удалить файл?')) return;
    await fetch('/admin/api/remove-gallery', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    await loadAll();
  }

  // After every iframe load, re-apply highlight if there's an active slot.
  document.getElementById('frame').addEventListener('load', () => {
    if (state.activeSlot) highlightInFrame(state.activeSlot);
  });

  loadAll();
</script>
</body></html>`;

app.get("/admin", { preHandler: requireAuth }, async (req, reply) => {
  const html = DASH_HTML
    .replace("$WHO$", escapeHtml(req.adminUser))
    .replace("$SPECS$", JSON.stringify(PHOTO_SPECS));
  reply.type("text/html").send(html);
});

// --- API ---

app.get("/admin/api/all", { preHandler: requireAuth }, async () => {
  const data = await readJson(DRIFT_DATA, {});
  const gallery = await readJson(GALLERY_FILE, []);
  return {
    drivers: data.drivers || [],
    tracks: data.tracks || [],
    eventPoster: data.eventPoster || {},
    gallery,
  };
});

// Resolve a slot id like "hero" / "driver-3" / "track-orlando-speed-world"
// into { kind, dirName, target } where target is the JSON node we'll mutate.
function resolveSlot(slotId, data) {
  if (slotId === "hero") {
    if (!data.eventPoster) data.eventPoster = { photo: null, title: null, date: null, track: null, ctaUrl: null };
    return { kind: "hero", dirName: "hero", target: data.eventPoster, photoPrefix: "/photos/hero/" };
  }
  if (slotId.startsWith("driver-")) {
    const rank = parseInt(slotId.slice(7), 10);
    const dr = (data.drivers || []).find((x) => x.rank === rank);
    if (!dr) return null;
    return { kind: "driver", dirName: "drivers", target: dr, photoPrefix: "/photos/drivers/" };
  }
  if (slotId.startsWith("track-")) {
    const slug = slotId.slice(6);
    const tr = (data.tracks || []).find((x) => x.slug === slug);
    if (!tr) return null;
    return { kind: "track", dirName: "tracks", target: tr, photoPrefix: "/photos/tracks/" };
  }
  return null;
}

app.post("/admin/api/upload-slot", { preHandler: requireAuth }, async (req, reply) => {
  const parts = req.parts();
  let file = null;
  let slotId = null;
  for await (const part of parts) {
    if (part.type === "file") file = part;
    else if (part.fieldname === "slot") slotId = part.value;
  }
  if (!file || !slotId) return reply.code(400).send({ error: "missing fields" });
  const ext = extname(file.filename).toLowerCase();
  if (!ALLOWED_PHOTO.has(ext)) return reply.code(400).send({ error: "photo type not allowed" });
  const buf = await file.toBuffer();
  if (buf.length > PHOTO_MAX) return reply.code(400).send({ error: "too large" });

  const data = await readJson(DRIFT_DATA, {});
  const slot = resolveSlot(slotId, data);
  if (!slot) return reply.code(404).send({ error: "slot not found" });

  const dir = join(PHOTO_DIR, slot.dirName);
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const original = `${slotId}--${stamp}-${file.filename}`;
  const fname = uniqueName(dir, original);
  await writeFile(join(dir, fname), buf);

  // Remove the previous file if it points into our managed photos dir
  if (slot.target.photo && slot.target.photo.startsWith(slot.photoPrefix)) {
    await unlink(join(PUB, slot.target.photo)).catch(() => {});
  }
  slot.target.photo = `${slot.photoPrefix}${fname}`;

  await writeJson(DRIFT_DATA, data);
  await syncDriftDataJs(data);
  await logUpload(req.adminUser, slot.kind + "-photo", slotId, fname, buf.length);
  return { ok: true, url: slot.target.photo };
});

app.post("/admin/api/delete-slot", { preHandler: requireAuth }, async (req, reply) => {
  const { slot: slotId } = req.body ?? {};
  if (!slotId) return reply.code(400).send({ error: "bad" });
  const data = await readJson(DRIFT_DATA, {});
  const slot = resolveSlot(slotId, data);
  if (!slot) return reply.code(404).send({ error: "slot not found" });
  if (slot.target.photo && slot.target.photo.startsWith(slot.photoPrefix)) {
    await unlink(join(PUB, slot.target.photo)).catch(() => {});
  }
  slot.target.photo = null;
  await writeJson(DRIFT_DATA, data);
  await syncDriftDataJs(data);
  return { ok: true };
});

app.post("/admin/api/drivers", { preHandler: requireAuth }, async (req, reply) => {
  const b = req.body ?? {};
  const name = String(b.name || "").trim();
  const country = String(b.country || "").trim();
  if (!name || !country) return reply.code(400).send({ error: "name and country required" });
  const data = await readJson(DRIFT_DATA, {});
  if (!Array.isArray(data.drivers)) data.drivers = [];
  const nextRank = data.drivers.length ? Math.max(...data.drivers.map((d) => d.rank || 0)) + 1 : 1;
  const driver = {
    rank: nextRank,
    name: name.slice(0, 80),
    flag: b.flag ? String(b.flag).slice(0, 16) : null,
    country: country.slice(0, 80),
    car: b.car ? String(b.car).slice(0, 120) : "",
    engine: b.engine ? String(b.engine).slice(0, 80) : "",
    hp: b.hp ? Number(b.hp) || 0 : 0,
    boost: null, diff: null, tires: null,
    titles: [], tags: [], category: "world",
    photo: null,
    instagram: b.instagram ? String(b.instagram).slice(0, 80) : null,
  };
  data.drivers.push(driver);
  await writeJson(DRIFT_DATA, data);
  await syncDriftDataJs(data);
  return driver;
});

app.delete("/admin/api/drivers/:rank", { preHandler: requireAuth }, async (req, reply) => {
  const rank = parseInt(req.params.rank, 10);
  if (!Number.isFinite(rank)) return reply.code(400).send({ error: "bad rank" });
  const data = await readJson(DRIFT_DATA, {});
  const idx = (data.drivers || []).findIndex((x) => x.rank === rank);
  if (idx === -1) return reply.code(404).send({ error: "not found" });
  const dr = data.drivers[idx];
  if (dr.photo && dr.photo.startsWith("/photos/drivers/")) {
    await unlink(join(PUB, dr.photo)).catch(() => {});
  }
  data.drivers.splice(idx, 1);
  await writeJson(DRIFT_DATA, data);
  await syncDriftDataJs(data);
  return { ok: true };
});

app.post("/admin/api/tracks", { preHandler: requireAuth }, async (req, reply) => {
  const b = req.body ?? {};
  const name = String(b.name || "").trim();
  if (!name) return reply.code(400).send({ error: "name required" });
  const data = await readJson(DRIFT_DATA, {});
  if (!Array.isArray(data.tracks)) data.tracks = [];
  // Slug from name: lowercase ASCII-ish, fall back to timestamp if collision
  const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "track";
  let slug = baseSlug, i = 1;
  while (data.tracks.some((x) => x.slug === slug)) { slug = `${baseSlug}-${i++}`; }
  const track = {
    name: name.slice(0, 120),
    slug,
    country: b.country ? String(b.country).slice(0, 80) : "",
    region: b.region ? String(b.region).slice(0, 80) : "",
    city: b.city ? String(b.city).slice(0, 80) : "",
    address: null,
    series: [],
    level: b.level ? String(b.level).slice(0, 32) : "",
    type: null,
    description: b.description ? String(b.description).slice(0, 400) : "",
    website: null,
    mapsUrl: b.mapsUrl ? String(b.mapsUrl).slice(0, 400) : null,
    photo: null,
  };
  data.tracks.push(track);
  await writeJson(DRIFT_DATA, data);
  await syncDriftDataJs(data);
  return track;
});

app.delete("/admin/api/tracks/:slug", { preHandler: requireAuth }, async (req, reply) => {
  const slug = req.params.slug;
  if (!slug) return reply.code(400).send({ error: "bad slug" });
  const data = await readJson(DRIFT_DATA, {});
  const idx = (data.tracks || []).findIndex((x) => x.slug === slug);
  if (idx === -1) return reply.code(404).send({ error: "not found" });
  const tr = data.tracks[idx];
  if (tr.photo && tr.photo.startsWith("/photos/tracks/")) {
    await unlink(join(PUB, tr.photo)).catch(() => {});
  }
  data.tracks.splice(idx, 1);
  await writeJson(DRIFT_DATA, data);
  await syncDriftDataJs(data);
  return { ok: true };
});

app.post("/admin/api/save-hero-fields", { preHandler: requireAuth }, async (req, reply) => {
  const { title, date, track, ctaUrl } = req.body ?? {};
  const data = await readJson(DRIFT_DATA, {});
  if (!data.eventPoster) data.eventPoster = { photo: null };
  data.eventPoster.title = title || null;
  data.eventPoster.date = date || null;
  data.eventPoster.track = track || null;
  data.eventPoster.ctaUrl = ctaUrl || null;
  await writeJson(DRIFT_DATA, data);
  await syncDriftDataJs(data);
  return { ok: true };
});

app.post("/admin/api/upload-gallery", { preHandler: requireAuth }, async (req, reply) => {
  const file = await req.file();
  if (!file) return reply.code(400).send({ error: "no file" });
  const ext = extname(file.filename).toLowerCase();
  const isPhoto = ALLOWED_PHOTO.has(ext);
  const isVideo = ALLOWED_VIDEO.has(ext);
  if (!isPhoto && !isVideo) return reply.code(400).send({ error: "type not allowed" });
  const buf = await file.toBuffer();
  if (isPhoto && buf.length > PHOTO_MAX) return reply.code(400).send({ error: "photo too large" });
  if (isVideo && buf.length > VIDEO_MAX) return reply.code(400).send({ error: "video too large" });
  await mkdir(GALLERY_DIR, { recursive: true });
  const fname = uniqueName(GALLERY_DIR, file.filename);
  await writeFile(join(GALLERY_DIR, fname), buf);
  const list = await readJson(GALLERY_FILE, []);
  const item = {
    id: randomBytes(8).toString("hex"),
    filename: file.filename,
    storedAs: fname,
    kind: isVideo ? "video" : "photo",
    size: buf.length,
    url: `/gallery/${fname}`,
    uploadedAt: new Date().toISOString(),
    uploadedBy: req.adminUser,
  };
  list.unshift(item);
  await writeJson(GALLERY_FILE, list);
  await logUpload(req.adminUser, "gallery-" + item.kind, "—", fname, buf.length);
  return item;
});

app.post("/admin/api/remove-gallery", { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.body ?? {};
  if (!id) return reply.code(400).send({ error: "bad" });
  const list = await readJson(GALLERY_FILE, []);
  const idx = list.findIndex((x) => x.id === id);
  if (idx === -1) return reply.code(404).send({ error: "not found" });
  const item = list[idx];
  await unlink(join(GALLERY_DIR, item.storedAs)).catch(() => {});
  list.splice(idx, 1);
  await writeJson(GALLERY_FILE, list);
  return { ok: true };
});

app.get("/admin/health", async () => ({ ok: true }));

const start = async () => {
  await app.listen({ port: PORT, host: "127.0.0.1" });
  console.log(`Dark Force admin listening on 127.0.0.1:${PORT}`);
};
start().catch((e) => { console.error(e); process.exit(1); });
