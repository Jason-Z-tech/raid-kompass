// Steuert ein unsichtbares Chrome (oder Edge) über das DevTools-Protokoll. Nur Node-Bordmittel.
// Genutzt von den Klick-Tests (echte Mausereignisse) und vom Daten-Skript (Bilder nach WebP umwandeln).

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/opt/pw-browsers/chromium',
].filter(Boolean);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDebugger(port) {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const page = (await res.json()).find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* Chrome startet noch */ }
    await sleep(200);
  }
  throw new Error('Chrome hat den Debug-Port nicht geöffnet.');
}

export async function launchBrowser({ width = 1280, height = 900, mobile = false, timezone = null } = {}) {
  if (typeof WebSocket === 'undefined') {
    throw new Error(`Node.js ${process.versions.node} ist zu alt – nötig ist Version 22 oder neuer (eingebautes WebSocket).`);
  }
  const chrome = CHROME_PATHS.find((p) => existsSync(p));
  if (!chrome) throw new Error('Kein Chrome oder Edge gefunden. Pfad per CHROME_PATH angeben.');
  const profile = await mkdtemp(path.join(os.tmpdir(), 'raid-chrome-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
    // Als Administrator (root, z. B. in einem Linux-Container) startet Chrome nur ohne Sandbox.
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });

  let ws;
  try {
    ws = new WebSocket(await waitForDebugger(port));
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  } catch (err) {
    // Startet Chrome nicht richtig, kein verwaistes Chrome und kein Profil-Ordner zurücklassen.
    proc.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  const errors = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    } else if (msg.method) {
      if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
      // Browser-Meldungen wie fehlende Dateien (404) oder durch die CSP blockierte Inhalte.
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(`${msg.params.entry.text} ${msg.params.entry.url ?? ''}`.trim());
      for (const l of listeners) l(msg);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  // Eigene Zeitzone (z. B. "Pacific/Auckland"), damit Datumsfehler durch Zeitzonen-Umrechnung auffallen.
  if (timezone) await send('Emulation.setTimezoneOverride', { timezoneId: timezone });

  // Wartet auf das Laden der Seite, höchstens timeoutMs – sonst Fehler statt ewigem Hängen.
  const waitForLoad = (timeoutMs = 10000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      listeners.splice(listeners.indexOf(l), 1);
      reject(new Error('Seite wurde nicht innerhalb von 10 s geladen.'));
    }, timeoutMs);
    const l = (msg) => {
      if (msg.method !== 'Page.loadEventFired') return;
      clearTimeout(timer);
      listeners.splice(listeners.indexOf(l), 1);
      resolve();
    };
    listeners.push(l);
  });

  let fixedDateScript = null;

  const page = {
    errors,
    // Stellt Tag und Uhrzeit der Seite fest ein ("2026-10-24", "23:30", in der Zeitzone der Seite) –
    // gilt ab dem nächsten Laden. Ohne Tag läuft wieder die echte Uhr.
    async setToday(isoDay = null, time = '12:00') {
      if (fixedDateScript) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: fixedDateScript });
      fixedDateScript = null;
      if (!isoDay) return;
      const [year, month, day] = isoDay.split('-').map(Number);
      const [hour, minute] = time.split(':').map(Number);
      const source = `(() => {
        const RealDate = Date;
        const fixed = new RealDate(${year}, ${month - 1}, ${day}, ${hour}, ${minute}).getTime();
        window.Date = class extends RealDate {
          constructor(...args) { super(...(args.length ? args : [fixed])); }
          static now() { return fixed; }
        };
      })()`;
      fixedDateScript = (await send('Page.addScriptToEvaluateOnNewDocument', { source })).identifier;
    },
    // Lädt immer frisch – auch wenn sich nur der #-Teil der Adresse ändert.
    async goto(url) {
      const blank = waitForLoad();
      await send('Page.navigate', { url: 'about:blank' });
      await blank;
      const loaded = waitForLoad();
      await send('Page.navigate', { url });
      await loaded;
      await sleep(150);
    },
    async reload() {
      const loaded = waitForLoad();
      await send('Page.reload', {});
      await loaded;
      await sleep(150);
    },
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    // Klickt mit der Maus mittig auf das sichtbare Element (scrollt es vorher ins Bild).
    async click(selector) {
      const box = await page.eval(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
      })()`);
      if (!box) throw new Error(`Element nicht gefunden: ${selector}`);
      if (box.w === 0 || box.h === 0) throw new Error(`Element unsichtbar: ${selector}`);
      // Prüfen, dass an dieser Stelle wirklich das Element (oder ein Kind davon) getroffen wird.
      const hit = await page.eval(`(() => {
        const target = document.querySelector(${JSON.stringify(selector)});
        const top = document.elementFromPoint(${box.x}, ${box.y});
        return !!top && (target === top || target.contains(top) || top.contains(target) || (top.control === target) || (target.labels && [...target.labels].some((l) => l.contains(top))));
      })()`);
      if (!hit) throw new Error(`Element ist verdeckt: ${selector}`);
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
      }
      await sleep(80);
    },
    async type(selector, text) {
      await page.click(selector);
      await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.select(); })()`);
      await send('Input.insertText', { text });
      await sleep(80);
    },
    async key(key, code = key) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
      await sleep(60);
    },
    async screenshot(file) {
      const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const { writeFile } = await import('node:fs/promises');
      await writeFile(file, Buffer.from(data, 'base64'));
    },
    async close() {
      ws.close();
      proc.kill();
      await sleep(300);
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    },
  };
  return page;
}
