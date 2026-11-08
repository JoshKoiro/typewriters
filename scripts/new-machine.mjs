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
 *
 * The work is done by createMachine() in machine-files.mjs, which the CMS uses too.
 */
import { createMachine } from './machine-files.mjs';
import { ledgerFile } from './private-repo.mjs';

const slug = (process.argv[2] || '').trim().toLowerCase();
try {
  const { file, title, ledgerAdded } = await createMachine(slug);
  console.log(`Created ${file}  (title: "${title}")`);
  console.log(`Created originals/${slug}/ and photos/${slug}/`);
  if (ledgerAdded) console.log(`Added ${slug} to the private ledger (${ledgerFile})`);
  console.log('\nNext: fill in the machine file, put photos in originals/, then run  npm run photos');
} catch (e) {
  if (!slug) console.error('Usage: npm run new -- <slug>');
  console.error(e.message.includes('already exists') ? `${e.message}, nothing changed.` : e.message);
  process.exit(1);
}
