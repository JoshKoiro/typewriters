#!/usr/bin/env node
/**
 * Rename the photos in originals/<slug>/ to the naming convention in photo-order.mjs.
 *
 *   npm run rename                 # PREVIEW ONLY: shows what would change, touches nothing
 *   npm run rename -- --apply      # actually rename the files
 *   node scripts/rename-originals.mjs <folder> [--apply]   # a different originals folder
 *
 * What it does to each file name:
 *   1. Removes a machine-name prefix shared by the folder's files
 *      (rand_back.jpg -> back.jpg, GalaxieII_front.jpg -> front.jpg)
 *   2. Lowercases, and turns underscores/spaces into hyphens (type_sample -> type-sample)
 *   3. Separates trailing numbers (general1 -> general-1)
 *   4. Applies the synonyms in ALIASES / WORD_ALIASES below (empty-case -> case-empty, ...)
 *   5. Normalizes the extension (.JPG / .jpeg -> .jpg)
 *
 * A folder is skipped entirely if two files would end up with the same name.
 */

import { readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHOTO_ORDER, shotIndex, comparePhotoNames, isConventionalName } from './photo-order.mjs';

// Whole-name synonyms -> the standard name
const ALIASES = {
  'empty-case': 'case-empty',
  'case': 'case-closed', // a lone "case" shot is the closed case
};
// Single-word synonyms, applied inside any name
const WORD_ALIASES = {
  opened: 'open',
};
// Words that are part of shot names, so they're never mistaken for a machine-name prefix
const KNOWN_WORDS = new Set([
  ...PHOTO_ORDER.flatMap(s => s.split('-')),
  'open', 'opened', 'closed', 'empty', 'in', 'cover', 'general', 'paper', 'hold', 'detail',
]);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.heic', '.heif']);

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const root = path.resolve(args.find(a => !a.startsWith('--')) ?? path.join(repo, 'originals'));

/** Find a prefix (first "_" segment) shared by most files in a folder that isn't a shot word. */
function detectPrefix(stems) {
  const counts = new Map();
  for (const stem of stems) {
    const parts = stem.toLowerCase().split('_');
    if (parts.length > 1) counts.set(parts[0], (counts.get(parts[0]) || 0) + 1);
  }
  for (const [prefix, n] of counts) {
    if (!KNOWN_WORDS.has(prefix) && n >= 2 && n > stems.length / 2) return prefix;
  }
  return null;
}

function standardName(stem, prefix) {
  let parts = stem.toLowerCase().split('_');
  if (prefix && parts.length > 1 && parts[0] === prefix) parts = parts.slice(1);
  let name = parts.join('-')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/([a-z])(\d+)$/, '$1-$2') // general1 -> general-1
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  name = name.split('-').map(w => WORD_ALIASES[w] ?? w).join('-');
  return ALIASES[name] ?? name;
}

function standardExt(ext) {
  ext = ext.toLowerCase();
  return ext === '.jpeg' ? '.jpg' : ext === '.tiff' ? '.tif' : ext;
}

// ---------- Main ----------
const folders = (await readdir(root, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name).sort();
let renamedTotal = 0, skippedFolders = 0;

console.log(apply ? 'Renaming files...\n' : 'PREVIEW: nothing is changed. Run with --apply to rename.\n');

for (const folder of folders) {
  const dir = path.join(root, folder);
  const files = (await readdir(dir)).filter(f => IMAGE_EXTS.has(path.extname(f).toLowerCase()));
  if (!files.length) continue;

  const stems = files.map(f => path.parse(f).name);
  const prefix = detectPrefix(stems);
  const plan = files.map(f => {
    const { name, ext } = path.parse(f);
    return { from: f, to: standardName(name, prefix) + standardExt(ext) };
  });

  // Collision check: two files can't end up with the same name
  const seen = new Map();
  const clashes = [];
  for (const p of plan) {
    const key = p.to.toLowerCase();
    if (seen.has(key)) clashes.push(`${seen.get(key)} and ${p.from} would both become ${p.to}`);
    else seen.set(key, p.from);
  }

  console.log(`${folder}/${prefix ? `   (removing prefix "${prefix}_")` : ''}`);
  if (clashes.length) {
    clashes.forEach(c => console.log(`  SKIPPED: ${c}`));
    console.log('  Rename one of them by hand, then run this again.\n');
    skippedFolders++;
    continue;
  }

  const changes = plan.filter(p => p.from !== p.to);
  for (const p of changes) console.log(`  ${p.from}  ->  ${p.to}`);
  if (!changes.length) console.log('  (already follows the convention)');

  const finalNames = plan.map(p => path.parse(p.to).name).sort(comparePhotoNames);
  const others = finalNames.filter(n => shotIndex(n) === -1);
  const odd = finalNames.filter(n => !isConventionalName(n));
  console.log(`  order: ${finalNames.join(', ')}`);
  if (others.length) console.log(`  note: not a standard shot, shown last alphabetically: ${others.join(', ')}`);
  if (odd.length) console.log(`  WARNING: still not a clean name: ${odd.join(', ')}`);
  console.log('');

  if (apply && changes.length) {
    // Two steps (via temporary names) so case-only renames work on Windows/macOS
    const temps = changes.map((p, i) => ({ ...p, tmp: `__renaming_${i}__${path.extname(p.to)}` }));
    for (const t of temps) await rename(path.join(dir, t.from), path.join(dir, t.tmp));
    for (const t of temps) await rename(path.join(dir, t.tmp), path.join(dir, t.to));
  }
  renamedTotal += changes.length;
}

const verb = apply ? 'Renamed' : 'Would rename';
console.log(`${verb} ${renamedTotal} files in ${folders.length - skippedFolders} folders${skippedFolders ? `, skipped ${skippedFolders} folder(s)` : ''}.`);
if (!apply && renamedTotal) console.log('Run again with --apply to do it:  npm run rename -- --apply');
if (apply && renamedTotal) console.log('Next: npm run photos:force   (rebuilds photos/ with the new names and order)');
