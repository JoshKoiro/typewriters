/**
 * Creating a machine, shared by scripts/new-machine.mjs (npm run new) and the CMS.
 * One copy of the rules: slug format, title/year guessed from the slug, the template, the
 * originals/ and photos/ folders, and the empty private-ledger entry.
 */
import { readFile, writeFile, mkdir, access, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { repo, hasLedger, readLedger, ledgerFile } from './private-repo.mjs';

export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** "1965-brother-valiant" -> { title: "1965 Brother Valiant", year: "1965" } */
export function guessFromSlug(slug) {
  const words = slug.split('-');
  return {
    title: words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    year: /^(18|19|20)\d\d$/.test(words[0]) ? words[0] : '',
  };
}

/**
 * Create _machines/<slug>.md from the template, plus originals/<slug>/ and photos/<slug>/,
 * and add an empty ledger entry if the private repo is set up.
 * Returns { file, title, ledgerAdded }. Throws if the slug is invalid or the machine exists.
 */
export async function createMachine(slug) {
  if (!SLUG.test(slug)) throw new Error('The slug is lowercase words joined by hyphens, e.g. 1965-brother-valiant');
  const machineFile = path.join(repo, '_machines', `${slug}.md`);
  if (await access(machineFile).then(() => true, () => false)) throw new Error(`_machines/${slug}.md already exists`);

  const { title, year } = guessFromSlug(slug);
  let text = await readFile(path.join(repo, '_templates', 'machine-template.md'), 'utf8');
  text = text
    .replace(/^---\n(#.*\n)+/, '---\n') // drop the template's "how to use this file" comments
    .replace(/^title: ""/m, `title: "${title}"`)
    .replace(/^year:( *)/m, (m, spaces) => (year ? `year: ${year}`.padEnd(m.length) : m));

  await writeFile(machineFile, text);
  await mkdir(path.join(repo, 'originals', slug), { recursive: true });
  await mkdir(path.join(repo, 'photos', slug), { recursive: true });
  await writeFile(path.join(repo, 'photos', slug, '.gitkeep'), '');

  let ledgerAdded = false;
  if (hasLedger()) {
    const ledger = await readLedger();
    if (!(slug in ledger)) {
      await appendFile(ledgerFile, ledgerEntry(slug));
      ledgerAdded = true;
    }
  }
  return { file: `_machines/${slug}.md`, title, ledgerAdded };
}

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
