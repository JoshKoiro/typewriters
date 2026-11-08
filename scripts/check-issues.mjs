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
 *
 * The rules themselves live in issue-rules.mjs, shared with the CMS editor.
 */
import { repo, readMachines } from './private-repo.mjs';
import { loadRules, checkMachine, countLinkedRepairs } from './issue-rules.mjs';

const rules = await loadRules(repo);
let problems = 0, warnings = 0, issueCount = 0, linkedRepairs = 0;

for (const [slug, m] of Object.entries(await readMachines())) {
  for (const { level, msg } of checkMachine(m, rules, `_machines/${slug}.md`)) {
    console.log(`  ${level}  ${msg}`);
    level === 'FAIL' ? problems++ : warnings++;
  }
  if (Array.isArray(m.issues)) issueCount += m.issues.length;
  linkedRepairs += countLinkedRepairs(m);
}

if (problems) {
  console.log(`\nIssues check FAILED: ${problems} problem(s), ${warnings} warning(s).`);
  process.exit(1);
}
console.log(`Issues check passed: ${issueCount} issue(s), ${linkedRepairs} linked repair(s)${warnings ? `, ${warnings} warning(s)` : ''}.`);
