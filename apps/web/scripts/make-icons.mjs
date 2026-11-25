/**
 * Draws the app icons into apps/web/public/. Run after changing the logo:
 *
 *   node apps/web/scripts/make-icons.mjs
 *
 * The letter is drawn as shapes, not text, so the icon looks the same on every phone
 * (a phone without the Space Grotesk font would otherwise draw a different "h").
 * Uses sharp from the API workspace (already installed by `npm install` at the repo root).
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const VIOLET = '#6A3DF5';
const SUNSHINE = '#FFC83D';
const out = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));

/** The mark on a 512 × 512 grid: a bold "h" and the sunshine dot, centred. */
const MARK = `
  <rect x="137" y="156" width="46" height="200" fill="#FFFFFF"/>
  <path d="M160 282 C160 226 295 216 295 282 V356" fill="none" stroke="#FFFFFF" stroke-width="46"/>
  <circle cx="351" cy="332" r="24" fill="${SUNSHINE}"/>`;

/**
 * @param rounded  true: rounded square with transparent corners ("any" icon, favicon).
 *                 false: full-bleed square, for maskable and Apple icons (the phone cuts its own shape).
 * @param scale    size of the mark; maskable icons keep it inside the central safe circle (radius 40 %).
 */
function svg({ rounded, scale }) {
  const t = 256 * (1 - scale);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
    `<rect width="512" height="512" ${rounded ? 'rx="112"' : ''} fill="${VIOLET}"/>` +
    `<g transform="translate(${t} ${t}) scale(${scale})">${MARK}</g></svg>`;
}

const png = (source, size, name) =>
  sharp(Buffer.from(source), { density: 72 * (size / 512) * 2 }).resize(size, size).png().toFile(out(name));

const any = svg({ rounded: true, scale: 1 });
await writeFile(out('icon.svg'), any + '\n');
await png(any, 192, 'icon-192.png');
await png(any, 512, 'icon-512.png');
await png(svg({ rounded: false, scale: 0.72 }), 512, 'icon-maskable-512.png');
await png(svg({ rounded: false, scale: 0.86 }), 180, 'apple-touch-icon.png');
// Link preview card (WhatsApp, Telegram, Facebook, X): 1200 × 630, the mark on violet, no words,
// so it stays right when the app is renamed (the name comes from the page title instead).
const OG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">` +
  `<rect width="1200" height="630" fill="${VIOLET}"/>` +
  `<circle cx="1040" cy="120" r="210" fill="#7C55F7"/><circle cx="150" cy="560" r="170" fill="#5A2EE6"/>` +
  `<g transform="translate(395 110) scale(0.8)"><rect width="512" height="512" rx="112" fill="#5228D9"/>${MARK}</g></svg>`;
await sharp(Buffer.from(OG), { density: 144 }).resize(1200, 630).png().toFile(out('og-image.png'));
console.log('Icons and the link preview card written to apps/web/public/');
