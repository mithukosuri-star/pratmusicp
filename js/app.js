/* ═════════════════════════════════════════════════════════════════
   PRATMUSIC — offline music player · engine + UI
   everything lives on-device: bundled open-licensed catalogue (library.json)
   plus anything you import (IndexedDB). No network calls at runtime.
   ═════════════════════════════════════════════════════════════════ */
(() => {
'use strict';
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const LS = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

/* ── state ─────────────────────────────────────────────────────── */
const S = {
  tracks: [], byId: {}, order: [], qi: -1, playing: false,
  shuffle: LS.get('pratmusic.shuffle', false), repeat: LS.get('pratmusic.repeat', 'off'),
  vol: LS.get('pratmusic.vol', 0.85), muted: LS.get('pratmusic.muted', false),
  xfade: LS.get('pratmusic.xfade', 4), viz: LS.get('pratmusic.viz', 0), resume: LS.get('pratmusic.resume', true),
  favs: new Set(LS.get('pratmusic.favs', [])), genre: 'all', query: '', view: 'home', layout: LS.get('pratmusic.layout', 'grid'),
  sleepEnd: 0, recent: LS.get('pratmusic.recent', []), pos: LS.get('pratmusic.pos', {}),
  acc: '#a05cff', acc2: '#20c4ff', scrub: false, urls: {}
};

/* ── colour utils (dynamic theming) ────────────────────────────── */
function hex2hsl(hex) {
  let [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
  return [h * 360, s * 100, l * 100];
}
function hsl2hex(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}
function setAccent(t) {
  const base = t?.accent || '#a05cff';
  const [h, s, l] = hex2hsl(base);
  S.acc = hsl2hex(h, clamp(s + 14, 45, 96), clamp(l + 6, 42, 68));
  S.acc2 = hsl2hex(h + 52, clamp(s + 8, 45, 95), clamp(l + 12, 45, 70));
  const r = document.documentElement.style;
  r.setProperty('--acc', S.acc); r.setProperty('--acc2', S.acc2);
  r.setProperty('--deep', t?.deep || '#120a24');
  const meta = $('meta[name=theme-color]'); if (meta) meta.content = t?.deep || '#06060b';
}
/* procedural cover for imported files */
function phCover(seed) {
  let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 360;
  const a = `hsl(${h},70%,55%)`, b = `hsl(${(h + 60) % 360},75%,45%)`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient></defs><rect width='300' height='300' fill='url(#g)'/><circle cx='150' cy='150' r='86' fill='none' stroke='rgba(255,255,255,.85)' stroke-width='7'/><circle cx='150' cy='150' r='26' fill='rgba(0,0,0,.55)'/><path d='M162 96v70a26 26 0 1 1-14-23V110l42-10v56' fill='none' stroke='rgba(255,255,255,.9)' stroke-width='7' stroke-linecap='round'/></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

/* ── audio engine: two decks + WebAudio analyser, crossfade ────── */
const decks = [new Audio(), new Audio()];
let active = 0, ctxA = null, analyser = null, gains = [], playToken = 0;
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) { r = Math.min(r, w / 2, h / 2);
    this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath(); return this; };
}
decks.forEach((d) => { d.preload = 'auto'; d.crossOrigin = 'anonymous'; });
function ensureAudio() {
  if (ctxA) { if (ctxA.state === 'suspended') ctxA.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ctxA = new AC();
  analyser = ctxA.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.82;
  gains = decks.map((d) => { const g = ctxA.createGain(); g.gain.value = 0; ctxA.createMediaElementSource(d).connect(g); g.connect(analyser); return g; });
  analyser.connect(ctxA.destination);
  if (gains[active]) gains[active].gain.value = 1;
  if (ctxA.state === 'suspended') ctxA.resume();
}
function applyVolume() { decks.forEach((d) => { d.volume = S.muted ? 0 : S.vol; }); }
function urlFor(t) {
  if (t.kind === 'user') { if (!S.urls[t.id] && t.blob) S.urls[t.id] = URL.createObjectURL(t.blob); return S.urls[t.id]; }
  return t.file;
}
const cur = () => (S.qi >= 0 ? S.byId[S.order[S.qi]] : null);
const deck = () => decks[active];

function playAt(qi, opts = {}) {
  const id = S.order[qi]; const t = S.byId[id]; if (!t || qi < 0) return;
  S.qi = qi;
  const my = ++playToken;
  const incoming = 1 - active, dIn = decks[incoming], dOut = decks[active];
  const wasPlaying = S.playing;
  const start = () => {
    if (my !== playToken) return;
    ensureAudio(); applyVolume();
    dIn.play().then(() => {
      S.playing = true; document.body.classList.remove('paused');
      if (S.xfade > 0 && wasPlaying && gains.length) {
        const g0 = gains[active], g1 = gains[incoming], now = ctxA.currentTime;
        g1.gain.cancelScheduledValues(now); g1.gain.setValueAtTime(0.0001, now);
        g1.gain.exponentialRampToValueAtTime(1, now + S.xfade);
        g0.gain.cancelScheduledValues(now); g0.gain.setValueAtTime(Math.max(g0.gain.value, 0.0001), now);
        g0.gain.exponentialRampToValueAtTime(0.0001, now + S.xfade);
        setTimeout(() => { dOut.pause(); if (gains[active] && active !== incoming) gains[active].gain.value = 0; }, S.xfade * 1000 + 120);
      } else if (gains.length) { gains[incoming].gain.value = 1; gains[active].gain.value = 0; }
      active = incoming;
      onTrackStart(t, opts);
    }).catch((e) => { toast(`Couldn't play <b>${esc(t.title)}</b> — ${esc(e.name)}`); });
  };
  dIn.onerror = () => toast(`Audio error on <b>${esc(t.title)}</b>`);
  dIn.src = urlFor(t);
  if (S.resume && S.pos[t.id] && !opts.fresh) {
    const p = S.pos[t.id];
    dIn.addEventListener('loadedmetadata', () => { if (p > 5 && p < dIn.duration - 8) dIn.currentTime = p; }, { once: true });
  }
  if (dIn.readyState >= 3) start(); else dIn.addEventListener('canplay', start, { once: true });
}

function onTrackStart(t, opts) {
  setAccent(t);
  S.recent = [t.id, ...S.recent.filter((x) => x !== t.id)].slice(0, 12); LS.set('pratmusic.recent', S.recent);
  document.title = `${t.title} — ${t.artist} · PratMusic`;
  syncPlayerUI(); renderQueue(); renderView(true);
  mediaSession(t);
  if (!opts.silent) toast(`▶ <b>${esc(t.title)}</b> — ${esc(t.artist)}`);
}
function togglePlay() {
  const t = cur(); if (!t) { const ids = visibleIds(); if (ids.length) playList(ids, ids[0]); return; }
  if (S.playing) { deck().pause(); S.playing = false; document.body.classList.add('paused'); }
  else { ensureAudio(); deck().play().then(() => { S.playing = true; document.body.classList.remove('paused'); }); }
  syncPlayerUI();
}
function next(auto) {
  if (!S.order.length) return;
  if (S.qi + 1 < S.order.length) playAt(S.qi + 1);
  else if (S.repeat === 'all') playAt(0);
  else if (!auto) playAt(S.qi);
  else { S.playing = false; deck().pause(); syncPlayerUI(); }
}
function prev() {
  if (!S.order.length) return;
  if (deck().currentTime > 3.5) { deck().currentTime = 0; return; }
  playAt(S.qi - 1 >= 0 ? S.qi - 1 : (S.repeat === 'all' ? S.order.length - 1 : 0));
}
decks.forEach((d, i) => d.addEventListener('ended', () => { if (i !== active) return;
  const t = cur(); if (!t) return;
  if (S.repeat === 'one') { d.currentTime = 0; d.play(); return; }
  S.pos[t.id] = 0; LS.set('pratmusic.pos', S.pos); LS.set('pratmusic.recent', S.recent);
  next(true);
}));
decks.forEach((d, i) => d.addEventListener('timeupdate', () => { if (i === active && cur()) { S.pos[cur().id] = d.currentTime; } }));
setInterval(() => { if (cur()) LS.set('pratmusic.pos', S.pos); }, 4000);

function playList(ids, id) {
  let list = (ids && ids.length) ? ids.slice() : visibleIds();
  if (!list.length) list = S.tracks.map((t) => t.id);
  if (!list.includes(id)) list = [id, ...list];
  if (S.shuffle) { const rest = list.filter((x) => x !== id); shuffleArr(rest); S.order = [id, ...rest]; }
  else S.order = [...list];
  playAt(Math.max(0, S.order.indexOf(id)));
}
function shuffleArr(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function toggleShuffle() {
  S.shuffle = !S.shuffle; LS.set('pratmusic.shuffle', S.shuffle);
  const t = cur();
  if (t) { const pool = visibleIds().length ? visibleIds() : S.order;
    if (S.shuffle) { const rest = pool.filter((x) => x !== t.id); shuffleArr(rest); S.order = [t.id, ...rest]; S.qi = 0; }
    else { S.order = pool; S.qi = Math.max(0, pool.indexOf(t.id)); } }
  syncPlayerUI(); renderQueue(); toast(`Shuffle <b>${S.shuffle ? 'on' : 'off'}</b>`);
}
function cycleRepeat() { S.repeat = S.repeat === 'off' ? 'all' : S.repeat === 'all' ? 'one' : 'off'; LS.set('pratmusic.repeat', S.repeat);
  syncPlayerUI(); toast(`Repeat <b>${S.repeat === 'off' ? 'off' : S.repeat}</b>`); }

/* ── library & filtering ───────────────────────────────────────── */
function allTracks() { return S.tracks; }
function visibleIds() {
  const q = S.query.trim().toLowerCase();
  return S.tracks.filter((t) =>
    (S.genre === 'all' || t.genre === S.genre) &&
    (!q || [t.title, t.artist, t.album, t.genre, t.mood, ...(t.vibe || [])].join(' ').toLowerCase().includes(q))
  ).map((t) => t.id);
}
const genres = () => [...new Set(S.tracks.map((t) => t.genre))];

/* big-name pop artists we match by vibe only — their masters are never bundled */
const VIBE_ARTISTS = [
  ['Lana Del Rey', 'cinematic dream-pop'],
  ['The Neighbourhood', 'dark indie pop'],
  ['Dua Lipa', 'disco dance-pop'],
  ['Rihanna', 'dance-floor electropop'],
  ['Lady Gaga', 'synth-pop hooks']
];

/* ── rendering ────────────────────────────────────────────────── */
const viewEl = $('#view');
function coverOf(t) { return t.cover || phCover(t.id + t.title); }
function favBtn(id, on) { return `<button class="fav ${on ? 'on' : ''}" data-fav="${id}" title="Favorite">${on ? '♥' : '♡'}</button>`; }
function eqHtml() { return `<span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`; }

function cardHtml(t) {
  const playing = cur()?.id === t.id;
  return `<article class="card ${playing ? 'playing' : ''}" style="--tc:${t.accent || S.acc}" data-card="${t.id}">
    ${favBtn(t.id, S.favs.has(t.id))}
    <div class="cov" data-play="${t.id}"><img loading="lazy" src="${coverOf(t)}" alt="${esc(t.title)} cover">
      <div class="go"><b>${playing && S.playing ? eqHtml() : `<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>`}</b></div></div>
    <div class="t" title="${esc(t.title)}">${esc(t.title)}</div>
    <div class="a" title="${esc(t.artist)}">${esc(t.artist)}</div>
    <div class="rowline"><span class="g">${esc(t.genre)}</span><span class="d">${fmt(t.duration)}</span></div>
  </article>`;
}
function rowHtml(t, extra = '') {
  const playing = cur()?.id === t.id;
  return `<div class="row ${playing ? 'playing' : ''}" style="--tc:${t.accent || S.acc}" data-row="${t.id}">
    <div class="cov" data-play="${t.id}"><img loading="lazy" src="${coverOf(t)}" alt="">
      <div class="go">${playing && S.playing ? eqHtml() : `<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>`}</div></div>
    <div><div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist)} · ${esc(t.album)}</div></div>
    <span class="g">${esc(t.genre)}</span><span class="d">${fmt(t.duration)}</span>
    <div class="acts">${favBtn(t.id, S.favs.has(t.id))}${extra}</div></div>`;
}
function gridOrRows(list) {
  if (!list.length) return `<div class="empty"><b>Nothing here yet</b>Try another search, genre or drop some audio files in.</div>`;
  return S.layout === 'grid' ? `<div class="grid">${list.map(cardHtml).join('')}</div>` : `<div class="rows">${list.map((t) => rowHtml(t)).join('')}</div>`;
}
function heroHtml(t) {
  return `<div class="hero" style="--tc:${t.accent || S.acc}">
    <div class="art"><img src="${coverOf(t)}" alt=""></div>
    <div class="in">
      <div class="cov"><img src="${coverOf(t)}" alt=""></div>
      <div>
        <div class="tags"><span class="tag">today's pick</span><span class="tag">${esc(t.genre)}</span><span class="tag">${fmt(t.duration)}</span></div>
        <h1>${esc(t.title)}</h1>
        <div class="sub">${esc(t.artist)} — ${esc(t.album)}${t.year ? ' · ' + esc(t.year) : ''}</div>
        <button class="cta" data-play="${t.id}"><svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>Play now</button>
      </div>
    </div></div>`;
}
function demoBannerHtml() {
  if (!S.tracks.some((t) => t.placeholder)) return '';
  return `<div class="demo-banner"><b>Preview build</b> — bundled audio is generated demo placeholders right now. Run <code>python3 tools/build_library.py</code> with Internet access to fetch the licensed masters.</div>`;
}
function byoTeaserHtml() {
  return `<div class="byo-teaser">
    <div><b>Bring your own files</b><span>own Lana Del Rey, The Neighbourhood, Dua Lipa, Rihanna or Lady Gaga? drop those files in — they live in this browser, offline forever.</span></div>
    <button class="cta" data-goto="uploads">Open panel</button></div>`;
}
function byoHtml() {
  const chips = VIBE_ARTISTS.map(([name, tag]) =>
    `<button class="vibe-chip" data-vibe="${esc(name)}" title="Find open-licensed tracks with a ${esc(name)} vibe"><b>${esc(name)}</b><span>${esc(tag)}</span></button>`).join('');
  const used = new Set(), picked = [];
  for (const [name] of VIBE_ARTISTS) {
    const cand = S.tracks.filter((x) => (x.vibe || []).includes(name));
    const t = cand.find((x) => !used.has(x.id)) || cand[0];
    if (t) { used.add(t.id); picked.push({ name, t }); }
  }
  const matches = picked.map(({ name, t }) => `
    <div class="vibe-match" style="--tc:${t.accent || S.acc}" data-play="${t.id}" title="Play ${esc(t.title)}">
      <img src="${coverOf(t)}" alt=""><div class="vm-t"><b>${esc(t.title)}</b><span>${esc(t.artist)}</span><em>vibe · ${esc(name)}</em></div></div>`).join('');
  return `<section class="byo">
    <div class="byo-head">
      <div class="byo-kicker">bring your own files</div>
      <h2>Craving the big pop voices?</h2>
      <p>Love the sound of <b>Lana Del Rey</b>, <b>The Neighbourhood</b>, <b>Dua Lipa</b>, <b>Rihanna</b> or <b>Lady Gaga</b>?
      Their actual records are copyrighted and are <b>never bundled here</b>. Drop in the files <i>you</i> own and
      PratMusic keeps them on this device — offline playback, visualizer, two-deck crossfade, favourites, media keys.</p>
      <div class="byo-artists">${chips}</div>
    </div>
    <div class="byo-drop" id="byoDrop">
      <div class="byo-drop-in">
        <b>Drop your audio files here</b>
        <span>mp3 · m4a · flac · wav · ogg · opus — saved to IndexedDB, never uploaded, plays in airplane mode</span>
        <div class="byo-btns">
          <button class="cta" data-byo="files"><svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>add files</button>
          <button class="ghost" data-byo="folder">📁 add whole folder</button>
        </div>
      </div>
    </div>
    <div class="byo-matches">
      <div class="tiny">While you dig up your files — open-licensed tracks that share the vibe <i>(never their songs)</i>:</div>
      <div class="vibe-grid">${matches}</div>
    </div>
  </section>`;
}
function renderView(soft) {
  const tracks = allTracks();
  const ids = visibleIds(), list = ids.map((id) => S.byId[id]);
  let html = '';
  if (S.view === 'home') {
    const day = Math.floor(Date.now() / 864e5);
    const pick = tracks[day % tracks.length] || tracks[0];
    const mins = Math.round(tracks.reduce((a, t) => a + (t.duration || 0), 0) / 60);
    const artists = new Set(tracks.map((t) => t.artist)).size;
    html = (pick ? heroHtml(pick) : '') +
      `<div class="stats">
        <div class="stat"><b>${tracks.length}</b><span>tracks on device</span></div>
        <div class="stat"><b>${artists}</b><span>artists</span></div>
        <div class="stat"><b>${genres().length}</b><span>genres</span></div>
        <div class="stat"><b>${mins}</b><span>minutes of music</span></div>
      </div>`;
    const rec = S.recent.map((id) => S.byId[id]).filter(Boolean).slice(0, 6);
    if (rec.length) html += `<div class="sec"><h2>Jump back in</h2></div><div class="rows">${rec.map((t) => rowHtml(t)).join('')}</div>`;
    html += byoTeaserHtml();
    html += `<div class="sec"><h2>The vault</h2><span class="tiny">${tracks.length} tracks · all stored offline</span></div>` + gridOrRows(list);
  } else if (S.view === 'library') {
    html = `<div class="sec"><h2>Library</h2><span class="tiny">${list.length} of ${tracks.length} tracks</span>
      <button class="ghost" id="layoutBtn" style="margin-left:10px">${S.layout === 'grid' ? '☰ list' : '▦ grid'}</button></div>` + gridOrRows(list);
  } else if (S.view === 'favs') {
    const favs = tracks.filter((t) => S.favs.has(t.id));
    html = `<div class="sec"><h2>Favorites</h2><span class="tiny">${favs.length} loved tracks</span></div>` +
      (favs.length ? `<div class="rows">${favs.map((t) => rowHtml(t)).join('')}</div>` : `<div class="empty"><b>No favorites yet</b>Tap the ♡ on any track to keep it close.</div>`);
  } else if (S.view === 'uploads') {
    const ups = tracks.filter((t) => t.kind === 'user');
    html = byoHtml() +
      (ups.length ? `<div class="sec"><h2>Your music</h2><span class="tiny">${ups.length} imported · stored in this browser</span></div>
        <div class="rows">${ups.map((t) => rowHtml(t, `<button class="icon-btn" data-del="${t.id}" title="Remove from device">🗑</button>`)).join('')}</div>` : '');
  } else if (S.view === 'credits') {
    html = `<div class="sec"><h2>Credits & licences</h2></div><div class="credits">
      <p>Every bundled track is openly licensed by its artist and hosted on the <a href="https://archive.org" target="_blank" rel="noopener">Internet Archive</a>. PratMusic keeps the audio unmodified and credits each work below — please support the artists.</p>
      <p>Tracks tagged with big-name <i>vibes</i> (Lana Del Rey, The Neighbourhood, Dua Lipa, Rihanna, Lady Gaga) are open-licensed look-alikes, <b>never the original recordings</b>. Own those records? <a href="#uploads" data-goto="uploads">Bring your own files</a> — they stay on this device.</p>
      <div class="rows">${tracks.filter((t) => t.kind === 'bundled').map((t) => `<div class="row" style="--tc:${t.accent}">
        <div class="cov"><img src="${coverOf(t)}" alt=""></div>
        <div><div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist)} — ${esc(t.album)}${t.placeholder ? ' · <em class="demo-tag">demo placeholder</em>' : ''}</div></div>
        <span class="g" style="text-align:right">${esc(t.licenseName)}<br><a href="${esc(t.source)}" target="_blank" rel="noopener">archive.org ↗</a></span></div>`).join('')}</div>
      <p style="margin-top:16px">Imported files never leave your device. PratMusic itself is a single offline web app — install it and it works in airplane mode.</p></div>`;
  }
  viewEl.innerHTML = demoBannerHtml() + html;
  if (!soft) { viewEl.classList.remove('swap'); void viewEl.offsetWidth; viewEl.classList.add('swap'); }
  renderGenreChips();
}
function renderViewSoft() { renderView(true); }
function renderGenreChips() {
  const el = $('#genreChips'); if (!el) return;
  const gs = genres();
  el.innerHTML = `<button class="gchip ${S.genre === 'all' ? 'on' : ''}" data-genre="all">All</button>` +
    gs.map((g) => `<button class="gchip ${S.genre === g ? 'on' : ''}" data-genre="${esc(g)}">${esc(g)}</button>`).join('');
}
function renderQueue() {
  const ol = $('#queueList'); if (!ol) return;
  $('#queueCount').textContent = `${S.order.length} in queue`;
  ol.innerHTML = S.order.map((id, i) => {
    const t = S.byId[id]; if (!t) return '';
    return `<li class="row ${i === S.qi ? 'playing' : ''}" style="--tc:${t.accent || S.acc}" data-qi="${i}">
      <div class="cov"><img src="${coverOf(t)}" alt=""></div>
      <div><div class="t">${i === S.qi && S.playing ? eqHtml() + ' ' : ''}${esc(t.title)}</div><div class="a">${esc(t.artist)}</div></div>
      <span class="d">${fmt(t.duration)}</span>
      <button class="icon-btn sm" data-qdel="${i}" title="Remove">✕</button></li>`;
  }).join('') || `<div class="empty"><b>Queue is empty</b>Play something and it lines up here.</div>`;
}
function syncPlayerUI() {
  const t = cur();
  $('#player').classList.toggle('playing', S.playing);
  $('#np').classList.toggle('on', S.playing);
  document.body.classList.toggle('paused', !S.playing);
  if (t) {
    $('#pCover').src = coverOf(t); $('#pTitle').textContent = t.title; $('#pArtist').textContent = t.artist;
    $('#npCover').src = coverOf(t); $('#npBlur').src = coverOf(t);
    $('#npTitle').textContent = t.title; $('#npArtist').textContent = t.artist;
    $('#npGenre').textContent = t.genre; $('#npYear').textContent = t.year || '—'; $('#npAlbum').textContent = t.album;
    $('#npMood').textContent = t.mood ? `mood · ${t.mood}` : '';
    const lic = $('#npLicence'); lic.textContent = t.licenseName ? `${t.licenseName} · ${t.artist}` : 'your file';
    const src = $('#npSource'); if (t.source) { src.href = t.source; src.classList.remove('hidden'); } else src.classList.add('hidden');
    $('#tDur').textContent = fmt(t.duration); $('#npDur').textContent = fmt(t.duration);
  }
  for (const [btn, on] of [['#shuffleBtn', S.shuffle], ['#npShuffle', S.shuffle]]) $(btn).classList.toggle('on', on);
  for (const b of ['#repeatBtn', '#npRepeat']) { $(b).classList.toggle('on', S.repeat !== 'off'); $(b).classList.toggle('one', S.repeat === 'one'); }
  $('#pFav').classList.toggle('on', t && S.favs.has(t.id)); $('#pFav').textContent = t && S.favs.has(t.id) ? '♥' : '♡';
  const nf = $('#npFav'); nf.classList.toggle('on', t && S.favs.has(t.id)); nf.firstElementChild.textContent = t && S.favs.has(t.id) ? '♥' : '♡';
  $('#muteBtn').classList.toggle('muted', S.muted);
  $('#vizSel').value = String(S.viz); $('#xfadeSel').value = String(S.xfade); $('#resumeChk').checked = S.resume;
}

/* ── progress + visualizer loop ────────────────────────────────── */
const vizC = $('#viz'); let vizCtx = vizC.getContext('2d');
function loop() {
  requestAnimationFrame(loop);
  const d = deck(), t = cur();
  if (t && d.duration) {
    const p = d.currentTime / d.duration;
    for (const [inp, fill] of [['#seek', null], ['#npSeek', null]]) {
      const el = $(inp); if (!el) continue;
      if (!(el.dataset.drag === '1')) { el.value = String(Math.round(p * 1000)); }
      const wrap = el.closest('.seek-wrap'); if (wrap) wrap.querySelector('.seek-fill').style.width = (p * 100) + '%';
    }
    $('#tCur').textContent = fmt(d.currentTime); $('#npCur').textContent = fmt(d.currentTime);
  }
  if (!$('#np').classList.contains('hidden')) drawViz();
}
function sizeViz() { const dpr = Math.min(2, devicePixelRatio || 1); vizC.width = vizC.clientWidth * dpr; vizC.height = vizC.clientHeight * dpr; }
function drawViz() {
  if (!analyser) return;
  const w = vizC.width, h = vizC.height; if (!w || !h) return;
  const g = vizCtx; g.clearRect(0, 0, w, h);
  const n = analyser.frequencyBinCount;
  const grad = g.createLinearGradient(0, 0, w, h); grad.addColorStop(0, S.acc); grad.addColorStop(1, S.acc2);
  if (S.viz === 2) {
    const td = new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(td);
    g.lineWidth = 2.5 * (devicePixelRatio || 1); g.strokeStyle = grad; g.shadowColor = S.acc; g.shadowBlur = 18;
    g.beginPath();
    for (let i = 0; i < td.length; i += 2) { const x = i / td.length * w, y = h * .82 + (td[i] - 128) / 128 * h * .16; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke(); g.shadowBlur = 0; return;
  }
  const fd = new Uint8Array(n); analyser.getByteFrequencyData(fd);
  const at = (i) => fd[Math.floor(Math.pow(i / 64, 1.7) * (n * .72))] / 255;
  if (S.viz === 1) {
    const cx = w / 2, cy = h * 1.06, r0 = Math.min(w, h) * .20;
    let bass = 0; for (let i = 0; i < 8; i++) bass += at(i); bass /= 8;
    g.strokeStyle = grad; g.lineCap = 'round'; g.shadowColor = S.acc; g.shadowBlur = 14;
    for (let i = 0; i <= 72; i++) {
      const a = Math.PI + (i / 72) * Math.PI, v = at(i % 64);
      const r1 = r0 + v * Math.min(w, h) * .34;
      g.lineWidth = Math.max(2, w / 420);
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.stroke();
    }
    g.shadowBlur = 0; g.lineWidth = 2; g.globalAlpha = .4 + bass * .5;
    g.beginPath(); g.arc(cx, cy, r0 * (0.9 + bass * .16), Math.PI, 2 * Math.PI); g.stroke(); g.globalAlpha = 1; return;
  }
  const bars = 84, bw = w / bars;
  g.fillStyle = grad; g.shadowColor = S.acc; g.shadowBlur = 12;
  for (let i = 0; i < bars; i++) {
    const v = at(i), bh = Math.max(3, v * h * .30), x = i * bw + bw * .18, y = h * .88;
    g.globalAlpha = .35 + v * .65;
    g.beginPath(); g.roundRect(x, y - bh, bw * .64, bh, bw * .32); g.fill();
    g.globalAlpha = .16 + v * .22;
    g.beginPath(); g.roundRect(x, y + 4, bw * .64, bh * .3, bw * .32); g.fill();
  }
  g.globalAlpha = 1; g.shadowBlur = 0;
}
requestAnimationFrame(loop);

/* ── UI bindings ───────────────────────────────────────────────── */
function toast(html, ms = 3200) {
  const el = document.createElement('div'); el.className = 'toast'; el.innerHTML = html;
  $('#toasts').appendChild(el); setTimeout(() => { el.style.opacity = 0; el.style.transition = 'opacity .4s'; setTimeout(() => el.remove(), 420); }, ms);
}
function setView(v) {
  S.view = v; $$('#nav .nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  renderView(); history.replaceState(null, '', '#' + v);
}
$('#nav').addEventListener('click', (e) => { const b = e.target.closest('.nav-btn'); if (b) setView(b.dataset.view); });
$('#genreChips').addEventListener('click', (e) => { const b = e.target.closest('.gchip'); if (!b) return; S.genre = b.dataset.genre; renderView(); });

function bindPlay(container) {
  container.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { removeUserTrack(del.dataset.del); return; }
    const fav = e.target.closest('[data-fav]');
    if (fav) { toggleFav(fav.dataset.fav); return; }
    const qd = e.target.closest('[data-qdel]');
    if (qd) { const i = +qd.dataset.qdel; if (i !== S.qi) { S.order.splice(i, 1); if (i < S.qi) S.qi--; renderQueue(); } return; }
    const qi = e.target.closest('[data-qi]');
    if (qi && !e.target.closest('[data-qdel]')) { playAt(+qi.dataset.qi); return; }
    const p = e.target.closest('[data-play]');
    const cd = e.target.closest('[data-card],[data-row]');
    if (p || cd) { const id = p ? p.dataset.play : cd.dataset.card || cd.dataset.row;
      if (cur()?.id === id) { togglePlay(); return; }
      const inQueue = S.order.indexOf(id);
      if (inQueue >= 0 && S.order.length && S.view !== 'library' && S.view !== 'home') playAt(inQueue);
      else playList(visibleIds(), id);
      return; }
    const lb = e.target.closest('#layoutBtn');
    if (lb) { S.layout = S.layout === 'grid' ? 'list' : 'grid'; LS.set('pratmusic.layout', S.layout); renderView(); return; }
    const dz = e.target.closest('#dropZone,#byoDrop');
    if (dz && !e.target.closest('[data-byo]')) { $('#filePick').click(); return; }
    const byo = e.target.closest('[data-byo]');
    if (byo) { (byo.dataset.byo === 'folder' ? folderPick : $('#filePick')).click(); return; }
    const go = e.target.closest('[data-goto]');
    if (go) { e.preventDefault(); setView(go.dataset.goto); return; }
    const vb = e.target.closest('[data-vibe]');
    if (vb) {
      const name = vb.dataset.vibe;
      searchEl.value = name; S.query = name; $('#clearSearch').classList.remove('hidden');
      setViewSoftLibrary(); setView('library'); return;
    }
  });
}
bindPlay(viewEl); bindPlay($('#queueList'));
viewEl.addEventListener('mousemove', (e) => {
  const c = e.target.closest('.card'); if (!c) return;
  const r = c.getBoundingClientRect();
  c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px');
});

function toggleFav(id) {
  if (S.favs.has(id)) S.favs.delete(id); else S.favs.add(id);
  LS.set('pratmusic.favs', [...S.favs]); syncPlayerUI(); renderView(true);
  toast(S.favs.has(id) ? '♥ added to favorites' : 'removed from favorites');
}
$('#pFav').addEventListener('click', () => cur() && toggleFav(cur().id));
$('#npFav').addEventListener('click', () => cur() && toggleFav(cur().id));

$('#playBtn').addEventListener('click', togglePlay); $('#npPlay').addEventListener('click', togglePlay);
$('#nextBtn').addEventListener('click', () => next(false)); $('#npNext').addEventListener('click', () => next(false));
$('#prevBtn').addEventListener('click', prev); $('#npPrev').addEventListener('click', prev);
$('#shuffleBtn').addEventListener('click', toggleShuffle); $('#npShuffle').addEventListener('click', toggleShuffle);
$('#repeatBtn').addEventListener('click', cycleRepeat); $('#npRepeat').addEventListener('click', cycleRepeat);
$('#queueBtn').addEventListener('click', () => { $('#queue').classList.toggle('open'); renderQueue(); });
$('#closeQueue').addEventListener('click', () => $('#queue').classList.remove('open'));
$('#clearQueue').addEventListener('click', () => { const t = cur(); S.order = t ? [t.id] : []; S.qi = 0; renderQueue(); toast('queue cleared'); });

function bindSeek(sel, txt) {
  const el = $(sel);
  const set = () => { const d = deck(); if (d.duration) d.currentTime = (el.value / 1000) * d.duration; };
  el.addEventListener('pointerdown', () => { el.dataset.drag = '1'; });
  el.addEventListener('input', () => { const wrap = el.closest('.seek-wrap'); wrap.querySelector('.seek-fill').style.width = (el.value / 10) + '%'; set(); });
  ['pointerup', 'change'].forEach((ev) => el.addEventListener(ev, () => { el.dataset.drag = '0'; set(); }));
}
bindSeek('#seek'); bindSeek('#npSeek');
const volEl = $('#vol');
function syncVol() { volEl.value = String(Math.round(S.vol * 100)); volEl.closest('.seek-wrap').querySelector('.seek-fill').style.width = (S.vol * 100) + '%'; applyVolume(); $('#muteBtn').classList.toggle('muted', S.muted); }
volEl.addEventListener('input', () => { S.vol = volEl.value / 100; S.muted = false; LS.set('pratmusic.vol', S.vol); LS.set('pratmusic.muted', false); syncVol(); });
$('#muteBtn').addEventListener('click', () => { S.muted = !S.muted; LS.set('pratmusic.muted', S.muted); syncVol(); });

$('#settingsBtn').addEventListener('click', (e) => { e.stopPropagation(); $('#settingsPop').classList.toggle('hidden'); });
document.addEventListener('click', (e) => { if (!e.target.closest('#settingsPop') && !e.target.closest('#settingsBtn')) $('#settingsPop').classList.add('hidden'); });
$('#xfadeSel').addEventListener('change', (e) => { S.xfade = +e.target.value; LS.set('pratmusic.xfade', S.xfade); toast(`crossfade <b>${S.xfade ? S.xfade + 's' : 'off'}</b>`); });
$('#vizSel').addEventListener('change', (e) => { S.viz = +e.target.value; LS.set('pratmusic.viz', S.viz); });
$('#resumeChk').addEventListener('change', (e) => { S.resume = e.target.checked; LS.set('pratmusic.resume', S.resume); });
$('#sleepOpts').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return;
  $$('#sleepOpts button').forEach((x) => x.classList.toggle('on', x === b));
  const m = +b.dataset.min; S.sleepEnd = m ? Date.now() + m * 60000 : 0;
  $('#sleepChip').classList.toggle('hidden', !m); toast(m ? `sleep timer <b>${m} min</b>` : 'sleep timer off'); });
