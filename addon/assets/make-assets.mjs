// Renders the Dhuaan for Alexa+ store and Devpost images from SVG.
// Usage: npm install && node make-assets.mjs
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = (f) => path.join(here, f);

// Level palette, same as dhoop/frontend/src/lib/i18n.tsx (LEVEL_COLOR).
const LEVEL = { none: '#22C55E', light: '#A3A3A3', moderate: '#8B5CF6', heavy: '#6D28D9' };

const BG = '#0b0e13';
const CARD = '#161b24';
const INK = '#f2f4f7';
const MUTED = '#9aa3ad';
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";

// 36 hourly cells starting 9 PM: smoke arrives ~3:30 AM, peaks ~6:30 AM, clears ~10:30 AM.
const HOURS = Array.from({ length: 36 }, (_, i) => {
  if (i < 6) return 'none';          // 9 PM – 3 AM
  if (i < 8) return 'light';         // 3 – 5 AM
  if (i < 9) return 'moderate';      // 5 – 6 AM
  if (i < 11) return 'heavy';        // 6 – 8 AM
  if (i < 12) return 'moderate';     // 8 – 9 AM
  if (i < 14) return 'light';        // 9 – 11 AM
  return 'none';
});

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// Forecast card mock, 520 x 300 in its own coordinates.
function card() {
  const cellW = 456 / 36;
  const cells = HOURS.map((lvl, i) =>
    `<rect x="${32 + i * cellW}" y="196" width="${cellW - 1.5}" height="34" rx="3" fill="${LEVEL[lvl]}"/>`
  ).join('');
  const ticks = [['9 PM', 0], ['3 AM', 6], ['9 AM', 12], ['3 PM', 18], ['9 PM', 24], ['3 AM', 30]]
    .map(([t, i]) => `<text x="${32 + i * cellW}" y="252" font-size="13" fill="${MUTED}">${t}</text>`).join('');
  return `
  <g>
    <rect x="0" y="0" width="520" height="300" rx="22" fill="${CARD}" stroke="#262d39" stroke-width="2"/>
    <text x="32" y="56" font-size="15" letter-spacing="1.5" fill="${MUTED}" font-weight="600">SMOKE FORECAST · TONIGHT</text>
    <text x="32" y="96" font-size="30" font-weight="700" fill="${INK}">Rohini, Delhi</text>
    <rect x="352" y="68" width="136" height="38" rx="19" fill="${LEVEL.moderate}"/>
    <text x="420" y="93" font-size="16" font-weight="700" fill="#ffffff" text-anchor="middle" letter-spacing="1">MODERATE</text>
    <text x="32" y="150" font-size="18" fill="${INK}">${esc('Arrives 3:30 AM · Peaks 6:30 AM · Clears 10:30 AM')}</text>
    <text x="32" y="182" font-size="13" fill="${MUTED}">Next 36 hours</text>
    ${cells}
    ${ticks}
    <g font-size="13" fill="${MUTED}">
      ${[['none', 'Clear'], ['light', 'Light'], ['moderate', 'Moderate'], ['heavy', 'Heavy']]
        .map(([k, l], i) => `<rect x="${32 + i * 112}" y="268" width="12" height="12" rx="3" fill="${LEVEL[k]}"/><text x="${50 + i * 112}" y="279">${l}</text>`).join('')}
    </g>
  </g>`;
}

// Soft decorative smoke wisps in the background.
const wisps = (w, h) => `
  <path d="M${-0.05 * w} ${0.85 * h} C ${0.2 * w} ${0.7 * h}, ${0.4 * w} ${0.95 * h}, ${0.65 * w} ${0.8 * h} S ${0.95 * w} ${0.6 * h}, ${1.05 * w} ${0.7 * h}"
        fill="none" stroke="${MUTED}" stroke-opacity="0.07" stroke-width="${0.06 * Math.min(w, h)}" stroke-linecap="round"/>
  <path d="M${-0.05 * w} ${0.25 * h} C ${0.3 * w} ${0.1 * h}, ${0.5 * w} ${0.35 * h}, ${1.05 * w} ${0.15 * h}"
        fill="none" stroke="${MUTED}" stroke-opacity="0.05" stroke-width="${0.04 * Math.min(w, h)}" stroke-linecap="round"/>`;

const frame = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${SANS}">
  <rect width="${w}" height="${h}" fill="${BG}"/>${wisps(w, h)}${body}</svg>`);

const footer = 'Hindi · English · Updated every 3 h';

const logoSvg = await readFile(out('logo.svg'));
const logoPng = (size) => sharp(logoSvg, { density: 300 }).resize(size, size).png().toBuffer();

async function withLogo(svg, w, h, logo) {
  const layers = [];
  if (logo) layers.push({ input: await logoPng(logo.size), left: logo.x, top: logo.y });
  return sharp(svg).composite(layers).png();
}

// Icons
for (const s of [72, 64, 88, 126, 180, 241]) {
  await sharp(logoSvg, { density: 300 }).resize(s, s).png().toFile(out(`icon-${s}.png`));
}

// Carousel 600 x 900 (portrait)
{
  const w = 600, h = 900, sc = 540 / 520;
  const svg = frame(w, h, `
    <text x="300" y="250" text-anchor="middle" font-size="44" font-weight="700" fill="${INK}">Will smoke reach</text>
    <text x="300" y="304" text-anchor="middle" font-size="44" font-weight="700" fill="${INK}">you tonight?</text>
    <g transform="translate(30 370) scale(${sc})">${card()}</g>
    <text x="300" y="820" text-anchor="middle" font-size="22" fill="${MUTED}">${esc(footer)}</text>`);
  await (await withLogo(svg, w, h, { size: 120, x: 240, y: 70 })).toFile(out('carousel-600x900.png'));
}

// Banner 1200 x 600 (landscape)
{
  const w = 1200, h = 600, sc = 560 / 520;
  const svg = frame(w, h, `
    <text x="70" y="250" font-size="50" font-weight="700" fill="${INK}">Will smoke reach</text>
    <text x="70" y="312" font-size="50" font-weight="700" fill="${INK}">you tonight?</text>
    <text x="70" y="370" font-size="22" fill="${MUTED}">Farm-fire smoke forecasts for Delhi NCR</text>
    <text x="70" y="520" font-size="20" fill="${MUTED}">${esc(footer)}</text>
    <g transform="translate(590 138) scale(${sc})">${card()}</g>`);
  await (await withLogo(svg, w, h, { size: 96, x: 70, y: 70 })).toFile(out('banner-1200x600.png'));
}

// Devpost thumbnail 1500 x 1000 (3:2)
{
  const w = 1500, h = 1000, sc = 900 / 520;
  const svg = frame(w, h, `
    <text x="250" y="168" font-size="76" font-weight="800" fill="${INK}">Dhuaan for Alexa+</text>
    <text x="252" y="222" font-size="30" fill="${MUTED}">Will smoke reach you tonight?</text>
    <g transform="translate(300 300) scale(${sc})">${card()}</g>
    <text x="750" y="${300 + 300 * sc + 75}" text-anchor="middle" font-size="28" fill="${MUTED}">${esc(footer)}</text>`);
  await (await withLogo(svg, w, h, { size: 150, x: 70, y: 80 })).toFile(out('devpost-thumb-1500x1000.png'));
}

console.log('assets written');
