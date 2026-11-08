/**
 * The rules for a machine's issues and repair log, shared by:
 *   - scripts/check-issues.mjs  (npm run check:issues, part of npm run deploy)
 *   - the CMS (cms/server.mjs), which shows the same problems next to the form before saving
 * Keeping one copy means the editor and the deploy check can never disagree.
 *
 * checkMachine() returns a list of { level: 'FAIL' | 'WARN', msg, path } where `path` points at
 * the field ("issues.2.status", "repairs.0.issue") so the editor can highlight it.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

export const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const isDate = v => v instanceof Date || /^\d{4}-\d{2}-\d{2}$/.test(String(v));
const list = v => (v == null || v === '' ? [] : Array.isArray(v) ? v : [v]).map(String);
const fmtDate = d => (d instanceof Date ? d.toISOString().slice(0, 10) : d);

/** Allowed values from the data files. */
export async function loadRules(repo) {
  const readData = async name => YAML.parse(await readFile(path.join(repo, '_data', name), 'utf8'));
  const fields = await readData('fields.yml');
  return {
    statuses: new Set((await readData('issue_statuses.yml')).map(s => s.key)),
    categories: new Set((fields.issue_category || []).map(c => c.key)),
    outcomes: new Set((fields.repair_outcome || []).map(o => o.key)),
  };
}

/** Check one machine's front matter. `where` prefixes messages, e.g. "_machines/olivia.md". */
export function checkMachine(m, rules, where = '') {
  const out = [];
  const fail = (msg, p) => out.push({ level: 'FAIL', msg: `${where}${where ? ': ' : ''}${msg}`, path: p });
  const warn = (msg, p) => out.push({ level: 'WARN', msg: `${where}${where ? ': ' : ''}${msg}`, path: p });
  const { statuses, categories, outcomes } = rules;

  const issues = m.issues ?? [];
  const repairs = m.repairs ?? [];
  if (!Array.isArray(issues)) { fail('issues: should be a list (start each one with "- id:")', 'issues'); return out; }
  if (!Array.isArray(repairs)) { fail('repairs: should be a list', 'repairs'); return out; }

  const ids = new Set();
  for (const [i, issue] of issues.entries()) {
    const p = `issues.${i}`;
    const label = issue?.id ? `issue "${issue.id}"` : `issue #${i + 1}`;
    if (!issue?.id) { fail(`${label} has no id`, `${p}.id`); continue; }
    if (!ID.test(String(issue.id))) fail(`${label}: id should be lowercase-with-hyphens, e.g. feed-rollers`, `${p}.id`);
    if (ids.has(String(issue.id))) fail(`${label} is listed twice`, `${p}.id`);
    ids.add(String(issue.id));

    if (!issue.title) fail(`${label} has no title`, `${p}.title`);
    if (!statuses.has(issue.status)) fail(`${label}: status "${issue.status ?? ''}" must be one of: ${[...statuses].join(', ')}`, `${p}.status`);
    if (issue.category && !categories.has(issue.category)) fail(`${label}: category "${issue.category}" isn't in _data/fields.yml (issue_category)`, `${p}.category`);
    if (!issue.opened) warn(`${label} has no opened date`, `${p}.opened`);
    for (const k of ['opened', 'resolved']) {
      if (issue[k] && !isDate(issue[k])) warn(`${label}: ${k} should be a date like 2026-11-07 (no quotes)`, `${p}.${k}`);
    }
    if (issue.status && issue.status !== 'open' && statuses.has(issue.status) && !issue.resolution) {
      warn(`${label} is ${issue.status} but has no resolution: say how it was handled`, `${p}.resolution`);
    }
  }

  // Second pass, now that every id on this machine is known
  for (const [i, issue] of issues.entries()) {
    for (const rel of list(issue?.related)) {
      if (!ids.has(rel)) fail(`issue "${issue.id}": related "${rel}" isn't an issue on this machine`, `issues.${i}.related`);
    }
  }

  for (const [i, r] of repairs.entries()) {
    const p = `repairs.${i}`;
    const label = `repair #${i + 1}${r?.date ? ` (${fmtDate(r.date)})` : ''}`;
    if (!r?.date) warn(`${label} has no date`, `${p}.date`);
    else if (!isDate(r.date)) warn(`${label}: date should look like 2026-11-07 (no quotes)`, `${p}.date`);
    if (!r?.work) warn(`${label} has no work description`, `${p}.work`);
    for (const ref of list(r?.issue)) {
      if (!ids.has(ref)) fail(`${label} points at issue "${ref}", which isn't in this machine's issues${ids.size ? ` (have: ${[...ids].join(', ')})` : ''}`, `${p}.issue`);
    }
    if (r?.outcome && !outcomes.has(r.outcome)) fail(`${label}: outcome "${r.outcome}" must be one of: ${[...outcomes].join(', ')}`, `${p}.outcome`);
  }
  return out;
}

/** Counts for the summary line. */
export const countLinkedRepairs = m => (Array.isArray(m.repairs) ? m.repairs.filter(r => list(r?.issue).length).length : 0);
