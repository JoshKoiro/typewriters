#!/usr/bin/env node
/**
 * The CMS: a local editor for the typewriter site.
 *
 *   npm run cms                 start the editor (http://localhost:4100) and the Jekyll preview
 *   npm run cms -- --no-preview   without starting Jekyll
 *   npm run cms -- --no-open      don't open the browser
 *   npm run cms -- --port 4200
 *
 * It edits the same files you'd edit by hand (_machines/*.md, originals/, photos/) and keeps their
 * format: see lib/yaml-patch.mjs. The private ledger is deliberately out of scope.
 *
 * SECURITY: this server can write files and run git, so it only listens on 127.0.0.1, and
 *   - rejects requests whose Host header isn't localhost (blocks DNS-rebinding from web pages),
 *   - requires an `X-CMS: 1` header on anything that changes state (a web page can't send a custom
 *     header to another origin without a CORS preflight, which this server never approves),
 *   - validates every slug and photo name against the naming patterns before touching a path.
 * Don't expose it on a network.
 *
 * Layout: lib/machines.mjs (machine files), lib/photos.mjs (photo slots + prep-photos),
 * lib/ops.mjs (git, npm jobs, Jekyll preview), lib/yaml-patch.mjs (format-preserving saves),
 * config.mjs (fields and where dropdown options come from), public/ (the editor UI).
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import YAML from 'yaml';
import { repo, exists, today } from './lib/util.mjs';
import { groups, lists, schema, site, photos as photoConfig } from './config.mjs';
import * as M from './lib/machines.mjs';
import * as P from './lib/photos.mjs';
import * as O from './lib/ops.mjs';
import { createMachine, guessFromSlug } from '../scripts/machine-files.mjs';
import { PHOTO_ORDER } from '../scripts/photo-order.mjs';
import { hasLedger } from '../scripts/private-repo.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argVal = (name, d) => { const i = args.indexOf(name); return i === -1 ? d : args[i + 1]; };
const PORT = Number(argVal('--port', site.cmsPort));
const HOST = '127.0.0.1';
const err = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

// ---------------------------------------------------------------------------------------------
// Schema for the editor: fields from config.mjs + dropdown options read from the _data files
// ---------------------------------------------------------------------------------------------

/** Read "file.yml" or "file.yml#key" from _data/ into [{ key, label, icon, color }]. */
async function loadOptions() {
  const sources = new Set();
  const walk = fields => fields.forEach(f => { if (f.options) sources.add(f.options); if (f.item) walk(f.item.fields); });
  walk(schema.fields);
  const out = {};
  for (const src of sources) {
    const [file, key] = src.split('#');
    let data = YAML.parse(await readFile(path.join(repo, '_data', file), 'utf8'));
    if (key) data = data?.[key];
    out[src] = (Array.isArray(data) ? data : []).map(o => ({ key: String(o.key), label: o.label ?? o.key, icon: o.icon || '', color: o.color || '' }));
  }
  return out;
}

/** Values already used in other machines, for autocomplete on fields with `suggest: true`. */
function suggestions(all) {
  const out = {};
  for (const f of groups.flatMap(g => g.fields).filter(f => f.suggest)) {
    const seen = new Map();
    for (const m of all) for (const v of [].concat(m.data[f.key] ?? [])) if (v !== '' && v != null) seen.set(String(v), (seen.get(String(v)) || 0) + 1);
    out[f.key] = [...seen.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v);
  }
  return out;
}

async function getSchema() {
  const [options, all, urls] = await Promise.all([loadOptions(), M.readAll(), O.previewUrl()]);
  return {
    groups, lists, options, suggestions: suggestions(all),
    photos: { order: PHOTO_ORDER, slotLabels: photoConfig.slotLabels, accept: photoConfig.accept },
    urls, hasLedger: hasLedger(), today: today(),
  };
}

// ---------------------------------------------------------------------------------------------
// Overview (dashboard + sidebar)
// ---------------------------------------------------------------------------------------------

