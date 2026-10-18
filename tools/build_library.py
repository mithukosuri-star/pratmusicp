#!/usr/bin/env python3
"""Rebuild PratMusic's bundled catalogue from the Internet Archive (open licences only).
Downloads the CC/PD-licensed MP3s UNMODIFIED + cover art, writes library.json + CREDITS.md.

Usage:  python3 tools/build_library.py [--out DIR] [--skip-existing] [--strict] [--demo-audio]

--strict      fail if any track cannot be downloaded (default: fall back to
              clearly-flagged generated demo placeholders so the app stays testable)
--demo-audio  force generated demo placeholders for every track (no network needed)
"""
import json, os, re, io, sys, math, random, wave, struct, zlib, urllib.request, urllib.parse, concurrent.futures as cf
from PIL import Image, ImageDraw, ImageFilter, ImageOps
UA = {"User-Agent": "Mozilla/5.0 (pratmusic catalogue builder; personal offline player)"}
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = HERE
SKIP = "--skip-existing" in sys.argv
STRICT = "--strict" in sys.argv
FORCE_DEMO = "--demo-audio" in sys.argv
for i, a in enumerate(sys.argv):
    if a == "--out": OUT = sys.argv[i + 1]
MEDIA, COV = f"{OUT}/media", f"{OUT}/covers"
os.makedirs(MEDIA, exist_ok=True); os.makedirs(COV, exist_ok=True)

def get(u, t=240, retry=3):
    last = None
    for i in range(retry):
        try:
            r = urllib.request.Request(u, headers=UA)
            with urllib.request.urlopen(r, timeout=t) as x: return x.read()
        except Exception as e:
            last = e
    raise last
def meta(i): return json.loads(get(f"https://archive.org/metadata/{i}", t=60))
def norm(s): return re.sub(r"[^a-z0-9]", "", str(s).lower())
FMT = {"VBR MP3": 0, "192Kbps MP3": 1, "128Kbps MP3": 2, "MP3": 2, "64Kbps MP3": 4}

