# 🎧 PratMusic — offline music

> Repo: https://github.com/mithukosuri-star/pratmusic — clone it, then `pip install pillow && python3 tools/build_library.py` to fetch the 70 MB open-licensed catalogue.

A fully **offline-first** music player as an installable web app (PWA). Glassmorphism + aurora
interface that re-colours itself from the artwork of whatever is playing, a live WebAudio
visualizer, crossfade, queue, favorites, sleep timer, OS media-key integration — and a bundled
open-licensed catalogue so it makes sound on first launch with zero setup.

**No accounts. No network needed after first load. Everything stays on your device.**

---

## Run it

```bash
cd pratmusic
python3 server.py 8000        # static server with HTTP Range support (audio seeking)
# → http://localhost:8000
```

Any static server works, but it must support `Range` requests for seeking (this one does).
Open it once while online and the service worker caches the app **and all 21 tracks + covers**;
after that it plays in airplane mode. Hit “Install app” (or your browser’s install button) to
get a standalone window / home-screen icon.

> **Offline build fallback:** if the Internet Archive is unreachable when you run
> `tools/build_library.py`, it writes clearly-flagged *demo placeholders* (generated tones) so the
> app stays fully playable and testable — an amber banner appears in the app until you re-run the
> build with network access and get the licensed masters.

## What's inside

| Piece | File(s) | Notes |
|---|---|---|
| Player engine + UI | `js/app.js` | vanilla JS, two-deck crossfade through a WebAudio graph |
| Offline store for *your* files | `js/db.js` | IndexedDB — imports survive restarts & offline |
| Offline cache | `sw.js` | precaches shell + media; answers `Range` from cache so seeking works offline |
| Manifest / icons | `manifest.webmanifest`, `icons/` | installable PWA, maskable icon |
| Catalogue metadata | `library.json` | 21 CC/PD-licensed tracks, per-track accent colours, vibe tags, licence + source |
| Audio + art | `media/`, `covers/` | original unmodified MP3s (128–320 kbps) + 800×800 covers |
| Server | `server.py` | threaded static server with byte-range support |
| Smoke test | `tools/smoke_test.js` | headless-Chromium checks: playback, offline, imports, BYO panel |

## Features

- **Dynamic theming** — accent gradients, glows and the aurora backdrop are derived per track from its cover palette.
- **Three visualizers** (spectrum bars / radial bloom / oscilloscope) rendered from a live `AnalyserNode`, `V` to cycle.
- **Crossfade** 0/2/4/8 s between two audio decks; gapless-ish preload.
- **Queue drawer** (`Q`), shuffle, repeat off/all/one, favorites (`F`), sleep timer with fade-out.
- **Your music** — drag & drop or pick files/folders (mp3 · m4a · flac · wav · ogg); stored in IndexedDB, playable offline forever, deletable any time.
- **Bring your own files** — first-class panel for your own Lana Del Rey / The Neighbourhood / Dua Lipa / Rihanna / Lady Gaga files: those masters are copyrighted and never bundled, so drop in what you own and it lives offline alongside the open catalogue. Vibe chips deep-link to open-licensed look-alikes.
- **Resume where you left off**, recently-played rail, search (`/`), genre filters, grid/list layouts.
- **OS integration** — Media Session API: lock-screen / headphone / keyboard media keys with artwork.
- **Keyboard-first** — press `?` in the app for the full map.
- Works at phone width; reduced-motion respected.

## The music

21 tracks / ~80 minutes / 16 genres, collected from the Internet Archive's netlabel collections —
every track openly licensed (CC BY-NC-ND, CC BY-SA, CC0…) and kept **byte-for-byte unmodified**,
with attribution and source links in-app (Credits view) and in `CREDITS.md`.
A few covers were generated procedurally where the source item only shipped low-res art.

The 2025 expansion added a **vocal dream-pop / synth-pop / dance-pop** shelf in the vibe of
Lana Del Rey, The Neighbourhood, Dua Lipa, Rihanna and Lady Gaga (Electric Mirrors, Fire To The
Stars, Korine Conception, Lipstick, King Elizabeth, Garmisch, Asaguare) — openly licensed
look-alikes, never the copyrighted originals. Search any of those names to find the vibe matches,
or bring your own files.

## Layout

```
music-app/
├── index.html          shell + player markup
├── css/style.css       glass / aurora design system
├── js/app.js           engine + views
├── js/db.js            IndexedDB (user imports)
├── sw.js               offline cache (range-aware)
├── manifest.webmanifest
├── library.json        catalogue + palettes + licences
├── server.py           range-capable static server
├── media/  covers/  icons/
├── CREDITS.md          per-track attribution
└── README.md
```
