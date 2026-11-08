#!/usr/bin/env node
/**
 * Checks the issues and repair log in every machine file:
 *   - FAILS if a repair points at an issue id that doesn't exist on that machine (typo)
 *   - FAILS on duplicate issue ids, a missing id/title, or a status/category/outcome
 *     that isn't listed in _data/issue_statuses.yml or _data/fields.yml
 *   - FAILS if `related:` points at an issue that doesn't exist
 *   - warns about managed/fixed issues with no `resolution` (future-you will want to know how)
 *   - warns about issues with no `opened` date, or dates that aren't YYYY-MM-DD
 *
 *   npm run check:issues      (also part of npm run check / npm run deploy)
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { repo, readMachines } from './private-repo.mjs';

const readData = async name => YAML.parse(await readFile(path.join(repo, '_data', name), 'utf8'));
const statuses = new Set((await readData('issue_statuses.yml')).map(s => s.key));
const fields = await readData('fields.yml');
const categories = new Set((fields.issue_category || []).map(c => c.key));
const outcomes = new Set((fields.repair_outcome || []).map(o => o.key));

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const isDate = v => v instanceof Date || /^\d{4}-\d{2}-\d{2}$/.test(String(v));
const list = v => (v == null || v === '' ? [] : Array.isArray(v) ? v : [v]).map(String);

let problems = 0, warnings = 0, issueCount = 0, linkedRepairs = 0;
const fail = msg => { console.log(`  FAIL  ${msg}`); problems++; };
const warn = msg => { console.log(`  WARN  ${msg}`); warnings++; };

for (const [slug, m] of Object.entries(await readMachines())) {
  const where = `_machines/${slug}.md`;
  const issues = m.issues ?? [];
  const repairs = m.repairs ?? [];
  if (!Array.isArray(issues)) { fail(`${where}: issues: should be a list (start each one with "- id:")`); continue; }
  if (!Array.isArray(repairs)) { fail(`${where}: repairs: should be a list`); continue; }

  const ids = new Set();
  for (const [i, issue] of issues.entries()) {
    issueCount++;
    const label = issue?.id ? `issue "${issue.id}"` : `issue #${i + 1}`;
    if (!issue?.id) { fail(`${where}: ${label} has no id`); continue; }
    if (!ID.test(String(issue.id))) fail(`${where}: ${label}: id should be lowercase-with-hyphens, e.g. feed-rollers`);
    if (ids.has(String(issue.id))) fail(`${where}: ${label} is listed twice`);
    ids.add(String(issue.id));

    if (!issue.title) fail(`${where}: ${label} has no title`);
    if (!statuses.has(issue.status)) fail(`${where}: ${label}: status "${issue.status ?? ''}" must be one of: ${[...statuses].join(', ')}`);
    if (issue.category && !categories.has(issue.category)) fail(`${where}: ${label}: category "${issue.category}" isn't in _data/fields.yml (issue_category)`);
    if (!issue.opened) warn(`${where}: ${label} has no opened date`);
    for (const k of ['opened', 'resolved']) {
      if (issue[k] && !isDate(issue[k])) warn(`${where}: ${label}: ${k} should be a date like 2026-11-07 (no quotes)`);
    }
    if (issue.status && issue.status !== 'open' && statuses.has(issue.status) && !issue.resolution) {
      warn(`${where}: ${label} is ${issue.status} but has no resolution: say how it was handled`);
    }
  }

  // Second pass, now that every id on this machine is known
  for (const issue of issues) {
    for (const rel of list(issue?.related)) {
      if (!ids.has(rel)) fail(`${where}: issue "${issue.id}": related "${rel}" isn't an issue on this machine`);
    }
  }

  for (const [i, r] of repairs.entries()) {
    const label = `repair #${i + 1}${r?.date ? ` (${r.date instanceof Date ? r.date.toISOString().slice(0, 10) : r.date})` : ''}`;
    if (!r?.date) warn(`${where}: ${label} has no date`);
    else if (!isDate(r.date)) warn(`${where}: ${label}: date should look like 2026-11-07 (no quotes)`);
    if (!r?.work) warn(`${where}: ${label} has no work description`);
    const refs = list(r?.issue);
    if (refs.length) linkedRepairs++;
    for (const ref of refs) {
      if (!ids.has(ref)) fail(`${where}: ${label} points at issue "${ref}", which isn't in this machine's issues${ids.size ? ` (have: ${[...ids].join(', ')})` : ''}`);

    }
    if (r?.outcome && !outcomes.has(r.outcome)) fail(`${where}: ${label}: outcome "${r.outcome}" must be one of: ${[...outcomes].join(', ')}`);
  }
}

if (problems) {
  console.log(`\nIssues check FAILED: ${problems} problem(s), ${warnings} warning(s).`);
  process.exit(1);
}
console.log(`Issues check passed: ${issueCount} issue(s), ${linkedRepairs} linked repair(s)${warnings ? `, ${warnings} warning(s)` : ''}.`);