setInterval(() => {
  if (!S.sleepEnd) return;
  const left = S.sleepEnd - Date.now();
  if (left <= 0) { S.sleepEnd = 0; $('#sleepChip').classList.add('hidden');
    const d = deck(); const v0 = d.volume; let k = 0;
    const iv = setInterval(() => { k++; d.volume = v0 * (1 - k / 10); if (k >= 10) { clearInterval(iv); d.pause(); S.playing = false; d.volume = v0; syncPlayerUI(); toast('sleep timer — good night 🌙'); } }, 250);
    return; }
  $('#sleepChip').textContent = `🌙 ${fmt(left / 1000)}`;
}, 1000);

$('#vizBtn').addEventListener('click', () => { S.viz = (S.viz + 1) % 3; LS.set('pratmusic.viz', S.viz); $('#vizSel').value = String(S.viz);
  toast('visualizer: <b>' + ['spectrum bars', 'radial bloom', 'oscilloscope'][S.viz] + '</b>'); openNP(); });

/* now playing overlay */
function openNP() { $('#np').classList.remove('hidden'); sizeViz(); syncPlayerUI(); }
function closeNP() { $('#np').classList.add('hidden'); }
$('#npOpen').addEventListener('click', openNP); $('#npClose').addEventListener('click', closeNP);
$('.np-art').addEventListener('mousemove', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  const dx = (e.clientX - r.left) / r.width - .5, dy = (e.clientY - r.top) / r.height - .5;
  $('.np-cover-tilt').style.transform = `perspective(900px) rotateY(${dx * 14}deg) rotateX(${-dy * 12}deg)`;
});
$('.np-art').addEventListener('mouseleave', () => { $('.np-cover-tilt').style.transform = ''; });

