/**
 * Reading and writing machine files (_machines/<slug>.md).
 *
 * A machine file is front matter (YAML between --- lines) + a Markdown body ("## Notes ...").
 * Saving goes through yaml-patch so only changed values are rewritten (see that file for why).
 * The body is replaced as a whole, but only if it actually changed.
 */
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { repo, exists, moveSafe, moveToTrash } from './util.mjs';
import { patchYaml, normalizeLongText } from './yaml-patch.mjs';
import { schema, groups, site } from '../config.mjs';
import { SLUG } from '../../scripts/machine-files.mjs';
import { loadRules, checkMachine } from '../../scripts/issue-rules.mjs';
import { hasLedger, readLedger } from '../../scripts/private-repo.mjs';

export { SLUG };
const dir = path.join(repo, site.collectionDir);
export const machinePath = slug => path.join(dir, `${slug}.md`);

const FM = /^---\r?\n([\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;

/** Split a machine file into { fm (YAML text, ends with newline), body, eol }. */
export function splitFile(text) {
  const m = text.match(FM);
  if (!m) throw new Error('This file has no front matter (--- block at the top)');
  return { fm: m[1] || '', body: text.slice(m[0].length), eol: text.includes('\r\n') ? '\r\n' : '\n' };
}

/** Parse the front matter into plain data. List items get `_index` = their position in the file. */
function toForm(fm) {
  const data = YAML.parse(fm) || {};
  for (const l of ['issues', 'repairs']) {
    if (Array.isArray(data[l])) data[l] = data[l].map((it, i) => (it && typeof it === 'object' ? { ...it, _index: i } : it));
  }
  return data;
}

export async function listSlugs() {
  return (await readdir(dir)).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)).sort();
}

export async function readMachine(slug) {
  const file = machinePath(slug);
  const text = await readFile(file, 'utf8');
  const { fm, body } = splitFile(text);
  return { slug, data: toForm(fm), body, mtime: (await stat(file)).mtimeMs };
}

export async function readAll() {
  const out = [];
  for (const slug of await listSlugs()) {
    try { out.push(await readMachine(slug)); }
    catch (e) { out.push({ slug, error: e.message, data: {}, body: '' }); }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Cleaning form input
// ---------------------------------------------------------------------------------------------

/**
 * Turn what the browser sent into clean values of the right type, using the schema:
 * trimmed strings, numbers or null, real booleans, YYYY-MM-DD dates, string lists without blanks,
 * prose with normalised line breaks. Unknown keys pass through untouched.
 */
export function cleanData(data, sch = schema) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    const f = sch.fields.find(x => x.key === k);
    out[k] = f ? cleanValue(v, f) : v;
  }
  return out;
}

