/**
 * Small shared helpers for the CMS server: paths, the trash folder, running commands.
 */
import { rename, mkdir, access, cp, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { repo } from '../../scripts/private-repo.mjs';
import { site } from '../config.mjs';

export { repo };
export const exists = p => access(p).then(() => true, () => false);
export const rel = p => path.relative(repo, p).replaceAll('\\', '/');

/**
 * Move a file or folder into _trash/<timestamp>/<same relative path> instead of deleting it.
 * WHY: originals/ isn't in git, so a real delete would be unrecoverable. The trash is git-ignored and
 * Jekyll ignores folders starting with "_". Empty it by hand whenever you like.
 * One timestamp folder per action, so related files (a machine's .md + photos) stay together.
 */
export async function moveToTrash(paths, label = '') {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..*$/, '');
  const base = path.join(repo, site.trashDir, `${stamp}${label ? '-' + label : ''}`);
  const moved = [];
  for (const p of [].concat(paths)) {
    if (!(await exists(p))) continue;
    const dest = path.join(base, rel(p));
    await mkdir(path.dirname(dest), { recursive: true });
    await moveSafe(p, dest);
    moved.push(rel(p));
  }
  return { trash: rel(base), moved };
}

/** fs.rename, falling back to copy + delete across drives (EXDEV) or on Windows locking hiccups. */
export async function moveSafe(from, to) {
  try { await rename(from, to); }
  catch (e) {
    if (!['EXDEV', 'EPERM', 'EBUSY'].includes(e.code)) throw e;
    const s = await stat(from);
    await cp(from, to, { recursive: s.isDirectory() });
    await rm(from, { recursive: true, force: true });
  }
}

/**
 * Run a command and collect its output. shell: true so `npm` resolves to npm.cmd on Windows.
 * onData gets each chunk (used to stream job output to the editor).
 */
export function run(cmd, args = [], { onData, shell = false } = {}) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { cwd: repo, shell, env: { ...process.env, FORCE_COLOR: '0' } });
    let out = '';
    const take = d => { const s = d.toString(); out += s; onData?.(s); };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', e => { out += `\n${e.message}\n`; resolve({ code: -1, out }); });
    child.on('close', code => resolve({ code, out }));
  });
}

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