# ─────────────────────────────────────────────────────────────────────────────
# The catalogue. Every track is openly licensed (CC/PD) and downloaded UNMODIFIED.
# The "vibe" tags name artists whose *sound* a track shares — their actual masters
# are copyrighted and are NEVER bundled. Use the app's "Bring your own files"
# panel for those.
# ─────────────────────────────────────────────────────────────────────────────
PICKS = [
 ("amb_col_light","Light Part 2","Ambient","drifting / luminous","light-part-2"),
 ("gt390FandorinProjet2","Different But Equivalent","Experimental","hypnotic / CC0","different-but-equivalent"),
 ("DWK119","Streetlight Noir","Lo-Fi Jazz","rainy night city","streetlight-noir"),
 ("DWK301","SoInLoveWithYou","Lo-Fi Hip-Hop","warm tape hiss","so-in-love-with-you"),
 ("SCL203","Cool","Jazz","smoky lounge","pk-jazz-cool"),
 ("v-a-dark-synthwave","Ozone Cloud","Dark Synthwave","neon drive","ozone-cloud"),
 ("v-a-dark-synthwave","Night Lights 2","Dark Synthwave","midnight chrome","night-lights-2"),
 ("BFTG_177","Recycle 2.1","Vaporwave","mall echo / 80s dream","recycle-2-1"),
 ("qd-4244","darling i miss you","Chiptune","pixel heartbreak","darling-i-miss-you"),
 ("hc152_too_bleep_to_blop_by_8_bit_betty","Was that away message for me?","Chiptune","playful bleeps","was-that-away-message"),
 ("chase005","Hellfire","IDM","glitchy intensity","hellfire"),
 ("EVIL009","Dame Chocolate (feat. Fade In)","Electro Funk","dusty groove","dame-chocolate"),
 ("aer006","Es kann nicht ewig Winter sein","Post-Classical","melancholy strings","es-kann-nicht-ewig-winter"),
 # ── vocal dream-pop / dark indie pop lane (Lana Del Rey · The Neighbourhood) ──
 ("BSOG0058","Ghost In Your Headlights","Dream Pop","neon noir · slow-burn hooks","ghost-in-your-headlights"),
 ("FireToTheStars-KeepYouSafe2014lgn030","Keep You Safe","Dream Pop","shoegaze haze · bittersweet","keep-you-safe"),
 ("sar_025.variousArtists-SilentSight","Glow In Transparancy","Shoegaze","reverb cathedral · dusk","glow-in-transparancy-aurora"),
 # ── vocal synth-pop lane (Lady Gaga · Rihanna) ──
 ("Lipstick-LittleLoveEp","Little Love","Synth-Pop","berlin pop · glowing hooks","little-love"),
 ("kingelizabeth-girlsboys2020","Girls & Boys","Synth-Pop","new-wave glitter · bold voice","girls-and-boys"),
 ("BSOG0058","Neon Jesus Wins The World Cup","Electropop","buzzy joy · midnight drive","neon-jesus-wins-the-world-cup"),
 ("BSOG0008","Glimmer","Electropop","swedish pop shimmer","glimmer"),
 # ── vocal dance-pop / disco-pop lane (Dua Lipa) ──
 ("BackInTime","Back In Time","Dance Pop","retro disco · vocal hooks","back-in-time"),
]
REAL = {  # best high-res album art per track (item, filename)
 "light-part-2":("amb_col_light","originalfront.png"),
 "different-but-equivalent":("gt390FandorinProjet2","00front.jpg"),
 "streetlight-noir":("DWK119","Jenova_7_-_Dusted_Jazz_Volume_Two_1_Front_Cover.jpg"),
 "so-in-love-with-you":("DWK301","Mounika_-_Born_To_Be_Beats.jpg"),
 "pk-jazz-cool":("SCL203","cover.jpg"),
 "ozone-cloud":("v-a-dark-synthwave","cover.jpg"),
 "night-lights-2":("v-a-dark-synthwave","cover.jpg"),
 "recycle-2-1":("BFTG_177","cover.png"),
 "hellfire":("chase005","00_-_Chase_005_Cover_Front.jpg"),
 "dame-chocolate":("EVIL009","Cover.jpg"),
 "ghost-in-your-headlights":("BSOG0058","BSOG0058.jpg"),
 "neon-jesus-wins-the-world-cup":("BSOG0058","BSOG0058.jpg"),
 "keep-you-safe":("FireToTheStars-KeepYouSafe2014lgn030","Cover.jpg"),
 "glow-in-transparancy-aurora":("sar_025.variousArtists-SilentSight","front_cover.jpg"),
 "little-love":("Lipstick-LittleLoveEp","elyt01.jpg"),
 "girls-and-boys":("kingelizabeth-girlsboys2020","cover.jpg"),
 "glimmer":("BSOG0008","BSOG0008.jpg"),
 "back-in-time":("BackInTime","BackInTime.jpg"),
}
FIX = {  # curated metadata (also used when the build runs offline)
 "streetlight-noir":dict(title="Streetlight Noir",artist="Jenova 7",album="Dusted Jazz Volume Two",year="2012"),
 "so-in-love-with-you":dict(title="So In Love With You",artist="Mounika",album="Born To Be Beats EP",year="2015"),
 "pk-jazz-cool":dict(title="Cool",artist="Pk Jazz Collective",album="Analog",year="2019"),
 "dame-chocolate":dict(title="Dame Chocolate (feat. Fade In)",artist="Baymont Bross",album="Cleaning The Dusty In My House",year="2007"),
 "ozone-cloud":dict(title="Ozone Cloud",artist="Demetr",album="Dark Synthwave (V/A)",year="2020"),
 "night-lights-2":dict(title="Night Lights 2",artist="MuktoDMI",album="Dark Synthwave (V/A)",year="2020"),
 "recycle-2-1":dict(title="Recycle 2.1",artist="Eir Luna Calypso Mazur",album="Vaporwave Is Alive And Well",year="2022"),
 "darling-i-miss-you":dict(title="darling i miss you",artist="Cocolulu (Mark Redito)",album="8-Bit Love",year=""),
 "was-that-away-message":dict(title="Was that away message for me?",artist="8bit bEtty",album="Too Bleep To Bloop",year=""),
 "hellfire":dict(title="Hellfire",artist="Producer Snafu",album="IDM For Cholos",year="2005"),
 "es-kann-nicht-ewig-winter":dict(title="Es kann nicht ewig Winter sein",artist="Bersarin Quartett",album="Electronica Unplugged 2",year=""),
 "light-part-2":dict(title="Light Part 2",artist="Gregg Plummer",album="Ambient Collective: Light",year="2007"),
 "different-but-equivalent":dict(title="Different But Equivalent",artist="Oldboy Melody",album="[GT390] Fandorin Projet 2",year="2012"),
 "ghost-in-your-headlights":dict(title="Ghost In Your Headlights",artist="Electric Mirrors",album="UFO Stories",year="2016"),
 "neon-jesus-wins-the-world-cup":dict(title="Neon Jesus Wins The World Cup",artist="Electric Mirrors",album="UFO Stories",year="2016"),
 "keep-you-safe":dict(title="Keep You Safe",artist="Fire To The Stars",album="Keep You Safe",year="2014"),
 "glow-in-transparancy-aurora":dict(title="Glow In Transparancy Aurora",artist="Korine Conception",album="Silent Sight",year="2010"),
 "little-love":dict(title="Little Love",artist="Lipstick",album="Little Love EP",year="2004"),
 "girls-and-boys":dict(title="Girls & Boys",artist="King Elizabeth",album="Girls & Boys",year="2020"),
 "glimmer":dict(title="Glimmer",artist="Garmisch",album="Garmisch",year="2010"),
 "back-in-time":dict(title="Back In Time",artist="Asaguare",album="Back In Time",year="2011")}
