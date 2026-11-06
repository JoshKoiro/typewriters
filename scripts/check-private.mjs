#!/usr/bin/env node
/**
 * Safety check: makes sure the private ledger copy (_data/private.yml) can never be pushed.
 * Fails if git is tracking it, or if .gitignore doesn't cover it.
 *
 *   npm run check:private      (also part of npm run check / npm run deploy)
 */
import { execFileSync } from 'node:child_process';
import { repo } from './private-repo.mjs';

const FILE = '_data/private.yml';
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

let tracked = '';
try {
  git('rev-parse', '--is-inside-work-tree');
} catch {
  console.log('  SKIP  not a git repository');
  process.exit(0);
}

try { tracked = git('ls-files', FILE).trim(); } catch {}
if (tracked) {
  console.log(`  FAIL  ${FILE} is tracked by git. Remove it from git (keeps your local file):`);
  console.log(`        git rm --cached ${FILE}`);
  process.exit(1);
}

try {
  git('check-ignore', '-q', FILE);
} catch {
  console.log(`  FAIL  ${FILE} is not in .gitignore. Add this line to .gitignore:  ${FILE}`);
  process.exit(1);
}

console.log('Private data check passed: the ledger copy is git-ignored and untracked.');