/* search */
const searchEl = $('#search');
searchEl.addEventListener('input', () => { S.query = searchEl.value; $('#clearSearch').classList.toggle('hidden', !S.query);
  if (S.view === 'home' || S.view === 'credits' || S.view === 'uploads') setViewSoftLibrary(); renderView(true); });
function setViewSoftLibrary() { if (S.query && (S.view === 'home')) S.view = 'library', $$('#nav .nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === 'library')); }
$('#clearSearch').addEventListener('click', () => { searchEl.value = ''; S.query = ''; $('#clearSearch').classList.add('hidden'); renderView(); });

/* help modal */
$('#helpBtn').addEventListener('click', () => $('#modal').classList.remove('hidden'));
$('#modalClose').addEventListener('click', () => $('#modal').classList.add('hidden'));
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('#modal').classList.add('hidden'); });

/* keyboard */
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input,select,textarea') || e.metaKey || e.ctrlKey) return;
  const k = e.key;
  if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (k === 'ArrowRight') { const d = deck(); if (d.duration) d.currentTime = Math.min(d.duration, d.currentTime + 10); }
  else if (k === 'ArrowLeft') { deck().currentTime = Math.max(0, deck().currentTime - 10); }
  else if (k === 'ArrowUp') { e.preventDefault(); S.vol = clamp(S.vol + .05, 0, 1); LS.set('pratmusic.vol', S.vol); S.muted = false; syncVol(); }
  else if (k === 'ArrowDown') { e.preventDefault(); S.vol = clamp(S.vol - .05, 0, 1); LS.set('pratmusic.vol', S.vol); syncVol(); }
  else if (k === 'n' || k === 'N') next(false);
  else if (k === 'p' || k === 'P') prev();
  else if (k === 's' || k === 'S') toggleShuffle();
  else if (k === 'r' || k === 'R') cycleRepeat();
  else if (k === 'm' || k === 'M') $('#muteBtn').click();
  else if (k === 'f' || k === 'F') cur() && toggleFav(cur().id);
  else if (k === 'q' || k === 'Q') $('#queueBtn').click();
  else if (k === 'v' || k === 'V') $('#vizBtn').click();
  else if (k === '/') { e.preventDefault(); searchEl.focus(); }
  else if (k === 'Enter') { $('#np').classList.contains('hidden') ? openNP() : closeNP(); }
  else if (k === 'Escape') { closeNP(); $('#modal').classList.add('hidden'); $('#queue').classList.remove('open'); $('#settingsPop').classList.add('hidden'); }
  else if (['1', '2', '3', '4', '5'].includes(k)) setView(['home', 'library', 'favs', 'uploads', 'credits'][+k - 1]);
});

