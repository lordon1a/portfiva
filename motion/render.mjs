// Deterministic frame renderer: seeks scene.html's render(t) per frame, then encodes with ffmpeg.
// Usage: node render.mjs frames [fps]      -> out/frames/*.png + out/demo.mp4 + out/demo.gif
//        node render.mjs stills 1 5.5 10    -> out/still_<t>.png
//        node render.mjs cover              -> ../assets/cover.png (1200x627)
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, 'out');
const chrome = [
  process.env.CHROME,
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(p => p && existsSync(p));

const [mode = 'frames', ...args] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--hide-scrollbars'] });
const page = await browser.newPage();

async function open(file, w, h, scale = 1) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: scale });
  await page.goto(pathToFileURL(resolve(here, file)).href + '?static', { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
}

if (mode === 'stills') {
  await open('scene.html', 1280, 720);
  for (const t of args.map(Number)) {
    await page.evaluate(t => render(t), t);
    await page.screenshot({ path: `${out}/still_${t}.png` });
  }
} else if (mode === 'cover') {
  await open('cover.html', 1200, 627, 2);
  await page.screenshot({ path: resolve(here, '../assets/cover.png') });
} else {
  const fps = Number(args[0] || 30);
  await open('scene.html', 1280, 720, 1.5);
  const dur = await page.evaluate(() => window.DUR);
  const dir = `${out}/frames`;
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const n = Math.round(dur * fps);
  for (let i = 0; i < n; i++) {
    await page.evaluate(t => render(t), i / fps);
    await page.screenshot({ path: `${dir}/${String(i).padStart(4, '0')}.png` });
  }
  const ff = (...a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a], { stdio: 'inherit' });
  ff('-framerate', String(fps), '-i', `${dir}/%04d.png`, '-vf', 'scale=1920:1080:flags=lanczos',
     '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
     resolve(here, '../assets/demo.mp4'));
  ff('-framerate', String(fps), '-i', `${dir}/%04d.png`, '-vf',
     'fps=20,scale=880:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle',
     resolve(here, '../assets/demo.gif'));
}
await browser.close();
