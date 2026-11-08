#!/usr/bin/env node
/**
 * Tests for the format-preserving save (cms/lib/yaml-patch.mjs), run against YOUR machine files.
 * Nothing is written: every check works on copies in memory.
 *
 *   npm run test:cms
 *
 *  1. Round trip: "saving" every machine with no changes must give back the file byte for byte.
 *  2. Targeted edits: one changed value changes exactly one line; comments stay in their column.
 *  3. Fuzz: thousands of random edits across all files. Each one must parse back to what was asked
 *     (patchYaml checks that itself and throws otherwise), so any throw here is a bug.
 * Run this after changing yaml-patch.mjs or config.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { patchYaml, normalizeLongText } from '../lib/yaml-patch.mjs';
import { schema } from '../config.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.join(repo, '_machines');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
const frontMatter = f => fs.readFileSync(path.join(dir, f), 'utf8').match(/^---\r?\n([\s\S]*?\r?\n)---/)[1];
const asForm = fm => { const o = YAML.parse(fm) || {}; for (const k of ['issues', 'repairs']) if (Array.isArray(o[k])) o[k] = o[k].map((it, i) => ({ ...it, _index: i })); return o; };
let failures = 0;
const fail = msg => { failures++; console.log('  FAIL ', msg); };

// 1. Round trip
for (const f of files) {
  const fm = frontMatter(f);
  if (patchYaml(fm, asForm(fm), schema) !== fm) fail(`${f}: saving with no changes altered the file`);
}
console.log(`round trip: ${files.length} files checked`);

// 2. Targeted edits
const changedLines = (a, b) => { const x = a.split('\n'), y = b.split('\n'); return y.filter((l, i) => l !== x[i]).length + Math.abs(x.length - y.length); };
for (const f of files) {
  const fm = frontMatter(f);
  const form = asForm(fm);
  form.year = (form.year || 1950) + 1;
  const out = patchYaml(fm, form, schema);
  if (changedLines(fm, out) !== 1) fail(`${f}: changing the year changed ${changedLines(fm, out)} lines`);
  const statusLine = fm.split('\n').find(l => l.startsWith('status:'));
  if (statusLine?.includes('#')) {
    const form2 = asForm(fm); form2.status = 'for-sale';
    const line = patchYaml(fm, form2, schema).split('\n').find(l => l.startsWith('status:'));
    // The comment keeps its column whenever the new value fits in the old space; otherwise it sits one
    // space after the value. Either way it must still be there.
    const fits = 'status: for-sale '.length <= statusLine.indexOf('#');
    if (!line.includes('# ') || (fits && line.indexOf('#') !== statusLine.indexOf('#'))) fail(`${f}: the comment after status: moved or was lost`);
  }
}
console.log('targeted edits: checked');

// 3. Fuzz
let seed = 7; const rnd = n => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
const pick = a => a[rnd(a.length)];
const words = ['yes', 'no', 'a: b', '#84 Bodoni', 'plain words', "it's", '"quoted"', '1e3', '2026-11-08', 'x, y', '[bracket]', '', 'Ünïcode ✓', 'double  space'];
const longs = ['Short.', 'A much longer piece of text that should wrap across several lines because it keeps going well past the wrap column.', 'Para one.\n\nPara two.', 'Line\nbreak', ''];
let ok = 0;
for (let n = 0; n < 2000; n++) {
  const file = pick(files);
  let fm = frontMatter(file);
  for (let step = 0; step < 3; step++) {
    const form = asForm(fm);
    const f = pick(schema.fields);
    switch (f.kind) {
      case 'quoted': case 'string': form[f.key] = pick(words); break;
      case 'number': form[f.key] = pick([null, 0, 7, 1965, 12.5]); break;
      case 'boolean': form[f.key] = pick([true, false]); break;
      case 'date': form[f.key] = pick(['', '2026-01-02']); break;
      case 'flowList': form[f.key] = Array.from({ length: rnd(4) }, () => pick(words)).filter(Boolean); break;
      case 'items': {
        const list = form[f.key] || [];
        const op = rnd(4);
        if (op === 0 || !list.length) list.push(f.key === 'issues'
          ? { id: 'i' + rnd(1000), title: pick(words) || 't', status: pick(['open', 'managed', 'fixed']), opened: '2026-11-08', description: normalizeLongText(pick(longs)) }
          : { date: '2026-11-08', issue: pick(['', 'feed-rollers', ['a', 'b']]), outcome: pick(['', 'fixed', 'partial']), work: normalizeLongText(pick(longs)) || 'w' });
        else if (op === 1) list.splice(rnd(list.length), 1);
        else { const it = list[rnd(list.length)]; const sub = pick(f.item.fields); if (sub.key !== 'id' && sub.key !== 'date') it[sub.key] = sub.kind === 'long' ? normalizeLongText(pick(longs)) : sub.kind === 'flowList' ? [] : sub.kind === 'date' ? pick(['', '2026-02-03']) : pick(['', 'open', 'fixed']); }
        form[f.key] = list;
      }
    }
    try { fm = patchYaml(fm, form, schema); ok++; }
    catch (e) { fail(`fuzz on ${file}, field ${f.key}: ${e.message}`); break; }
  }
}
console.log(`fuzz: ${ok} random edits`);

console.log(failures ? `\n${failures} failure(s)` : '\nAll CMS save tests passed.');
process.exit(failures ? 1 : 0);