function cleanValue(v, f) {
  switch (f.kind) {
    case 'number': {
      if (v === '' || v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean': return v === true || v === 'true';
    case 'date': return v ? String(v).trim().slice(0, 10) : null;
    case 'long': return normalizeLongText(v);
    case 'flowList': return [].concat(v ?? []).map(s => String(s).trim()).filter(Boolean);
    case 'issueRef': {
      const ids = [].concat(v ?? []).map(s => String(s).trim()).filter(Boolean);
      return ids.length === 0 ? '' : ids.length === 1 ? ids[0] : ids;
    }
    case 'items': return [].concat(v ?? []).filter(it => it && typeof it === 'object').map(it => {
      const clean = cleanData(it, f.item);
      if (Number.isInteger(it._index)) clean._index = it._index;
      return clean;
    });
    default: return v == null ? '' : String(v).trim();
  }
}

// ---------------------------------------------------------------------------------------------
// Validation (shown in the editor; FAIL blocks saving, WARN doesn't)
// ---------------------------------------------------------------------------------------------

let rulesCache = null;
async function rules() { return (rulesCache ??= await loadRules(repo)); }
export function resetRules() { rulesCache = null; }

export async function validate(data, options) {
  const problems = [];
  const fail = (msg, p) => problems.push({ level: 'FAIL', msg, path: p });
  const warn = (msg, p) => problems.push({ level: 'WARN', msg, path: p });

  // Required fields and select values from the machine form
  for (const f of groups.flatMap(g => g.fields)) {
    const v = data[f.key];
    if (f.required && (v == null || v === '')) fail(`${f.label} is required`, f.key);
    if (f.input === 'select' && v && options[f.options] && !options[f.options].some(o => o.key === v)) {
      fail(`${f.label}: "${v}" isn't one of the allowed values (${options[f.options].map(o => o.key).join(', ')})`, f.key);
    }
    if (f.kind === 'date' && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail(`${f.label} should be a date like 2026-11-07`, f.key);
  }
  for (const t of data.tags || []) if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(t)) warn(`Tag "${t}": tags read best as lowercase-with-hyphens`, 'tags');
  for (const [i, r] of (data.repairs || []).entries()) if (!r.date) fail(`Repair #${i + 1} needs a date`, `repairs.${i}.date`);

  // The issue/repair rules shared with `npm run check:issues`
  problems.push(...checkMachine(data, await rules()));
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------------------------

/**
 * Save edits to a machine. `data` is the full form (all keys); only changed values are written.
 * Returns { problems, changed }. Throws with .status = 422 when validation has FAILs.
 */
export async function saveMachine(slug, rawData, body, options) {
  const file = machinePath(slug);
  const text = await readFile(file, 'utf8');
  const parts = splitFile(text);
  const data = cleanData(rawData);

  const problems = await validate(data, options);
  if (problems.some(p => p.level === 'FAIL')) {
    const e = new Error('Fix the problems marked in red before saving.');
    e.status = 422; e.problems = problems;
    throw e;
  }

  const fm = patchYaml(parts.fm, data, schema);
  let newBody = parts.body;
  if (typeof body === 'string' && body.replace(/\r\n/g, '\n') !== parts.body.replace(/\r\n/g, '\n')) {
    newBody = body.replace(/\r\n/g, '\n');
    if (newBody && !newBody.endsWith('\n')) newBody += '\n';
    if (parts.eol === '\r\n') newBody = newBody.replace(/\n/g, '\r\n');
  }
  const out = assemble(parts, fm, newBody);
  const changed = out !== text;
  if (changed) await writeFile(file, out);
  return { problems, changed };
}

/** Change one value without the full form (used after photo renames to keep `cover:` pointing right). */
export async function setField(slug, key, value) {
  const file = machinePath(slug);
  const text = await readFile(file, 'utf8');
  const parts = splitFile(text);
  const fm = patchYaml(parts.fm, { [key]: value }, schema);
  await writeFile(file, assemble(parts, fm, parts.body));
}

/** Put a machine file back together: --- / front matter / --- / body, with the file's own line endings. */
function assemble(parts, fm, body) {
  return '---' + parts.eol + fm + '---' + parts.eol + body;
}

// ---------------------------------------------------------------------------------------------
// Rename and delete
// ---------------------------------------------------------------------------------------------

/** What renaming would affect, for the warning dialog. */
export async function renameInfo(slug) {
  let ledgerKey = false;
  if (hasLedger()) {
    try { ledgerKey = slug in (await readLedger()); } catch {}
  }
  return { ledger: hasLedger(), ledgerKey };
}

/** Rename slug: moves the .md file, originals/<slug>/ and photos/<slug>/. The ledger is NOT touched. */
export async function renameMachine(slug, to) {
  if (!SLUG.test(to)) throw Object.assign(new Error('The new name must be lowercase words joined by hyphens'), { status: 400 });
  if (await exists(machinePath(to))) throw Object.assign(new Error(`_machines/${to}.md already exists`), { status: 409 });
  for (const d of [site.originalsDir, site.photosDir]) {
    if (await exists(path.join(repo, d, to))) throw Object.assign(new Error(`${d}/${to}/ already exists`), { status: 409 });
  }
  await moveSafe(machinePath(slug), machinePath(to));
  for (const d of [site.originalsDir, site.photosDir]) {
    const from = path.join(repo, d, slug);
    if (await exists(from)) await moveSafe(from, path.join(repo, d, to));
  }
  return { slug: to };
}

/** Move the machine file and its photo folders to the trash. */
export async function trashMachine(slug) {
  return moveToTrash([machinePath(slug), path.join(repo, site.originalsDir, slug), path.join(repo, site.photosDir, slug)], slug);
}