LIC = {"light-part-2":"CC BY-ND 3.0","different-but-equivalent":"CC0 1.0 (Public Domain)","streetlight-noir":"CC BY-NC-ND 3.0",
 "so-in-love-with-you":"CC BY-NC-ND 3.0","pk-jazz-cool":"CC BY-NC-SA 4.0","ozone-cloud":"CC BY-NC-ND 4.0",
 "night-lights-2":"CC BY-NC-ND 4.0","recycle-2-1":"CC BY-SA 4.0","darling-i-miss-you":"CC BY-NC-ND 3.0",
 "was-that-away-message":"CC BY-NC-ND 2.5","hellfire":"CC BY-NC-SA 2.0 FR","dame-chocolate":"CC BY-NC-ND 2.5 ES",
 "es-kann-nicht-ewig-winter":"CC BY-NC-SA 3.0",
 "ghost-in-your-headlights":"CC BY-NC-SA 3.0","neon-jesus-wins-the-world-cup":"CC BY-NC-SA 3.0",
 "keep-you-safe":"CC BY-NC-ND 4.0","glow-in-transparancy-aurora":"CC BY-NC-SA 3.0 US",
 "little-love":"CC BY-NC-ND 3.0","girls-and-boys":"CC BY-NC-ND 4.0","glimmer":"CC BY-NC-ND 3.0",
 "back-in-time":"CC BY-NC-SA 3.0"}
ACCENT = {"light-part-2":"#8fd06a","different-but-equivalent":"#f0763f","streetlight-noir":"#d8b06a",
 "so-in-love-with-you":"#f2607a","pk-jazz-cool":"#e8c46a","ozone-cloud":"#b06ae8","night-lights-2":"#7ad0e8",
 "recycle-2-1":"#2f6bff","darling-i-miss-you":"#ff4fd8","was-that-away-message":"#8ef0c0",
 "hellfire":"#8fe8b8","dame-chocolate":"#4fd8c0","es-kann-nicht-ewig-winter":"#a9c4f2",
 "ghost-in-your-headlights":"#7a8cff","keep-you-safe":"#c98aff","glow-in-transparancy-aurora":"#8fd8ff",
 "little-love":"#ff5c7a","girls-and-boys":"#b06ae8","neon-jesus-wins-the-world-cup":"#ff4fd8",
 "glimmer":"#6ad8ff","back-in-time":"#ffb020"}
