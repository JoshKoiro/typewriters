#!/usr/bin/env node
/**
 * Safety check before publishing. Scans every image in photos/ and:
 *   - FAILS if any photo still carries EXIF, XMP or IPTC metadata (GPS location, camera info...)
 *   - warns about photos bigger than 2000 px on the long side (probably skipped prep-photos)
 *   - warns about photo folders that don't match any machine in _machines/ (typo in the folder name)
 *
 *   npm run check:photos
 *
 * Exits with an error when a photo has metadata, which stops `npm run deploy` from pushing.
 */

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const photosDir = path.join(repo, 'photos');
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MAX = 2000;

const machines = new Set(
  (await readdir(path.join(repo, '_machines'))).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3))
);

let problems = 0, warnings = 0, checked = 0;

for (const folder of await readdir(photosDir, { withFileTypes: true })) {
  if (!folder.isDirectory()) continue;

  if (!machines.has(folder.name)) {
    console.log(`  WARN  photos/${folder.name}/ has no matching _machines/${folder.name}.md`);
    warnings++;
  }

  for (const file of await readdir(path.join(photosDir, folder.name))) {
    if (!IMAGE_EXTS.has(path.extname(file).toLowerCase())) continue;
    const rel = `photos/${folder.name}/${file}`;
    const meta = await sharp(path.join(photosDir, folder.name, file)).metadata();
    checked++;

    const found = ['exif', 'xmp', 'iptc'].filter(k => meta[k]);
    if (found.length) {
      console.log(`  FAIL  ${rel} still has ${found.join(', ').toUpperCase()} metadata.`);
      console.log(`        Delete it, put the original in originals/${folder.name}/ and run: npm run photos`);
      problems++;
    }
    if (Math.max(meta.width, meta.height) > MAX) {
      console.log(`  WARN  ${rel} is ${meta.width}x${meta.height}, larger than ${MAX}px`);
      warnings++;
    }
  }
}

console.log(`\nChecked ${checked} photos: ${problems} with metadata, ${warnings} warnings.`);
if (problems) {
  console.log('Not safe to publish yet.');
  process.exit(1);
}
