#!/usr/bin/env node
/**
 * Create a new machine from the template.
 *
 *   npm run new -- 1965-brother-valiant
 *
 * Creates:
 *   _machines/1965-brother-valiant.md     (copied from _templates/machine-template.md, title pre-filled)
 *   originals/1965-brother-valiant/       (drop the camera originals here)
 *   photos/1965-brother-valiant/          (prep-photos writes the web versions here)
 * and, if the private repo is set up, adds an empty entry for it to the private ledger.yml.
 */

import { readFile, writeFile, mkdir, access, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasLedger, readLedger, ledgerFile } from './private-repo.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = (process.argv[2] || '').trim().toLowerCase();

if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
  console.error('Usage: npm run new -- <slug>');
  console.error('The slug is lowercase words joined by hyphens, e.g. 1965-brother-valiant');
  process.exit(1);
}

const machineFile = path.join(repo, '_machines', `${slug}.md`);
if (await access(machineFile).then(() => true, () => false)) {
  console.error(`_machines/${slug}.md already exists, nothing changed.`);
  process.exit(1);
}

// Guess a title and year from the slug: "1965-brother-valiant" -> "1965 Brother Valiant", year 1965
const words = slug.split('-');
const title = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const year = /^(18|19|20)\d\d$/.test(words[0]) ? words[0] : '';

let text = await readFile(path.join(repo, '_templates', 'machine-template.md'), 'utf8');
text = text
  .replace(/^---\n(#.*\n)+/, '---\n') // drop the template's "how to use this file" comments
  .replace(/^title: ""/m, `title: "${title}"`)
  .replace(/^year:( *)/m, (m, spaces) => (year ? `year: ${year}`.padEnd(m.length) : m));

await writeFile(machineFile, text);
await mkdir(path.join(repo, 'originals', slug), { recursive: true });
await mkdir(path.join(repo, 'photos', slug), { recursive: true });
await writeFile(path.join(repo, 'photos', slug, '.gitkeep'), '');

console.log(`Created _machines/${slug}.md  (title: "${title}")`);
console.log(`Created originals/${slug}/ and photos/${slug}/`);
if (hasLedger()) {
  const ledger = await readLedger();
  if (!(slug in ledger)) {
    await appendFile(ledgerFile, ledgerEntry(slug));
    console.log(`Added ${slug} to the private ledger (${ledgerFile})`);
  }
}

console.log('\nNext: fill in the machine file, put photos in originals/, then run  npm run photos');

function ledgerEntry(slug) {
  return `
${slug}:
  paid:
  bought_at: ""
  seller: ""
  sold_for:
  sold_to: ""
  notes: ""
`;
}
