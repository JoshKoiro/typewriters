/**
 * Shared helpers for the PRIVATE ledger (purchase prices, where you bought it, sale prices...).
 *
 * The ledger lives in a separate private GitHub repo, cloned NEXT TO this one:
 *
 *   code/
 *     typewriters/            <- this repo (public)
 *     typewriters-private/    <- private repo with ledger.yml
 *
 * If you keep it somewhere else, set the TYPEWRITERS_PRIVATE environment variable to its folder.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const privateDir = path.resolve(process.env.TYPEWRITERS_PRIVATE || path.join(repo, '..', 'typewriters-private'));
export const ledgerFile = path.join(privateDir, 'ledger.yml');
export const localCopy = path.join(repo, '_data', 'private.yml');

export const hasLedger = () => existsSync(ledgerFile);

export async function readLedger() {
  return YAML.parse(await readFile(ledgerFile, 'utf8')) || {};
}

/** Read the front matter of every machine file: { slug: {title, status, acquired, ...} } */
export async function readMachines() {
  const { readdir } = await import('node:fs/promises');
  const dir = path.join(repo, '_machines');
  const machines = {};
  for (const file of (await readdir(dir)).filter(f => f.endsWith('.md')).sort()) {
    const text = await readFile(path.join(dir, file), 'utf8');
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    machines[file.slice(0, -3)] = match ? YAML.parse(match[1]) || {} : {};
  }
  return machines;
}

export function missingLedgerHelp() {
  return [
    `Private ledger not found at: ${ledgerFile}`,
    '',
    'Set it up once:',
    '  1. Create a PRIVATE repo on GitHub called typewriters-private',
    '  2. Clone it next to this repo:  git clone https://github.com/joshkoiro/typewriters-private.git',
    '     (so the folders are side by side: .../typewriters and .../typewriters-private)',
    '  3. Put ledger.yml in it (see the README section "Private data")',
    '',
    'Kept it somewhere else? Set TYPEWRITERS_PRIVATE to that folder.',
  ].join('\n');
}
