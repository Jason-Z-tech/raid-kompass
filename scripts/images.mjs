// Wandelt PNG-Bilder in verkleinerte WebP-Dateien um. Nutzt das vorhandene Chrome/Edge,
// es muss kein Bildprogramm und kein Paket installiert werden.

import { readFile, writeFile, stat, mkdir, rename, access } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser } from './browser.mjs';

// Läuft im Browser: PNG (Base64) -> Bitmap -> verkleinern -> WebP (Base64).
const CONVERT_IN_BROWSER = `async (pngBase64, maxSize, quality) => {
  const blob = await (await fetch('data:image/png;base64,' + pngBase64)).blob();
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxSize / bitmap.width, maxSize / bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  const webp = await canvas.convertToBlob({ type: 'image/webp', quality });
  if (webp.type !== 'image/webp') throw new Error('Dieser Browser kann kein WebP erzeugen.');
  const bytes = new Uint8Array(await webp.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}`;

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

// Aktuell = Zielbild vorhanden und neuer als das Original.
async function isUpToDate(job) {
  if (!await exists(job.dest)) return false;
  const [s, d] = await Promise.all([stat(job.src), stat(job.dest)]);
  return d.mtimeMs >= s.mtimeMs;
}

// jobs: [{ src, dest }] – nur neue oder geänderte Bilder werden umgewandelt.
export async function convertToWebp(jobs, { maxSize = 256, quality = 0.8, onProgress } = {}) {
  const todo = [];
  for (const job of jobs) if (!await isUpToDate(job)) todo.push(job);
  if (!todo.length) return 0;

  const page = await launchBrowser({ width: 800, height: 600 });
  try {
    for (const [i, job] of todo.entries()) {
      const png = (await readFile(job.src)).toString('base64');
      const webp = await page.eval(`(${CONVERT_IN_BROWSER})(${JSON.stringify(png)}, ${maxSize}, ${quality})`);
      await mkdir(path.dirname(job.dest), { recursive: true });
      // Erst vollständig schreiben, dann umbenennen: Ein Abbruch hinterlässt keine halbe Datei.
      const tmp = `${job.dest}.tmp`;
      await writeFile(tmp, Buffer.from(webp, 'base64'));
      await rename(tmp, job.dest);
      onProgress?.(i + 1, todo.length);
    }
  } finally {
    await page.close();
  }
  return todo.length;
}