# which big-name pop artists a track shares a *vibe* with (their masters are never bundled)
VIBE = {"ghost-in-your-headlights":["Lana Del Rey","The Neighbourhood"],
 "keep-you-safe":["Lana Del Rey","The Neighbourhood"],
 "glow-in-transparancy-aurora":["Lana Del Rey"],
 "little-love":["Lady Gaga","Dua Lipa"],
 "girls-and-boys":["Rihanna","Lady Gaga"],
 "neon-jesus-wins-the-world-cup":["Lady Gaga","The Neighbourhood"],
 "glimmer":["Rihanna","Dua Lipa"],
 "back-in-time":["Dua Lipa","Rihanna"]}
ORDER = ["streetlight-noir","so-in-love-with-you","pk-jazz-cool","dame-chocolate","ozone-cloud","night-lights-2",
 "recycle-2-1","darling-i-miss-you","was-that-away-message","hellfire","es-kann-nicht-ewig-winter",
 "light-part-2","different-but-equivalent",
 "ghost-in-your-headlights","keep-you-safe","glow-in-transparancy-aurora",
 "little-love","girls-and-boys","neon-jesus-wins-the-world-cup","glimmer","back-in-time"]

def pick_file(m, want):
    best = None
    for f in m["files"]:
        n = f.get("name", "")
        if not n.lower().endswith(".mp3") or "spectrogram" in n: continue
        t = norm(f.get("title", "")) or norm(n)
        if norm(want) not in t and norm(want)[:18] not in t: continue
        fmt = f.get("format", "MP3"); rank = FMT.get(fmt, 5); size = int(f.get("size", 0))
        try:
            L = str(f.get("length", "0")); ln = float(L) if ":" not in L else sum(float(x)*60**k for k, x in enumerate(reversed(L.split(":"))))
        except Exception: ln = 0
        if best is None or (rank, size) < best[0]: best = ((rank, size), f, ln)
    return best

