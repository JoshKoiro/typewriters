/**
 * Publishing and preview: git, the npm check/deploy scripts, and the Jekyll preview server.
 *
 * Publishing reuses the existing npm scripts (`npm run check`, `npm run deploy`) rather than
 * reimplementing them, so the CMS can never publish something the command line would refuse.
 * Long-running commands are "jobs": started with POST, polled by the editor for output.
 */
import { spawn, execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { repo, run } from './util.mjs';
import { site } from '../config.mjs';

// ---------------------------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------------------------

const git = (...args) => new Promise(resolve => {
  execFile('git', args, { cwd: repo, maxBuffer: 10 * 1024 * 1024 }, (e, stdout, stderr) => resolve({ code: e ? e.code ?? 1 : 0, out: stdout + stderr }));
});

/** Changed files (like `git status`), the branch, and how many commits haven't been pushed. */
export async function gitStatus() {
  const s = await git('status', '--porcelain=v1', '--branch', '-uall');
  if (s.code !== 0) return { available: false, message: s.out.trim() };
  const lines = s.out.split('\n').filter(Boolean);
  const head = lines[0]?.startsWith('##') ? lines.shift() : '';
  const ahead = Number(head.match(/ahead (\d+)/)?.[1] || 0);
  const behind = Number(head.match(/behind (\d+)/)?.[1] || 0);
  const branch = head.replace(/^## /, '').split('...')[0];
  const files = lines.map(l => {
    const code = l.slice(0, 2);
    const file = l.slice(3).replace(/^"|"$/g, '');
    const kind = code.includes('?') ? 'new' : code.includes('D') ? 'deleted' : code.includes('R') ? 'renamed' : code.includes('A') ? 'new' : 'modified';
    return { code, file, kind };
  });
  return { available: true, branch, ahead, behind, files };
}

/** Stage everything (the README's "git add ." workflow) and commit. */
export async function gitCommit(message) {
  if (!message?.trim()) throw Object.assign(new Error('Write a commit message'), { status: 400 });
  const add = await git('add', '-A');
  if (add.code !== 0) throw Object.assign(new Error(add.out), { status: 500 });
  const c = await git('commit', '-m', message.trim());
  if (c.code !== 0) throw Object.assign(new Error(c.out.trim() || 'Nothing to commit'), { status: 400 });
  return { out: c.out };
}

/** The diff of one file, for the Publish page. */
export async function gitDiff(file) {
  if (!file || file.includes('..')) throw Object.assign(new Error('Bad path'), { status: 400 });
  const d = await git('diff', '--no-color', '--', file);
  if (d.out.trim()) return d.out;
  return (await git('diff', '--no-color', '--no-index', '--', process.platform === 'win32' ? 'NUL' : '/dev/null', file)).out;
}

// ---------------------------------------------------------------------------------------------
// Jobs: npm scripts the editor can run, with their output
// ---------------------------------------------------------------------------------------------

/** Only these can be started from the editor. */
const JOBS = {
  check: { label: 'Run all checks', cmd: 'npm run check' },
  'check:issues': { label: 'Check issues', cmd: 'npm run check:issues' },
  deploy: { label: 'Check and publish (git push)', cmd: 'npm run deploy' },
  photos: { label: 'Process all photos', cmd: 'npm run photos' },
};
const jobs = new Map();
let nextId = 1;

export function startJob(name) {
  const def = JOBS[name];
  if (!def) throw Object.assign(new Error(`Unknown job ${name}`), { status: 400 });
  const running = [...jobs.values()].find(j => j.name === name && j.status === 'running');
  if (running) return running;
  const job = { id: String(nextId++), name, label: def.label, status: 'running', out: `$ ${def.cmd}\n`, started: Date.now() };
  jobs.set(job.id, job);
  run(def.cmd, [], { shell: true, onData: s => { job.out += s; } }).then(({ code }) => {
    job.status = code === 0 ? 'ok' : 'failed';
    job.code = code;
    job.out += `\n[exit code ${code}]\n`;
  });
  return job;
}
export const getJob = id => jobs.get(id);
export const jobList = () => Object.entries(JOBS).map(([name, d]) => ({ name, label: d.label }));

// ---------------------------------------------------------------------------------------------
// Preview: `npm run serve` (Jekyll with live reload) as a child process
// ---------------------------------------------------------------------------------------------

const preview = { child: null, status: 'stopped', log: '', url: null };

export async function previewUrl() {
  const cfg = YAML.parse(await readFile(path.join(repo, '_config.yml'), 'utf8')) || {};
  const base = (cfg.baseurl || '').replace(/\/$/, '');
  return {
    preview: `http://localhost:${site.previewPort}${base}/`,
    live: cfg.url ? `${cfg.url.replace(/\/$/, '')}${base}/` : null,
  };
}

export async function startPreview() {
  if (preview.child) return previewState();
  preview.url = (await previewUrl()).preview;
  preview.status = 'starting';
  preview.log = `$ ${site.previewCommand}\n`;
  // detached on POSIX so the whole process group (npm -> jekyll) can be stopped together
  const child = spawn(site.previewCommand, { cwd: repo, shell: true, detached: process.platform !== 'win32', env: { ...process.env, FORCE_COLOR: '0' } });
  preview.child = child;
  const take = d => {
    preview.log = (preview.log + d.toString()).slice(-20000);
    if (/Server running|Server address/i.test(preview.log)) preview.status = 'running';
  };
  child.stdout.on('data', take);
  child.stderr.on('data', take);
  child.on('close', code => {
    if (preview.child === child) {
      preview.child = null;
      preview.status = preview.status === 'stopping' ? 'stopped' : 'failed';
      preview.log += `\n[preview exited with code ${code}]\n`;
    }
  });
  child.on('error', e => { preview.log += `\n${e.message}\n`; });
  return previewState();
}

export function stopPreview() {
  const child = preview.child;
  if (!child) return previewState();
  preview.status = 'stopping';
  try {
    // npm starts jekyll as a grandchild; kill the whole tree or jekyll keeps port 4000 open
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else process.kill(-child.pid, 'SIGTERM');
  } catch {}
  return previewState();
}

export const previewState = () => ({ status: preview.status, url: preview.url, log: preview.log.slice(-6000) });