async function overview() {
  const all = await M.readAll();
  const machines = [];
  const openIssues = [];
  const repairs = [];
  for (const m of all) {
    const d = m.data;
    const issues = Array.isArray(d.issues) ? d.issues : [];
    const open = issues.filter(i => i?.status === 'open');
    machines.push({ slug: m.slug, title: d.title || m.slug, nickname: d.nickname || '', status: d.status || '', year: d.year ?? null, openIssues: open.length, partsOnly: d.parts_only === true, error: m.error || null });
    for (const i of open) openIssues.push({ slug: m.slug, machine: d.title, nickname: d.nickname || '', issue: i });
    for (const r of Array.isArray(d.repairs) ? d.repairs : []) {
      const ids = [].concat(r?.issue ?? []).filter(Boolean);
      repairs.push({ slug: m.slug, machine: d.title, nickname: d.nickname || '', repair: r, issueTitles: ids.map(id => issues.find(i => i?.id === id)?.title || id) });
    }
  }
  repairs.sort((a, b) => String(b.repair.date || '').localeCompare(String(a.repair.date || '')));
  openIssues.sort((a, b) => String(b.issue.opened || '').localeCompare(String(a.issue.opened || '')));
  return { machines, openIssues, recentRepairs: repairs.slice(0, 12) };
}

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler });
const slugOf = p => { const s = decodeURIComponent(p.slug); if (!M.SLUG.test(s)) throw err(400, 'Bad machine name'); return s; };
async function ensureMachine(slug) { if (!(await exists(M.machinePath(slug)))) throw err(404, `No machine "${slug}"`); }

route('GET', '/api/schema', () => getSchema());
route('GET', '/api/overview', () => overview());

route('GET', '/api/machines/:slug', async ({ params }) => {
  const slug = slugOf(params);
  await ensureMachine(slug);
  const m = await M.readMachine(slug);
  const problems = await M.validate(M.cleanData(m.data), await loadOptions());
  return { ...m, problems };
});

route('PUT', '/api/machines/:slug', async ({ params, body }) => {
  const slug = slugOf(params);
  await ensureMachine(slug);
  const res = await M.saveMachine(slug, body.data, body.body, await loadOptions());
  const m = await M.readMachine(slug); // fresh _index values after list edits
  return { ...res, ...m };
});

route('POST', '/api/machines', async ({ body }) => {
  const slug = String(body.slug || '').trim().toLowerCase();
  try { return await createMachine(slug).then(r => ({ ...r, slug })); }
  catch (e) { throw err(e.message.includes('exists') ? 409 : 400, e.message); }
});
route('GET', '/api/slug-guess/:slug', ({ params }) => guessFromSlug(decodeURIComponent(params.slug)));

route('GET', '/api/machines/:slug/rename-info', async ({ params }) => M.renameInfo(slugOf(params)));
route('POST', '/api/machines/:slug/rename', async ({ params, body }) => {
  const slug = slugOf(params);
  await ensureMachine(slug);
  return M.renameMachine(slug, String(body.to || '').trim().toLowerCase());
});
route('DELETE', '/api/machines/:slug', async ({ params }) => {
  const slug = slugOf(params);
  await ensureMachine(slug);
  return M.trashMachine(slug);
});

// Photos
route('GET', '/api/machines/:slug/photos', ({ params }) => P.listPhotos(slugOf(params)));
route('PUT', '/api/machines/:slug/photos/:name', async ({ params, raw, query }) => {
  const slug = slugOf(params);
  await ensureMachine(slug);
  const prep = await P.uploadPhoto(slug, decodeURIComponent(params.name), raw, { replace: query.get('replace') === '1' });
  return { prep, ...(await P.listPhotos(slug)) };
});
route('POST', '/api/machines/:slug/photos/:name/rename', async ({ params, body }) => {
  const slug = slugOf(params);
  const prep = await P.renamePhoto(slug, decodeURIComponent(params.name), String(body.to || ''), { replace: !!body.replace });
  return { prep, ...(await P.listPhotos(slug)) };
});
route('DELETE', '/api/machines/:slug/photos/:name', async ({ params }) => {
  const slug = slugOf(params);
  const prep = await P.deletePhoto(slug, decodeURIComponent(params.name));
  return { prep, ...(await P.listPhotos(slug)) };
});
route('POST', '/api/machines/:slug/photos-restore', async ({ params }) => {
  const slug = slugOf(params);
  const r = await P.restoreFromWeb(slug);
  return { prep: r, restored: r.restored, ...(await P.listPhotos(slug)) };
});
route('POST', '/api/machines/:slug/photos-prep', async ({ params, body }) => {
  const slug = slugOf(params);
  const prep = await P.prep(slug, { force: !!body.force });
  return { prep, ...(await P.listPhotos(slug)) };
});