# ── generative covers for items that ship only low-res art ──
S = 800
def gen_sprite(tid, seed, pal, bg):
    rnd = random.Random(seed); N = 10; c = (S//2)//N
    grid = [[pal[int(rnd.random()*len(pal))] if rnd.random() > .45 else None for _ in range(N)] for _ in range(2*N)]
    im = Image.new("RGB", (S, S), bg); d = ImageDraw.Draw(im)
    for y in range(2*N):
        for x in range(2*N):
            col = grid[y][x] if x < N else grid[y][2*N-1-x]
            if col: d.rectangle([x*c, y*c, (x+1)*c-1, (y+1)*c-1], fill=col)
    im = im.filter(ImageFilter.GaussianBlur(.5)); d = ImageDraw.Draw(im)
    ov = Image.new("RGBA", (S, S), (0, 0, 0, 0)); od = ImageDraw.Draw(ov)
    for y in range(0, S, 4): od.line([0, y, S, y], fill=(0, 0, 0, 70), width=2)
    od.rectangle([0, 0, S-1, S-1], outline=pal[0], width=14)
    return Image.alpha_composite(im.convert("RGBA"), ov).convert("RGB")
def gen_wave(tid, seed, pal, bg):
    rnd = random.Random(seed); im = Image.new("RGB", (S, S), bg); d = ImageDraw.Draw(im)
    for i, (col, amp, off, w) in enumerate(zip(pal, [70, 50, 34, 22], [.30, .46, .62, .78], [3, 3, 2, 2])):
        pts = [(x, S*off + math.sin(x/140 + i*1.1)*amp + math.sin(x/47 + i)*amp*.22) for x in range(0, S+8, 8)]
        d.line(pts, fill=col, width=w, joint="curve")
    d.ellipse([S*.62, S*.10, S*.90, S*.38], outline=pal[0], width=3)
    return im
GEN = {"darling-i-miss-you": ("sprite", ["#ff4fd8", "#4df0ff", "#ffe14d", "#7bff6b"], (20, 12, 44)),
       "was-that-away-message": ("sprite", ["#5cf2c3", "#f2e15c", "#f2705c", "#8fb8ff"], (10, 28, 34)),
       "es-kann-nicht-ewig-winter": ("wave", ["#dfe8ff", "#a9bfe8", "#7d93c4", "#f2ede4"], (16, 20, 32))}
def gen_fallback(tid):
    """procedural cover from the track's accent colour — used when real art can't be fetched"""
    a = ACCENT.get(tid, "#a05cff")
    def mix(h, f):
        r, g, b = (int(h[i:i+2], 16) for i in (1, 3, 5))
        return "#%02x%02x%02x" % tuple(min(255, int(v + (255 - v) * f)) for v in (r, g, b))
    pal = [a, mix(a, .35), mix(a, .6), "#f0eaff"]
    bg = tuple(max(0, int(a[i:i+2], 16) // 5) for i in (1, 3, 5))
    return ("wave", pal, bg)

def palette(p):
    im = Image.open(p).convert("RGB").resize((64, 64))
    cols = sorted(im.quantize(colors=24, method=Image.FASTOCTREE).convert("RGB").getcolors(64*64) or [], reverse=True)
    def score(c):
        r, g, b = c; mx, mn = max(r, g, b), min(r, g, b)
        return (mx-mn)/255*(.35+.65*mx/255)
    vivid = max(cols[:14], key=lambda x: score(x[1]))[1] if cols else (160, 92, 255)
    deep = min(cols[:14], key=lambda x: sum(x[1]))[1] if cols else (10, 10, 20)
    return "#%02x%02x%02x" % vivid, "#%02x%02x%02x" % deep

def save_cover(im, tid):
    im = ImageOps.fit(im.convert("RGB"), (S, S), Image.LANCZOS, centering=(.5, .45))
    im.save(f"{COV}/{tid}.jpg", quality=88, optimize=True)

def build_cover(tid, online):
    cpath = f"{COV}/{tid}.jpg"
    if SKIP and os.path.exists(cpath): return
    made = False
    if online and tid in REAL:
        try:
            i2, nm = REAL[tid]
            raw = get(f"https://archive.org/download/{i2}/{urllib.parse.quote(nm)}")
            im = Image.open(io.BytesIO(raw))
            if min(im.size) >= 300: save_cover(im, tid); made = True
        except Exception as e:
            print(f"  cover fallback {tid}: {e}")
    if made: return
    if os.path.exists(cpath): return  # never clobber existing art with a generated fallback
    if tid in GEN:
        kind, pal, bg = GEN[tid]
    else:
        kind, pal, bg = gen_fallback(tid)
    seed = zlib.crc32(tid.encode()) % 100000  # deterministic across runs
    im = gen_sprite(tid, seed, pal, bg) if kind == "sprite" else gen_wave(tid, seed, pal, bg)
    if tid == "es-kann-nicht-ewig-winter": im = Image.blend(im, Image.new("RGB", (S, S), (230, 238, 250)), .28)
    save_cover(im, tid)

# ── generated demo audio (offline fallback) ──────────────────────────────────
# Clearly flagged with "placeholder": true in library.json — the app shows a banner.
# These are ORIGINAL generated tones (not the licensed masters) so the player,
# visualizer, offline cache and smoke tests stay fully exercisable without network.
SR = 22050
DEMO_STYLE = {"streetlight-noir":"dream","so-in-love-with-you":"dream","pk-jazz-cool":"dream",
 "dame-chocolate":"disco","ozone-cloud":"synth","night-lights-2":"synth","recycle-2-1":"dream",
 "darling-i-miss-you":"synth","was-that-away-message":"synth","hellfire":"synth",
 "es-kann-nicht-ewig-winter":"shoegaze","light-part-2":"shoegaze","different-but-equivalent":"dream",
 "ghost-in-your-headlights":"dream","keep-you-safe":"shoegaze","glow-in-transparancy-aurora":"shoegaze",
 "little-love":"synth","girls-and-boys":"pop","neon-jesus-wins-the-world-cup":"synth",
 "glimmer":"pop","back-in-time":"disco"}
STYLES = {  # bpm, chord scale-semitones, brightness
 "dream":   (76,  [0, 3, 7, 10, 14], .28),
 "shoegaze":(68,  [0, 5, 7, 12, 15], .22),
 "synth":   (112, [0, 3, 7, 10, 12], .5),
 "pop":     (118, [0, 4, 7, 11, 14], .62),
 "disco":   (116, [0, 3, 7, 10, 14], .55)}

def midi(n): return 440.0 * 2 ** ((n - 69) / 12)

def synth_demo(path, tid):
    rnd = random.Random(hash(tid) % 99999)
    style = DEMO_STYLE.get(tid, "dream"); bpm, chord, bright = STYLES[style]
    beat = 60.0 / bpm; bars = 8; total = int(SR * beat * 4 * bars)
    buf = [0.0] * total
    roots = [57, 53, 60, 55]  # A F C G-ish progression, per-bar root (midi)

    def add(t0, dur, freq, amp, kind="saw", detune=0.0, pan=0):
        i0 = int(t0 * SR); n = int(dur * SR)
        if i0 >= total: return
        n = min(n, total - i0)
        w = 2 * math.pi * freq
        for i in range(n):
            t = i / SR
            ph = w * t * (1 + detune)
            if kind == "saw":
                v = ((ph / (2 * math.pi)) % 1.0) * 2 - 1
            elif kind == "sq":
                v = 1.0 if (ph / (2 * math.pi)) % 1.0 < .45 else -1.0
            elif kind == "tri":
                x = (ph / (2 * math.pi)) % 1.0
                v = 4 * abs(x - .5) - 1
            else:
                v = math.sin(ph)
            e = min(1.0, t / .01) * math.exp(-t * (2.2 / dur if dur else 1))
            if kind in ("saw", "sq"): e *= .8 ** (t * 1.2)
            buf[i0 + i] += v * amp * e

    def add_pad(t0, dur, root, amp):
        for iv in chord:
            f = midi(root + iv)
            add(t0, dur, f, amp / len(chord), "saw", detune=.004)
            add(t0, dur, f, amp / len(chord), "tri", detune=-.004)

    def add_drums(t0):
        # kick
        for b in (0, 2) if style in ("dream", "shoegaze") else (0, 1, 2, 3):
            t = t0 + b * beat
            i0 = int(t * SR); n = int(.16 * SR)
            for i in range(min(n, total - i0)):
                x = i / SR
                buf[i0 + i] += math.sin(2 * math.pi * (75 - 220 * x) * x) * math.exp(-x * 26) * .8
        # snare / clap
        for b in ((1, 3) if style != "shoegaze" else (3,)):
            t = t0 + b * beat
            i0 = int(t * SR); n = int(.14 * SR)
            for i in range(min(n, total - i0)):
                x = i / SR
                buf[i0 + i] += (rnd.random() * 2 - 1) * math.exp(-x * 34) * .34
        # hats
        step = beat / 2 if style in ("dream", "shoegaze") else beat / 4
        t = t0
        while t < t0 + 4 * beat - .01:
            i0 = int(t * SR); n = int(.05 * SR)
            amp = .16 if style in ("disco", "pop", "synth") else .09
            for i in range(min(n, total - i0)):
                x = i / SR
                buf[i0 + i] += (rnd.random() * 2 - 1) * math.exp(-x * 90) * amp
            t += step

    def add_bass(t0, root, amp):
        pat = [0, .5, 1.5, 2, 3, 3.5] if style in ("disco", "pop", "synth") else [0, 2]
        for off in pat:
            oct_ = 12 if (style == "disco" and off % 1 == .5) else 0
            add(t0 + off * beat, beat * .42, midi(root - 24 + oct_), amp, "sq" if style != "dream" else "sine")

    def add_arp(t0, root, amp):
        steps = 8 if style in ("synth", "pop", "disco") else 4
        for k in range(steps):
            f = midi(root + chord[k % len(chord)] + 12)
            add(t0 + k * beat / 2, beat * .48, f, amp, "tri", detune=.002 * (k % 3 - 1))

    for bar in range(bars):
        t0 = bar * 4 * beat
        root = roots[bar % 4]
        pad_amp = .16 if style in ("dream", "shoegaze") else .1
        add_pad(t0, 4 * beat * 1.15, root, pad_amp)
        add_bass(t0, root, .22)
        if style in ("synth", "pop", "disco"):
            add_arp(t0, root, .12)
        else:
            add_arp(t0, root, .07)
        add_drums(t0)

    # gentle lowpass + master fades
    out = []
    lp = 0.0
    k = bright
    peak = max(1e-6, max(abs(x) for x in buf))
    g = .72 / peak
    fade = int(SR * 1.2)
    for i, x in enumerate(buf):
        lp += k * (x * g - lp)
        v = lp
        if i < fade: v *= i / fade
        if i > total - fade: v *= (total - i) / fade
        out.append(v)
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, v)) * 32000)) for v in out))
    return len(out) / SR

