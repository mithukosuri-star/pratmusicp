#!/usr/bin/env node
/* PratMusic smoke test — headless Chromium against a running server.
 *
 * Modes (auto-detected):
 *   1. puppeteer (full) with its downloaded Chrome
 *   2. puppeteer-core + @sparticuz/chromium  (no Chrome downloads needed)
 *   3. puppeteer-core + $CHROME_PATH
 *
 * Usage:  node tools/smoke_test.js [baseURL]     default http://127.0.0.1:8000
 * Covers: boot with 0 console errors, playback, search-by-vibe, bring-your-own
 * panel, file import (IndexedDB), favorites persistence, offline reload + offline playback.
 */
const fs = require('fs');
const path = require('path');

(async () => {
  const base = process.argv[2] || 'http://127.0.0.1:8000';
  let puppeteer, launchOpts = { args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'] };
  try {
    puppeteer = require('puppeteer');
  } catch {
    puppeteer = require('puppeteer-core');
    if (process.env.CHROME_PATH) {
      launchOpts.executablePath = process.env.CHROME_PATH;
    } else {
      const os = require('os');
      const mod = require('@sparticuz/chromium');
      const chromium = mod.default || mod;
      launchOpts.executablePath = await chromium.executablePath();
      launchOpts.args = [...(chromium.args || []), ...launchOpts.args];
      // the serverless build keeps NSS/NSPR in al2023.tar.br and only unpacks them on
      // Amazon Linux — unpack them too so the binary loads on any distro
      const bin = path.join(path.dirname(require.resolve('@sparticuz/chromium')), '..', 'bin');
      if (fs.existsSync(path.join(bin, 'al2023.tar.br'))) {
        await mod.inflate(path.join(bin, 'al2023.tar.br'));
        mod.setupLambdaEnvironment?.(path.join(os.tmpdir(), 'al2023', 'lib'));
      }
    }
  }
  const results = [];
  const ok = (name, pass, info = '') => { results.push({ name, pass, info }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };

  const browser = await puppeteer.launch(launchOpts);
  const page = await browser.newPage();
  await page.setViewport({ width: 1380, height: 900 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  // 1 · boot
  await page.goto(base + '/', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.card .cov', { timeout: 30000 });
  const cardCount = await page.$$eval('.card', (els) => els.length);
  ok('boot: cards render', cardCount >= 20, `${cardCount} cards`);

  // 2 · playback (click first cover)
  await page.click('.card .cov');
  await page.waitForFunction(() => document.querySelector('#player')?.classList.contains('playing'), { timeout: 15000 });
  const t1 = await page.$eval('#tCur', (e) => e.textContent);
  await new Promise((r) => setTimeout(r, 1600));
  const t2 = await page.$eval('#tCur', (e) => e.textContent);
  ok('playback: player.playing + time advances', t2 !== '0:00' && t2 !== t1, `${t1} → ${t2}`);

  // 3 · search by vibe (Lana Del Rey …)
  await page.click('#search', { clickCount: 3 });
  await page.type('#search', 'Dua Lipa');
  await new Promise((r) => setTimeout(r, 400));
  const vibeHits = await page.$$eval('.card .t, .row .t', (els) => els.map((e) => e.textContent.trim()));
  ok('search "Dua Lipa" finds vibe matches', vibeHits.length >= 2 && /Back In Time|Little Love|Glimmer/.test(vibeHits.join(' | ')), vibeHits.slice(0, 4).join(' · '));

  // 4 · bring-your-own panel names the five artists
  await page.click('#clearSearch').catch(() => {});
  await page.evaluate(() => document.querySelector('[data-view="uploads"]').click());
  await page.waitForSelector('.byo', { timeout: 10000 });
  const byoText = await page.$eval('.byo', (e) => e.innerText);
  const five = ['Lana Del Rey', 'The Neighbourhood', 'Dua Lipa', 'Rihanna', 'Lady Gaga'];
  ok('bring-your-own panel names all five artists', five.every((n) => byoText.includes(n)));
  ok('bring-your-own panel has drop area + buttons', await page.$('#byoDrop') !== null && await page.$('[data-byo="files"]') !== null);

  // 5 · import a file into IndexedDB
  const wav = path.join('/tmp', 'prat-smoke-import.wav');
  const frames = 22050; const buf = Buffer.alloc(44 + frames * 2);
  buf.write('RIFF'); buf.writeUInt32LE(36 + frames * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(22050, 24); buf.writeUInt32LE(44100, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data'); buf.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) buf.writeInt16LE(Math.sin(i / 30) * 8000, 44 + i * 2);
  fs.writeFileSync(wav, buf);
  const input = await page.$('#filePick');
  await input.uploadFile(wav);
  await page.waitForFunction(
    () => /stored offline/.test(document.querySelector('#toasts')?.innerText || '') &&
          document.querySelectorAll('#view .rows .row').length > 0,
    { timeout: 20000 });
  const hasImport = await page.$$eval('#view .rows .row .a', (els) => els.some((e) => /Smoke|prat-smoke|Unknown/i.test(e.textContent)) || els.length > 0);
  ok('import: file lands in IndexedDB + list', hasImport);

  // 6 · favorites persist
  await page.evaluate(() => document.querySelector('[data-view="library"]').click());
  await page.waitForFunction(() => document.querySelectorAll('#view .card .fav').length > 0, { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => document.querySelector('#view .card .fav').click());
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('.card', { timeout: 15000 });
  const favCount = await page.evaluate(() => JSON.parse(localStorage.getItem('pratmusic.favs') || '[]').length);
  ok('favorites persist across reload', favCount >= 1, `${favCount} fav`);

  // 7 · offline: SW serves app + media
  await page.setOfflineMode(true);
  await page.goto(base + '/#home', { waitUntil: 'load', timeout: 30000 }).catch(() => {});
  await page.waitForSelector('.card .cov', { timeout: 20000 });
  await page.click('.card .cov');
  await page.waitForFunction(() => document.querySelector('#player')?.classList.contains('playing'), { timeout: 15000 });
  const o1 = await page.$eval('#tCur', (e) => e.textContent);
  await new Promise((r) => setTimeout(r, 1600));
  const o2 = await page.$eval('#tCur', (e) => e.textContent);
  ok('offline: reload + playback from service-worker cache', o2 !== '0:00' && o2 !== o1, `${o1} → ${o2}`);
  await page.setOfflineMode(false);

  // 8 · no console errors
  ok('zero console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('smoke test crashed:', e); process.exit(2); });
