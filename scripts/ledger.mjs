#!/usr/bin/env node
/**
 * Prints the private ledger joined with the public machine data, with totals.
 *
 *   npm run ledger
 *
 * Also warns about machines missing from the ledger, and ledger entries with no machine file.
 */
import { hasLedger, readLedger, readMachines, missingLedgerHelp, ledgerFile } from './private-repo.mjs';

if (!hasLedger()) {
  console.error(missingLedgerHelp());
  process.exit(1);
}

const ledger = await readLedger();
const machines = await readMachines();
const money = n => (typeof n === 'number' ? `$${n.toFixed(2)}` : '');
const date = d => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d) : '');

const rows = Object.entries(machines)
  .map(([slug, m]) => {
    const p = ledger[slug] || {};
    return {
      machine: (m.title || slug) + (m.nickname ? ` "${m.nickname}"` : ''),
      status: m.status || '',
      acquired: date(m.acquired),
      paid: p.paid,
      sold: p.sold_for,
      at: p.bought_at || '',
    };
  })
  .sort((a, b) => (b.acquired || '').localeCompare(a.acquired || ''));

// ---------- Table ----------
const cols = [
  ['machine', 'Machine', 'left'],
  ['status', 'Status', 'left'],
  ['acquired', 'Acquired', 'left'],
  ['paid', 'Paid', 'right'],
  ['sold', 'Sold for', 'right'],
  ['at', 'Bought at', 'left'],
];
const cell = (row, key) => (key === 'paid' || key === 'sold' ? money(row[key]) : String(row[key] ?? ''));
const widths = cols.map(([key, label]) => Math.max(label.length, ...rows.map(r => cell(r, key).length)));
const line = cells => cells.map((c, i) => (cols[i][2] === 'right' ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join('  ');

console.log(`\nLedger: ${ledgerFile}\n`);
console.log(line(cols.map(c => c[1])));
console.log(widths.map(w => '-'.repeat(w)).join('  '));
rows.forEach(r => console.log(line(cols.map(([key]) => cell(r, key)))));

// ---------- Totals ----------
const sum = list => list.reduce((s, n) => s + (typeof n === 'number' ? n : 0), 0);
const owned = rows.filter(r => r.status !== 'sold');
const sold = rows.filter(r => r.status === 'sold');
const totalPaid = sum(rows.map(r => r.paid));
const totalSold = sum(rows.map(r => r.sold));

console.log('');
console.log(`Spent, all machines:        ${money(totalPaid)}`);
console.log(`Spent, current collection:  ${money(sum(owned.map(r => r.paid)))}  (${owned.length} machines)`);
console.log(`Received from sales:        ${money(totalSold)}  (${sold.length} sold)`);
console.log(`Net spent:                  ${money(totalPaid - totalSold)}`);

// ---------- Consistency warnings ----------
const missing = Object.keys(machines).filter(s => !(s in ledger));
const orphans = Object.keys(ledger).filter(s => !(s in machines));
const noPrice = Object.keys(machines).filter(s => s in ledger && typeof ledger[s]?.paid !== 'number');
if (missing.length) console.log(`\nNot in the ledger yet: ${missing.join(', ')}`);
if (noPrice.length) console.log(`No price paid entered: ${noPrice.join(', ')}`);
if (orphans.length) console.log(`In the ledger but no _machines file (renamed?): ${orphans.join(', ')}`);
console.log('');