def lic_name(url):
    u = (url or "").lower()
    if "publicdomain/zero" in u: return "CC0 1.0 (Public Domain)"
    m = re.search(r"licenses/(by(?:-nc)?(?:-nd)?(?:-sa)?)/([0-9.]+)(?:/([a-z]+))?", u)
    if not m: return url or ""
    out = f"CC {m.group(1).upper()} {m.group(2)}"
    if m.group(3): out += " " + m.group(3).upper()
    return out

def work(p):
    ident, want, genre, mood, sl = p
    online = not FORCE_DEMO
    f = ln = None
    md = {}
    dst = f"{MEDIA}/{sl}.mp3"
    if online:
        try:
            m = meta(ident); md = m["metadata"]
            got = pick_file(m, want)
            if not got: raise RuntimeError(f"no mp3 matching {want!r} in {ident}")
            _, f, ln = got
            if not (SKIP and os.path.exists(dst)):
                open(dst, "wb").write(get(f"https://archive.org/download/{ident}/{urllib.parse.quote(f['name'])}"))
        except Exception as e:
            if STRICT: raise
            print(f"  ⚠ {sl}: {e}  → demo placeholder")
            online = False
    if online:
        ext, placeholder = ".mp3", False
    else:
        dst = f"{MEDIA}/{sl}.wav"
        if not (SKIP and os.path.exists(dst)):
            ln = synth_demo(dst, sl)
        else:
            with wave.open(dst) as w: ln = w.getnframes() / w.getframerate()
        ext, placeholder = ".wav", True
    build_cover(sl, online)
    lic = md.get("licenseurl") or ""
    if isinstance(lic, list): lic = lic[0]
    artist = (f or {}).get("artist") or md.get("creator") or ident
    if isinstance(artist, list): artist = artist[0]
    artist = re.sub(r"^\[[^\]]*\]\s*", "", str(artist)).strip()
    title = re.sub(r"^\d+[\. )-]+", "", str((f or {}).get("title") or want).strip())
    _, deep = palette(f"{COV}/{sl}.jpg")
    rec = {"id": sl, "title": title, "artist": artist, "album": str(md.get("title") or ident), "genre": genre,
            "mood": mood, "duration": round(ln or 0, 1), "file": f"media/{sl}{ext}", "bytes": os.path.getsize(dst),
            "cover": f"covers/{sl}.jpg", "year": str(md.get("date", ""))[:4], "license": str(lic),
            "licenseName": lic_name(str(lic)) or LIC[sl], "source": f"https://archive.org/details/{ident}",
            "sourceId": ident, "accent": ACCENT[sl], "deep": deep, "vibe": VIBE.get(sl, [])}
    if placeholder: rec["placeholder"] = True
    return rec