/* ── importing user files ──────────────────────────────────────── */
$('#addMusicBtn').addEventListener('click', () => $('#filePick').click());
const folderPick = document.createElement('input');
folderPick.type = 'file'; folderPick.multiple = true; folderPick.webkitdirectory = true; folderPick.hidden = true;
document.body.appendChild(folderPick);
$('#addFolderBtn').addEventListener('click', () => folderPick.click());
$('#filePick').addEventListener('change', (e) => importFiles(e.target.files));
folderPick.addEventListener('change', (e) => importFiles(e.target.files));
['dragenter', 'dragover'].forEach((ev) => window.addEventListener(ev, (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); $('#dropHint').classList.remove('hidden'); } }));
['dragleave', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => { if (ev === 'drop' || e.target === document.documentElement) { e.preventDefault(); $('#dropHint').classList.add('hidden'); } }));
window.addEventListener('drop', (e) => { e.preventDefault(); $('#dropHint').classList.add('hidden'); if (e.dataTransfer?.files?.length) importFiles(e.dataTransfer.files); });

async function importFiles(files) {
  const audio = [...files].filter((f) => f.type.startsWith('audio') || /\.(mp3|m4a|flac|wav|ogg|opus|aac)$/i.test(f.name));
  if (!audio.length) { toast('no audio files in that drop'); return; }
  toast(`importing <b>${audio.length}</b> file${audio.length > 1 ? 's' : ''}…`);
  let added = 0;
  for (const f of audio) {
    const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const base = f.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
    let artist = 'Unknown artist', title = base;
    if (base.includes(' - ')) { const [a, ...rest] = base.split(' - '); artist = a.trim(); title = rest.join(' - ').trim(); }
    const dur = await new Promise((res) => { const u = URL.createObjectURL(f); const a = new Audio();
      a.onloadedmetadata = () => { res(a.duration || 0); URL.revokeObjectURL(u); }; a.onerror = () => { res(0); URL.revokeObjectURL(u); }; a.src = u; });
    const rec = { id, kind: 'user', title, artist, album: 'Your library', genre: 'Your Music', mood: '', year: '',
      duration: dur, blob: f, accent: null, deep: '#0c1020', cover: null, licenseName: 'your file', source: null, addedAt: Date.now() };
    await DB.put(rec);
    rec.cover = phCover(id + title);
    S.tracks.push(rec); S.byId[id] = rec; S.urls[id] = URL.createObjectURL(f); added++;
  }
  LS.set('pratmusic.pos', S.pos);
  renderView(); renderGenreChips(); updateStats();
  toast(`✓ <b>${added}</b> track${added > 1 ? 's' : ''} stored offline`);
}
async function removeUserTrack(id) {
  const i = S.tracks.findIndex((t) => t.id === id); if (i < 0) return;
  const t = S.tracks[i];
  await DB.del(id);
  if (S.urls[id]) { URL.revokeObjectURL(S.urls[id]); delete S.urls[id]; }
  S.tracks.splice(i, 1); delete S.byId[id];
  S.order = S.order.filter((x) => x !== id); S.qi = clamp(S.qi, 0, Math.max(0, S.order.length - 1));
  S.favs.delete(id); LS.set('pratmusic.favs', [...S.favs]);
  renderView(); updateStats(); toast(`removed <b>${esc(t.title)}</b>`);
}
async function loadUserTracks() {
  try {
    const recs = await DB.all();
    for (const r of recs) { r.kind = 'user'; r.cover = phCover(r.id + r.title); S.tracks.push(r); S.byId[r.id] = r; }
  } catch (e) { console.warn('idb', e); }
}

