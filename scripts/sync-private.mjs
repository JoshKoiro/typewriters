#!/usr/bin/env node
/**
 * Copies the private ledger into this repo as _data/private.yml so the LOCAL preview can show it,
 * or removes that copy again.
 *
 *   node scripts/sync-private.mjs            # copy it in   (used by: npm run serve:private)
 *   node scripts/sync-private.mjs --remove   # take it out  (used by: npm run serve)
 *
 * _data/private.yml is git-ignored, and `npm run check` fails if it's ever tracked by git,
 * so the private data can't end up on GitHub.
 */
import { copyFile, rm } from 'node:fs/promises';
import { hasLedger, ledgerFile, localCopy, missingLedgerHelp } from './private-repo.mjs';

if (process.argv.includes('--remove')) {
  await rm(localCopy, { force: true });
} else {
  if (!hasLedger()) {
    console.error(missingLedgerHelp());
    process.exit(1);
  }
  await copyFile(ledgerFile, localCopy);
  console.log(`Private ledger loaded from ${ledgerFile}`);
  console.log('Private details (🔒) are visible in this local preview only.\n');
}