// Publishing and preview
route('GET', '/api/git', () => O.gitStatus());
route('GET', '/api/git/diff', ({ query }) => O.gitDiff(query.get('file')).then(diff => ({ diff })));
route('POST', '/api/git/commit', ({ body }) => O.gitCommit(body.message));
route('GET', '/api/jobs', () => O.jobList());
route('POST', '/api/jobs/:name', ({ params }) => O.startJob(decodeURIComponent(params.name)));
route('GET', '/api/jobs/:name/:id', ({ params }) => O.getJob(params.id) || Promise.reject(err(404, 'No such job')));
route('GET', '/api/preview', () => O.previewState());
route('POST', '/api/preview/start', () => O.startPreview());
route('POST', '/api/preview/stop', () => O.stopPreview());

// ---------------------------------------------------------------------------------------------
// Static files: the editor UI, a Markdown renderer from node_modules, thumbnails and full photos
// ---------------------------------------------------------------------------------------------

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

async function serveStatic(req, res, url) {
  let file = null;
  const p = decodeURIComponent(url.pathname);
  if (p === '/' || p === '/index.html') file = path.join(here, 'public', 'index.html');
  else if (/^\/(app\.js|style\.css|[\w-]+\.mjs)$/.test(p)) file = path.join(here, 'public', p.slice(1));
  else if (p === '/vendor/marked.js') file = path.join(repo, 'node_modules', 'marked', 'lib', 'marked.esm.js');
  else {
    const m = p.match(/^\/media\/(originals|photos)\/([a-z0-9-]+)\/([\w.-]+)$/);
    if (m && M.SLUG.test(m[2])) {
      if (url.searchParams.get('w')) {
        const buf = await P.thumbnail(m[1] === 'photos' ? 'web' : 'orig', m[2], m[3], Math.min(1200, Number(url.searchParams.get('w')) || 360));
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache' });
        return res.end(buf);
      }
      file = path.join(repo, m[1] === 'photos' ? site.photosDir : site.originalsDir, m[2], m[3]);
    }
  }
  if (!file || !(await exists(file))) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(await readFile(file));
}

// ---------------------------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------------------------

const MAX_JSON = 5 * 1024 * 1024;
const MAX_UPLOAD = 80 * 1024 * 1024;

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(err(413, 'That file is too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  try {
    // Host check: only "localhost:PORT" / "127.0.0.1:PORT" (see SECURITY above)
    const host = (req.headers.host || '').toLowerCase();
    if (host !== `localhost:${PORT}` && host !== `127.0.0.1:${PORT}`) { res.writeHead(403); return res.end('Forbidden'); }
    const url = new URL(req.url, `http://${host}`);

    if (!url.pathname.startsWith('/api/')) return await serveStatic(req, res, url);

    if (req.method !== 'GET' && req.headers['x-cms'] !== '1') return send(403, { error: 'Missing X-CMS header' });
    const r = routes.find(x => x.method === req.method && x.re.test(url.pathname));
    if (!r) return send(404, { error: 'Not found' });
    const params = url.pathname.match(r.re).groups || {};

    let body = {}, raw = null;
    if (req.method === 'PUT' && /\/photos\//.test(url.pathname)) raw = await readBody(req, MAX_UPLOAD);
    else if (req.method !== 'GET') {
      const b = await readBody(req, MAX_JSON);
      body = b.length ? JSON.parse(b.toString('utf8')) : {};
    }
    const result = await r.handler({ params, body, raw, query: url.searchParams });
    send(200, result ?? {});
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    send(status, { error: e.message, ...(e.problems ? { problems: e.problems } : {}), ...(e.exists ? { exists: true } : {}), ...(e.needsRestore ? { needsRestore: true } : {}) });
  }
});

server.listen(PORT, HOST, async () => {
  const url = `http://localhost:${PORT}/`;
  console.log(`\n  Typewriter CMS running at ${url}`);
  console.log('  Editing files in', repo);
  console.log('  Press Ctrl+C to stop.\n');
  if (!args.includes('--no-preview')) {
    await O.startPreview();
    console.log(`  Preview (Jekyll) starting at ${(await O.previewUrl()).preview}`);
  }
  if (!args.includes('--no-open')) openBrowser(url);
});
server.on('error', e => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Is the CMS already running? Try: npm run cms -- --port ${PORT + 1}` : e.message);
  process.exit(1);
});

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch {}
}

// Stop Jekyll with us, so port 4000 isn't left in use
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { O.stopPreview(); setTimeout(() => process.exit(0), 300); });