# ── CREDITS.md ───────────────────────────────────────────────────────────────
LIC_URL = {
 "CC BY-ND 3.0": "http://creativecommons.org/licenses/by-nd/3.0/",
 "CC0 1.0 (Public Domain)": "http://creativecommons.org/publicdomain/zero/1.0/",
 "CC BY-NC-ND 3.0": "http://creativecommons.org/licenses/by-nc-nd/3.0/",
 "CC BY-NC-SA 4.0": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
 "CC BY-NC-ND 4.0": "https://creativecommons.org/licenses/by-nc-nd/4.0/",
 "CC BY-SA 4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
 "CC BY-NC-ND 2.5": "http://creativecommons.org/licenses/by-nc-nd/2.5/",
 "CC BY-NC-SA 2.0 FR": "http://creativecommons.org/licenses/by-nc-sa/2.0/fr/",
 "CC BY-NC-ND 2.5 ES": "http://creativecommons.org/licenses/by-nc-nd/2.5/es/",
 "CC BY-NC-SA 3.0": "http://creativecommons.org/licenses/by-nc-sa/3.0/",
 "CC BY-NC-SA 3.0 US": "http://creativecommons.org/licenses/by-nc-sa/3.0/us/"}

def write_credits(lib):
    rows = []
    for t in lib:
        name = t["licenseName"]
        url = LIC_URL.get(name) or t.get("license") or "#"
        rows.append(f"| {t['n']} | {t['title']} | {t['artist']} | {t['album']} | {t.get('year') or '—'} | [{name}]({url}) | [{t['sourceId']}]({t['source']}) |")
    txt = f"""# Music credits & licences

All bundled audio is streamed **unmodified** from the Internet Archive and is stored on your device by PratMusic.
Each work keeps its original Creative Commons licence — attribution below. Please support the artists.

| # | Track | Artist | Album | Year | Licence | Source |
|---|-------|--------|-------|------|---------|--------|
{chr(10).join(rows)}

Album artwork belongs to the respective releases; a few covers (marked by the items shipping only low-res art) were generated procedurally by PratMusic.

## Vibe matches — not their songs

Tracks tagged with vibes like *Lana Del Rey*, *The Neighbourhood*, *Dua Lipa*, *Rihanna* or *Lady Gaga* are **openly licensed look-alikes, never the original recordings**. Those artists' masters are copyrighted and are never bundled. Own their music? Drop your files into **Your music → Bring your own files** — they stay in this browser and play offline.

## Your files

Imported files never leave your device — they live in IndexedDB inside this browser profile.
"""
    open(f"{OUT}/CREDITS.md", "w").write(txt)

# ── main ─────────────────────────────────────────────────────────────────────
recs = {}
with cf.ThreadPoolExecutor(3) as ex:
    for r in ex.map(work, PICKS):
        if r:
            recs[r["id"]] = r
            tag = " [demo placeholder]" if r.get("placeholder") else ""
            print(f"  ok {r['title'][:36]:38} {r['artist'][:22]:24} {round(r['bytes']/1e6,1)}MB{tag}")
lib = []
for i, tid in enumerate(ORDER):
    t = recs[tid]; t.update(FIX.get(tid, {})); t["n"] = i + 1; lib.append(t)
json.dump(lib, open(f"{OUT}/library.json", "w"), indent=1)
write_credits(lib)
n_demo = sum(1 for t in lib if t.get("placeholder"))
print(f"library.json: {len(lib)} tracks, {sum(t['bytes'] for t in lib)/1e6:.1f} MB · CREDITS.md written")
if n_demo:
    print(f"\n⚠ {n_demo} track(s) are GENERATED DEMO PLACEHOLDERS (no Internet Archive access).\n"
          f"  The app will show a banner. Re-run  python3 tools/build_library.py  with network\n"
          f"  access to replace them with the licensed masters (byte-identical, unmodified).")
