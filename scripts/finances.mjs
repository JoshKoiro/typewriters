#!/usr/bin/env node
/**
 * Financial report for the collection: monthly cash flow, profit & loss, per-machine results.
 *
 *   npm run finances               # writes the report and opens it in your browser
 *   npm run finances -- --no-open  # just write it
 *
 * Data it uses:
 *   - typewriters-private/ledger.yml    paid / sold_for per machine
 *   - typewriters-private/expenses.yml  everything else you spend (ribbons, parts, tools, shipping...)
 *   - _machines/*.md (this repo)        acquired / sold_date: WHEN money went out or came in
 *
 * The report is written to typewriters-private/reports/finances.html, never into this public repo.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import YAML from 'yaml';
import { repo, privateDir, hasLedger, readLedger, readMachines, missingLedgerHelp } from './private-repo.mjs';

if (!hasLedger()) {
  console.error(missingLedgerHelp());
  process.exit(1);
}

// ---------- Load ----------
const ledger = await readLedger();
const machines = await readMachines();
const expensesFile = path.join(privateDir, 'expenses.yml');
const rawExpenses = existsSync(expensesFile) ? YAML.parse(await readFile(expensesFile, 'utf8')) || [] : [];
const fonts = YAML.parse(await readFile(path.join(repo, '_data', 'fonts.yml'), 'utf8'));

const iso = d => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : '');
const isNum = n => typeof n === 'number' && isFinite(n);
const warnings = [];

const nameOf = slug => {
  const m = machines[slug] || {};
  return (m.title || slug) + (m.nickname ? ` "${m.nickname}"` : '');
};

// ---------- Transactions ----------
// Every money movement becomes one transaction: { date, amount, direction: 'out'|'in', category, slug, label }
const tx = [];

for (const [slug, m] of Object.entries(machines)) {
  const p = ledger[slug] || {};
  if (isNum(p.paid)) {
    if (iso(m.acquired)) tx.push({ date: iso(m.acquired), amount: p.paid, direction: 'out', category: 'Typewriters', slug, label: `Bought ${nameOf(slug)}` });
    else warnings.push(`${slug}: has a price paid but no "acquired" date, so it's left out of the monthly figures`);
  }
  if (isNum(p.sold_for)) {
    if (iso(m.sold_date)) tx.push({ date: iso(m.sold_date), amount: p.sold_for, direction: 'in', category: 'Sales', slug, label: `Sold ${nameOf(slug)}` });
    else warnings.push(`${slug}: has a sale price but no "sold_date", so it's left out of the monthly figures`);
  }
  if (m.status === 'sold' && !isNum(p.sold_for)) warnings.push(`${slug}: status is sold but the ledger has no sold_for (enter 0 if it was a gift)`);
}

for (const [i, e] of (Array.isArray(rawExpenses) ? rawExpenses : []).entries()) {
  if (!isNum(e?.amount) || !iso(e?.date)) {
    warnings.push(`expenses.yml entry ${i + 1}: needs a date (YYYY-MM-DD) and a numeric amount, skipped`);
    continue;
  }
  if (e.machine && !machines[e.machine]) warnings.push(`expenses.yml entry ${i + 1}: machine "${e.machine}" doesn't match any _machines file`);
  tx.push({
    date: iso(e.date),
    amount: e.amount,
    direction: 'out',
    category: e.category || 'Other',
    slug: e.machine || '',
    label: e.description || e.category || 'Expense',
  });
}
tx.sort((a, b) => a.date.localeCompare(b.date));

const sum = list => list.reduce((s, t) => s + t.amount, 0);
const out = tx.filter(t => t.direction === 'out');
const income = tx.filter(t => t.direction === 'in');

// ---------- Monthly cash flow ----------
const monthKey = d => d.slice(0, 7);
const months = [];
if (tx.length) {
  const [y0, m0] = monthKey(tx[0].date).split('-').map(Number);
  const now = new Date();
  for (let y = y0, m = m0; y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1); m === 12 ? (y++, (m = 1)) : m++) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
  }
}
let running = 0;
const monthly = months.map(key => {
  const inMonth = tx.filter(t => monthKey(t.date) === key);
  const machinesOut = sum(inMonth.filter(t => t.direction === 'out' && t.category === 'Typewriters'));
  const otherOut = sum(inMonth.filter(t => t.direction === 'out' && t.category !== 'Typewriters'));
  const inn = sum(inMonth.filter(t => t.direction === 'in'));
  const net = inn - machinesOut - otherOut;
  running += net;
  return {
    key,
    label: new Date(key + '-01T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
    bought: inMonth.filter(t => t.direction === 'out' && t.category === 'Typewriters').length,
    machinesOut, otherOut, out: machinesOut + otherOut, in: inn, net, cumulative: running,
  };
});

// ---------- Per machine ----------
const perMachine = Object.keys(machines).map(slug => {
  const m = machines[slug], p = ledger[slug] || {};
  const extra = sum(out.filter(t => t.slug === slug && t.category !== 'Typewriters'));
  const paid = isNum(p.paid) ? p.paid : null;
  const cost = (paid ?? 0) + extra;
  const sold = m.status === 'sold' && isNum(p.sold_for);
  const end = sold && iso(m.sold_date) ? new Date(iso(m.sold_date)) : new Date();
  const days = iso(m.acquired) ? Math.round((end - new Date(iso(m.acquired))) / 86400000) : null;
  return { slug, name: nameOf(slug), status: m.status || '', acquired: iso(m.acquired), paid, extra, cost,
    soldFor: sold ? p.sold_for : null, profit: sold ? p.sold_for - cost : null, days };
}).sort((a, b) => (b.acquired || '').localeCompare(a.acquired || ''));

// ---------- Profit & loss ----------
// Sold machines: revenue minus what they cost (purchase + parts/costs linked to them) = realized result.
// Machines you still own aren't a loss: their cost is inventory ("collection at cost").
// Expenses not linked to any machine (tools, general supplies) are running costs.
const soldRows = perMachine.filter(r => r.soldFor !== null);
const ownedRows = perMachine.filter(r => r.status !== 'sold');
const pl = {
  revenue: sum(income),
  soldPurchase: soldRows.reduce((s, r) => s + (r.paid ?? 0), 0),
  soldExtra: soldRows.reduce((s, r) => s + r.extra, 0),
};
pl.gross = pl.revenue - pl.soldPurchase - pl.soldExtra;
const unlinked = out.filter(t => !t.slug);
const unlinkedByCat = groupSum(unlinked);
pl.operating = sum(unlinked);
pl.net = pl.gross - pl.operating;
const inventory = ownedRows.reduce((s, r) => s + r.cost, 0);

const totals = { out: sum(out), in: sum(income) };
totals.net = totals.in - totals.out;
const byCategory = groupSum(out).sort((a, b) => b.amount - a.amount);

function groupSum(list) {
  const map = new Map();
  for (const t of list) map.set(t.category, (map.get(t.category) || 0) + t.amount);
  return [...map].map(([category, amount]) => ({ category, amount }));
}

// ---------- Console summary ----------
const money = n => (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
console.log(`\nSpent:            ${money(totals.out)}`);
console.log(`From sales:       ${money(totals.in)}`);
console.log(`Net cash:         ${money(totals.net)}`);
console.log(`Realized P&L:     ${money(pl.net)}  (sold machines and running costs)`);
console.log(`Collection cost:  ${money(inventory)}  (${ownedRows.length} machines still owned)`);
if (warnings.length) console.log('\nWarnings:\n  ' + warnings.join('\n  '));

// ---------- HTML ----------
const reportDir = path.join(privateDir, 'reports');
await mkdir(reportDir, { recursive: true });
const reportFile = path.join(reportDir, 'finances.html');
await writeFile(reportFile, renderHTML());
console.log(`\nReport: ${reportFile}\n`);

if (!process.argv.includes('--no-open')) openFile(reportFile);

function openFile(file) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', file]]
    : process.platform === 'darwin' ? ['open', [file]] : ['xdg-open', [file]];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); } catch {}
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function signed(n) {
  return `<span class="${n < 0 ? 'neg' : n > 0 ? 'pos' : ''}">${money(n)}</span>`;
}
function held(days) {
  if (days === null) return '';
  if (days < 60) return `${days} days`;
  const months = Math.round(days / 30.44);
  return months < 24 ? `${months} months` : `${(days / 365.25).toFixed(1)} years`;
}

function cashFlowChart() {
  if (!monthly.length) return '<p class="muted">No dated transactions yet.</p>';
  const W = 860, H = 300, padL = 64, padR = 12, padT = 16, padB = 34;
  const max = Math.max(1, ...monthly.map(m => Math.max(m.in, m.out)));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const plotH = H - padT - padB, zero = padT + plotH / 2;
  const y = v => zero - (v / top) * (plotH / 2);
  const slot = (W - padL - padR) / monthly.length;
  const bw = Math.max(6, Math.min(44, slot * 0.6));
  const r = Math.min(4, bw / 2);

  let grid = '';
  for (let v = -top; v <= top + 1e-9; v += step) {
    const yy = y(v).toFixed(1);
    grid += `<line class="${v === 0 ? 'axis' : 'grid'}" x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}"/>`;
    grid += `<text class="tick" x="${padL - 8}" y="${yy}" dy="0.32em" text-anchor="end">${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US')}</text>`;
  }
  let bars = '', labels = '';
  const every = Math.ceil(monthly.length / 12);
  monthly.forEach((m, i) => {
    const cx = padL + slot * i + slot / 2, x = cx - bw / 2;
    // rounded end away from the zero line, square end on it
    if (m.in > 0) {
      const h = zero - y(m.in);
      bars += `<path class="bar-in" d="M${x},${zero - 1}V${zero - h + r}q0,-${r} ${r},-${r}h${bw - 2 * r}q${r},0 ${r},${r}V${zero - 1}z"/>`;
    }
    if (m.out > 0) {
      const h = y(-m.out) - zero;
      bars += `<path class="bar-out" d="M${x},${zero + 1}V${zero + h - r}q0,${r} ${r},${r}h${bw - 2 * r}q${r},0 ${r},-${r}V${zero + 1}z"/>`;
    }
    const tip = `${m.label}|In: ${money(m.in)}|Out: ${money(m.out)}${m.bought ? ` (${m.bought} typewriter${m.bought > 1 ? 's' : ''})` : ''}|Net: ${money(m.net)}`;
    bars += `<rect class="hit" x="${padL + slot * i}" y="${padT}" width="${slot}" height="${plotH}" data-tip="${esc(tip)}"/>`;
    if (i % every === 0) labels += `<text class="tick" x="${cx}" y="${H - 10}" text-anchor="middle">${esc(m.label)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly money in and out">${grid}${bars}${labels}</svg>`;
}

function categoryChart() {
  if (!byCategory.length) return '';
  const max = Math.max(...byCategory.map(c => c.amount));
  return `<div class="hbars">${byCategory.map(c => `
    <div class="hbar-row" data-tip="${esc(`${c.category}|${money(c.amount)}|${((c.amount / totals.out) * 100).toFixed(0)}% of spending`)}">
      <span class="hbar-label">${esc(c.category)}</span>
      <span class="hbar-track"><span class="hbar" style="width:${Math.max(1, (c.amount / max) * 100)}%"></span></span>
      <span class="hbar-value">${money(c.amount)}</span>
    </div>`).join('')}</div>`;
}

function niceStep(max) {
  const raw = max / 3, pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map(f => f * pow).find(s => s >= raw);
}

function renderHTML() {
  const fontSpecs = [...new Set([fonts.heading, fonts.body, fonts.ui].map(f => f.google).filter(Boolean))];
  const generated = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
  const plRow = (label, value, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="num">${value}</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Collection finances · private</title>
${fontSpecs.length ? `<link href="https://fonts.googleapis.com/css2?family=${fontSpecs.join('&family=')}&display=swap" rel="stylesheet">` : ''}
<style>
:root {
  --font-heading: "${fonts.heading.name}", ${fonts.heading.fallback};
  --font-body: "${fonts.body.name}", ${fonts.body.fallback};
  --font-ui: "${fonts.ui.name}", ${fonts.ui.fallback};
  --bg: #f8f7f4; --card: #f1f0ec; --ink: #111111; --ink-soft: #5f5e5a; --muted: #9b9a95;
  --rule: #dddcd6; --grid: #e8e7e2; --axis: #111111;
  --in: #2a78d6; --out: #eb6834; --pos: #1a7f45; --neg: #c0392b;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #151515; --card: #1e1e1d; --ink: #ededeb; --ink-soft: #a3a29d; --muted: #6c6b67;
    --rule: #2f2f2d; --grid: #262625; --axis: #ededeb;
    --in: #3987e5; --out: #d95926; --pos: #4cd17f; --neg: #ff7a6b;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--font-body); font-size: 16px; line-height: 1.5; letter-spacing: -0.011em; -webkit-font-smoothing: antialiased; font-feature-settings: "cv11", "ss03"; }
main { max-width: 1040px; margin: 0 auto; padding: 2.25rem 2rem 5rem; }
header { border-bottom: 2px solid var(--ink); padding-bottom: 1.1rem; }
h1, h2 { font-family: var(--font-heading); font-weight: 600; }
h1 { margin: 0; font-size: clamp(1.5rem, 3vw, 2.1rem); font-weight: 700; letter-spacing: -0.07em; line-height: 1; }
h2 { font-size: 1rem; letter-spacing: -0.025em; margin: 3.25rem 0 1rem; padding-top: 0.7rem; border-top: 2px solid var(--ink); }
.sub { margin: 0.5rem 0 0; color: var(--ink-soft); font-family: var(--font-ui); font-size: 0.8125rem; }
.private-note { display: inline-block; margin-top: 0.75rem; font-family: var(--font-ui); font-size: 0.8125rem; padding: 0.25rem 0.55rem; border-radius: 2px; background: var(--card); color: var(--ink-soft); }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(175px, 1fr)); gap: 1.5rem; margin-top: 2.5rem; }
.tile { border-top: 2px solid var(--ink); padding-top: 0.6rem; }
.tile .k { font-family: var(--font-ui); font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.tile .v { font-family: var(--font-heading); font-size: 1.75rem; font-weight: 700; letter-spacing: -0.04em; margin-top: 0.2rem; font-variant-numeric: tabular-nums; }
.tile .d { font-size: 0.82rem; color: var(--muted); margin-top: 0.1rem; }
.panel { padding: 0.25rem 0 0; }
.legend { display: flex; gap: 1.5rem; font-family: var(--font-ui); font-size: 0.85rem; color: var(--ink-soft); margin-bottom: 0.75rem; }
.legend i { display: inline-block; width: 0.7rem; height: 0.7rem; border-radius: 0; margin-right: 0.4rem; vertical-align: 0; }
.chart { width: 100%; height: auto; display: block; overflow: visible; }
.chart .grid { stroke: var(--grid); stroke-width: 1; }
.chart .axis { stroke: var(--axis); stroke-width: 1.5; }
.chart .tick { fill: var(--muted); font-family: var(--font-ui); font-size: 11px; }
.bar-in { fill: var(--in); } .bar-out { fill: var(--out); }
.hit { fill: transparent; cursor: default; }
.hit:hover { fill: color-mix(in srgb, var(--ink) 5%, transparent); }
.hbars { display: grid; gap: 0.55rem; }
.hbar-row { display: grid; grid-template-columns: minmax(110px, 180px) 1fr auto; gap: 0.9rem; align-items: center; }
.hbar-label { font-family: var(--font-ui); font-size: 0.88rem; }
.hbar-track { height: 12px; }
.hbar { display: block; height: 100%; background: var(--out); border-radius: 0 4px 4px 0; }
.hbar-value { font-family: var(--font-ui); font-size: 0.88rem; color: var(--ink-soft); text-align: right; min-width: 5.5rem; font-variant-numeric: tabular-nums; }
table { width: 100%; border-collapse: collapse; font-family: var(--font-ui); font-size: 0.9rem; }
th { text-align: left; font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); border-bottom: 1px solid var(--rule); padding: 0 0.75rem 0.6rem 0; white-space: nowrap; }
td { border-bottom: 1px solid var(--rule); padding: 0.6rem 0.75rem 0.6rem 0; vertical-align: top; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
th.num { text-align: right; }
.pos { color: var(--pos); } .neg { color: var(--neg); }
.pl td:first-child { padding-left: 0; }
.pl .indent td:first-child { padding-left: 1.25rem; color: var(--ink-soft); }
.pl .total td { font-weight: 600; border-top: 1px solid var(--ink-soft); }
.pl .section td { font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); padding-top: 1.5rem; border-bottom: none; }
.pl .section:first-child td { padding-top: 0; }
.scroll { overflow-x: auto; }
.nowrap { white-space: nowrap; }
.muted { color: var(--muted); }
.note { font-family: var(--font-ui); font-size: 0.85rem; color: var(--ink-soft); margin: 1rem 0 0; line-height: 1.55; }
.warnings { margin: 0; padding: 0.8rem 1rem 0.8rem 2rem; background: var(--card); border-left: 4px solid var(--out); font-family: var(--font-ui); font-size: 0.88rem; }
.warnings li { margin: 0.2rem 0; }
#tip { position: fixed; pointer-events: none; background: var(--ink); color: var(--bg); font-family: var(--font-ui); font-size: 0.8rem; line-height: 1.5; padding: 0.5rem 0.7rem; border-radius: 2px; display: none; z-index: 10; white-space: nowrap; }
#tip b { display: block; font-weight: 600; }
</style>
</head>
<body>
<main>
  <header>
  <h1>Collection finances</h1>
  <p class="sub">Generated ${esc(generated)} · ${tx.length} transactions · ${Object.keys(machines).length} machines</p>
  <span class="private-note">🔒 Private: built from typewriters-private. Don't publish this page.</span>
  </header>

  <section class="tiles">
    <div class="tile"><div class="k">Spent</div><div class="v">${money(totals.out)}</div><div class="d">${out.filter(t => t.category === 'Typewriters').length} typewriters + other costs</div></div>
    <div class="tile"><div class="k">Made from sales</div><div class="v">${money(totals.in)}</div><div class="d">${income.length} sold</div></div>
    <div class="tile"><div class="k">Net cash</div><div class="v">${signed(totals.net)}</div><div class="d">made minus spent</div></div>
    <div class="tile"><div class="k">Profit / loss</div><div class="v">${signed(pl.net)}</div><div class="d">on sales, after running costs</div></div>
    <div class="tile"><div class="k">Collection at cost</div><div class="v">${money(inventory)}</div><div class="d">${ownedRows.length} machines still owned</div></div>
  </section>

  ${warnings.length ? `<h2>Missing data</h2><ul class="warnings">${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}

  <h2>Monthly cash flow</h2>
  <div class="panel">
    <div class="legend"><span><i style="background:var(--in)"></i>Money in (sales)</span><span><i style="background:var(--out)"></i>Money out (purchases &amp; costs)</span></div>
    ${cashFlowChart()}
  </div>
  <div class="scroll" style="margin-top:1rem">
  <table>
    <thead><tr><th>Month</th><th class="num">Typewriters</th><th class="num">Other costs</th><th class="num">Total out</th><th class="num">In</th><th class="num">Net</th><th class="num">Running total</th></tr></thead>
    <tbody>${monthly.slice().reverse().map(m => `<tr><td>${esc(m.label)}</td><td class="num">${m.machinesOut ? money(m.machinesOut) + ` <span class="muted">(${m.bought})</span>` : ''}</td><td class="num">${m.otherOut ? money(m.otherOut) : ''}</td><td class="num">${m.out ? money(m.out) : ''}</td><td class="num">${m.in ? money(m.in) : ''}</td><td class="num">${signed(m.net)}</td><td class="num">${signed(m.cumulative)}</td></tr>`).join('')}</tbody>
  </table>
  </div>

  <h2>Profit &amp; loss</h2>
  <div class="panel">
  <table class="pl">
    <tbody>
      <tr class="section"><td colspan="2">Sales</td></tr>
      ${plRow('Revenue from typewriters sold', money(pl.revenue))}
      ${plRow('Purchase price of those typewriters', money(-pl.soldPurchase), 'indent')}
      ${plRow('Parts &amp; costs spent on them', money(-pl.soldExtra), 'indent')}
      ${plRow('Profit / loss on sales', signed(pl.gross), 'total')}
      <tr class="section"><td colspan="2">Running costs (not tied to one machine)</td></tr>
      ${unlinkedByCat.length ? unlinkedByCat.map(c => plRow(esc(c.category), money(-c.amount), 'indent')).join('') : plRow('None recorded', money(0), 'indent')}
      ${plRow('Total running costs', money(-pl.operating), 'total')}
      <tr class="section"><td colspan="2">Result</td></tr>
      ${plRow('Net profit / loss', signed(pl.net), 'total')}
    </tbody>
  </table>
  <p class="note">Typewriters you still own aren't counted as a loss. What you paid for them, plus any parts
  logged against them, is the <strong>collection at cost</strong> (${money(inventory)}): money turned into machines,
  not money gone. It becomes profit or loss when a machine is sold. Net cash (${money(totals.net)}) is the simpler view: everything in minus everything out.</p>
  </div>

  <h2>Spending by category</h2>
  <div class="panel">${categoryChart() || '<p class="muted">Nothing spent yet.</p>'}</div>

  <h2>By machine</h2>
  <div class="scroll">
  <table>
    <thead><tr><th>Machine</th><th>Status</th><th>Acquired</th><th class="num">Paid</th><th class="num">Parts &amp; costs</th><th class="num">Total cost</th><th class="num">Sold for</th><th class="num">Profit / loss</th><th class="num">Held</th></tr></thead>
    <tbody>${perMachine.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.status)}</td><td class="nowrap">${esc(r.acquired)}</td><td class="num">${r.paid === null ? '<span class="muted">?</span>' : money(r.paid)}</td><td class="num">${r.extra ? money(r.extra) : ''}</td><td class="num">${money(r.cost)}</td><td class="num">${r.soldFor === null ? '' : money(r.soldFor)}</td><td class="num">${r.profit === null ? '' : signed(r.profit)}</td><td class="num">${held(r.days)}</td></tr>`).join('')}</tbody>
  </table>
  </div>

  <h2>All transactions</h2>
  <div class="scroll">
  <table>
    <thead><tr><th>Date</th><th>What</th><th>Category</th><th class="num">Amount</th></tr></thead>
    <tbody>${tx.slice().reverse().map(t => `<tr><td class="nowrap">${t.date}</td><td>${esc(t.label)}${t.slug && t.category !== 'Typewriters' && t.category !== 'Sales' ? ` <span class="muted">· ${esc(nameOf(t.slug))}</span>` : ''}</td><td>${esc(t.category)}</td><td class="num">${signed(t.direction === 'in' ? t.amount : -t.amount)}</td></tr>`).join('')}</tbody>
  </table>
  </div>
</main>
<div id="tip" role="tooltip"></div>
<script>
  const tip = document.getElementById('tip');
  document.querySelectorAll('[data-tip]').forEach(el => {
    el.addEventListener('mousemove', e => {
      const [head, ...rest] = el.dataset.tip.split('|');
      tip.replaceChildren();
      const b = document.createElement('b'); b.textContent = head; tip.append(b);
      rest.forEach(line => { const d = document.createElement('div'); d.textContent = line; tip.append(d); });
      tip.style.display = 'block';
      const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
      tip.style.left = x + 'px';
      tip.style.top = (e.clientY + 14) + 'px';
    });
    el.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  });
</script>
</body>
</html>`;
}
