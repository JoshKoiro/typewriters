#!/usr/bin/env node
/**
 * Prepare typewriter photos for the website.
 *
 * For every machine folder in originals/ (originals/<slug>/), this script:
 *   1. Sorts the photos into display order (see photo-order.mjs: thumbnail, front, side, back,
 *      top, bottom, details, case shots, then everything else alphabetically),
 *   2. Rotates each one upright using the camera's orientation tag,
 *   3. Resizes it so the LONGER side is at most 2000 px (smaller images are never enlarged),
 *   4. Strips ALL metadata (EXIF, GPS location, camera/phone model, timestamps, XMP, comments),
 *   5. Saves it to photos/<slug>/ with a number giving its position:
 *        originals/1971-royal-mercury/thumbnail.jpg -> photos/1971-royal-mercury/01-thumbnail.jpg
 *        originals/1971-royal-mercury/front.jpg     -> photos/1971-royal-mercury/02-front.jpg
 *   6. Removes old web copies in photos/<slug>/ that no longer match an original
 *      (e.g. after a rename, or when a new photo shifts the numbering).
 *
 * photos/<slug>/ is a generated mirror of originals/<slug>/: don't edit it by hand.
 * Folders in photos/ with no matching originals folder are left alone.
 *
 * Colours are converted to standard sRGB, which is what browsers expect. Requires Node.js 20.9+.
 *
 * Usage (from the repo root):
 *     npm run photos                   # process new/changed photos
 *     npm run photos:force             # re-process everything
 *     node scripts/prep-photos.mjs SRC DEST --max 2000 --quality 90
 *     node scripts/prep-photos.mjs --only olivia   # just one machine folder (used by the CMS)
 */

import { readdir, mkdir, access, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { comparePhotoNames, isConventionalName } from './photo-order.mjs';

const INPUT_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.heic', '.heif']);
const OUTPUT_EXTS = new Set(['.jpg', '.png']);
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
const only = opt('--only', null); // one machine slug; the CMS processes just the machine you're editing
const force = args.includes('--force');
const positional = args.filter(a => !a.startsWith('--'));
const src = path.resolve(positional[0] ?? path.join(repo, 'originals'));
const dest = path.resolve(positional[1] ?? path.join(repo, 'photos'));

// ---------- Helpers ----------
const exists = p => access(p).then(() => true, () => false);

/** Lowercase, spaces/underscores -> hyphens, drop anything unusual. */
function webName(file) {
  const stem = path.parse(file).name.toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '');
  return stem || 'photo';
}

async function processPhoto(file, out) {
  // sharp drops all metadata on output unless told to keep it, so EXIF/GPS/XMP never reach the file.
  let img = sharp(file)
    .rotate() // apply the EXIF orientation, then forget it
    .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true });

  img = out.endsWith('.png')
    ? img.png({ compressionLevel: 9 })
    : img.jpeg({ quality, mozjpeg: true, progressive: true });

  const info = await img.toFile(out);
  return { width: info.width, height: info.height };
}

// ---------- Main ----------
if (!(await exists(src))) {
  console.error(`Input folder not found: ${src}`);
  process.exit(1);
}

let done = 0, skipped = 0, failed = 0, removed = 0, found = 0;
const entries = await readdir(src, { withFileTypes: true });

const loose = entries.filter(e => e.isFile() && INPUT_EXTS.has(path.extname(e.name).toLowerCase()));
if (loose.length) {
  console.log(`  NOTE  ${loose.length} photo(s) directly in ${path.basename(src)}/ were ignored: put them in a machine folder.`);
}

for (const folder of entries.filter(e => e.isDirectory() && (!only || e.name === only)).map(e => e.name).sort()) {
  const inDir = path.join(src, folder);
  const outDir = path.join(dest, folder);
  const files = (await readdir(inDir)).filter(f => INPUT_EXTS.has(path.extname(f).toLowerCase()));
  if (!files.length) continue;
  found += files.length;

  // Sort into display order and assign numbered output names
  files.sort((a, b) => comparePhotoNames(webName(a), webName(b)));
  const width = Math.max(2, String(files.length).length);
  const plan = [];
  for (const [i, file] of files.entries()) {
    const meta = await sharp(path.join(inDir, file)).metadata().catch(() => ({}));
    const asPng = path.extname(file).toLowerCase() === '.png' || meta.hasAlpha;
    const number = String(i + 1).padStart(width, '0');
    plan.push({ file, out: path.join(outDir, `${number}-${webName(file)}${asPng ? '.png' : '.jpg'}`) });
  }

  const nonStandard = files.filter(f => !isConventionalName(path.parse(f).name));
  if (nonStandard.length) {
    console.log(`  NOTE  ${folder}/ has names outside the convention (try: npm run rename): ${nonStandard.join(', ')}`);
  }

  await mkdir(outDir, { recursive: true });

  // Remove stale web copies (renamed, re-numbered or deleted originals)
  const expected = new Set(plan.map(p => path.basename(p.out)));
  for (const f of await readdir(outDir)) {
    if (OUTPUT_EXTS.has(path.extname(f).toLowerCase()) && !expected.has(f)) {
      await unlink(path.join(outDir, f));
      console.log(`  DEL   photos/${folder}/${f}`);
      removed++;
    }
  }

  for (const { file, out } of plan) {
    const rel = `${folder}/${file}`;
    if (!force && (await exists(out))) {
      skipped++;
      continue;
    }
    try {
      const { width: w, height: h } = await processPhoto(path.join(inDir, file), out);
      console.log(`  OK    ${rel}  ->  ${path.relative(path.dirname(dest), out).replaceAll('\\', '/')}  (${w}x${h})`);
      done++;
    } catch (err) {
      const heicHint = /\.hei[cf]$/i.test(file) ? ' (HEIC not supported: export as JPEG, see README)' : '';
      console.log(`  FAIL  ${rel}: ${err.message.split('\n')[0]}${heicHint}`);
      failed++;
    }
  }
}

if (found === 0) console.log(`No photos found in machine folders under ${src}`);
console.log(`\n${done} processed, ${skipped} already done (use --force to redo), ${removed} old copies removed, ${failed} failed.`);