/* ── media session (OS / lock-screen controls) ─────────────────── */
function mediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title, artist: t.artist, album: t.album,
    artwork: t.cover && !t.cover.startsWith('data:') ? [{ src: new URL(t.cover, location.href).href, sizes: '800x800', type: 'image/jpeg' }] : []
  });
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', () => togglePlay());
  ms.setActionHandler('pause', () => togglePlay());
  ms.setActionHandler('previoustrack', prev);
  ms.setActionHandler('nexttrack', () => next(false));
  ms.setActionHandler('seekto', (d) => { if (d.seekTime != null) deck().currentTime = d.seekTime; });
}

/* ── offline status / install / service worker ─────────────────── */
function updateOfflineBadge() {
  const el = $('#offlineBadge'); const on = navigator.onLine;
  el.classList.toggle('off', !on);
  el.querySelector('span').textContent = on ? 'online · cached for offline' : 'offline mode — all local';
}
addEventListener('online', updateOfflineBadge); addEventListener('offline', updateOfflineBadge);
let installEvt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#installBtn').classList.remove('hidden'); });
$('#installBtn').addEventListener('click', async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#installBtn').classList.add('hidden'); });
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(() => { updateOfflineBadge(); }).catch((e) => console.warn('sw', e));
}
async function updateStats() {
  const mins = Math.round(S.tracks.reduce((a, t) => a + (t.duration || 0), 0) / 60);
  $('#libStats').textContent = `${S.tracks.length} tracks · ${mins} min on device`;
  try { if (navigator.storage?.estimate) { const e = await navigator.storage.estimate();
    $('#libStats').textContent += ` · ${(e.usage / 1e6).toFixed(0)} MB`; } } catch {}
}

/* ── boot ──────────────────────────────────────────────────────── */
(async function boot() {
  setAccent(null); applyVolume(); syncVol();
  const res = await fetch('library.json');
  const lib = await res.json();
  for (const t of lib) { t.kind = 'bundled'; S.tracks.push(t); S.byId[t.id] = t; }
  await loadUserTracks();
  updateStats(); updateOfflineBadge();
  const hash = location.hash.replace('#', '');
  setView(['home', 'library', 'favs', 'uploads', 'credits'].includes(hash) ? hash : 'home');
  renderQueue(); syncPlayerUI();
  document.body.classList.add('paused');
  toast(`🎧 <b>PratMusic</b> ready — ${S.tracks.filter(t=>t.kind==='bundled').length} open-licensed tracks cached for offline play`);
})();
})();
