#!/usr/bin/env node
/**
 * Prepare typewriter photos for the website.
 *
 * For every image in the input folder (default: originals/), this script:
 *   1. Rotates it upright using the camera's orientation tag (so nothing ends up sideways),
 *   2. Resizes it so the LONGER side is at most 2000 px (smaller images are never enlarged),
 *   3. Strips ALL metadata (EXIF, GPS location, camera/phone model, timestamps, XMP, comments),
 *   4. Saves it into the matching folder under photos/ with a web-safe file name.
 *
 * The folder structure is preserved, so put each machine's originals in a folder named after
 * its slug (the machine's file name in _machines/ without .md):
 *
 *     originals/1947-smith-corona-sterling/IMG_4821.JPG
 *       -> photos/1947-smith-corona-sterling/img_4821.jpg
 *
 * Colours are converted to standard sRGB, which is what browsers expect.
 *
 * Usage (from the repo root):
 *     npm install                      # once
 *     npm run photos                   # originals/ -> photos/
 *     npm run photos -- --force        # re-process files that already exist
 *     node scripts/prep-photos.mjs SRC DEST --max 2000 --quality 90
 */

import { readdir, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const INPUT_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.heic', '.heif']);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- Arguments ----------
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};
const maxSide = Number(opt('--max', 2000));
const quality = Number(opt('--quality', 90));
const force = args.includes('--force');
const positional = args.filter(a => !a.startsWith('--'));
const src = path.resolve(positional[0] ?? path.join(repo, 'originals'));
const dest = path.resolve(positional[1] ?? path.join(repo, 'photos'));

// ---------- Helpers ----------
const exists = p => access(p).then(() => true, () => false);

/** Lowercase, spaces -> hyphens, drop anything unusual. Keeps names URL-friendly. */
function webName(file) {
  const stem = path.parse(file).name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '');
  return stem || 'photo';
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (INPUT_EXTS.has(path.extname(entry.name).toLowerCase())) yield full;
  }
}

async function processPhoto(file, destBase) {
  const meta = await sharp(file).metadata();
  const asPng = path.extname(file).toLowerCase() === '.png' || meta.hasAlpha;
  const out = destBase + (asPng ? '.png' : '.jpg');
  await mkdir(path.dirname(out), { recursive: true });

  // sharp drops all metadata on output unless told to keep it, so EXIF/GPS/XMP never reach the file.
  let img = sharp(file)
    .rotate() // apply the EXIF orientation, then forget it
    .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true });

  img = asPng
    ? img.png({ compressionLevel: 9 })
    : img.jpeg({ quality, mozjpeg: true, progressive: true });

  const info = await img.toFile(out);
  return { out, width: info.width, height: info.height };
}

// ---------- Main ----------
if (!(await exists(src))) {
  console.error(`Input folder not found: ${src}`);
  process.exit(1);
}

let done = 0, skipped = 0, failed = 0, found = 0;

for await (const file of walk(src)) {
  found++;
  const rel = path.relative(src, file);
  const destBase = path.join(dest, path.dirname(rel), webName(file));

  if (!force && ((await exists(destBase + '.jpg')) || (await exists(destBase + '.png')))) {
    skipped++;
    continue;
  }

  try {
    const { out, width, height } = await processPhoto(file, destBase);
    console.log(`  OK    ${rel}  ->  ${path.relative(path.dirname(dest), out)}  (${width}x${height})`);
    done++;
  } catch (err) {
    const heicHint = /\.hei[cf]$/i.test(file) ? ' (HEIC not supported: export as JPEG, see README)' : '';
    console.log(`  FAIL  ${rel}: ${err.message.split('\n')[0]}${heicHint}`);
    failed++;
  }
}

if (found === 0) console.log(`No images found in ${src}`);
console.log(`\n${done} processed, ${skipped} already done (use --force to redo), ${failed} failed.`);
