/**
 * The machine page: #/m/<slug>/<tab>
 *
 *   details  the front-matter form, grouped like the template (config.mjs `groups`)
 *   notes    the Markdown body with a live preview
 *   issues   issues and the repair log, with the quick actions (actions.mjs)
 *   photos   photo slots (photos.mjs)
 *
 * Editing works on an in-memory copy of the machine (`cur.data`, `cur.body`). Details and Notes
 * edits are saved with the Save button (or Ctrl+S); quick actions and photo changes save at once.
 * Saving sends the whole form; the server only rewrites values that changed (yaml-patch.mjs).
 * The server validates on save; FAIL problems block the save and are shown next to the fields.
 */
import { h, fill, api, clear, state, toast, toastError, confirmDialog, modal, fmtDate, plural, optionInfo } from './core.mjs';
import { field, problemMap } from './fields.mjs';
import * as A from './actions.mjs';
import { renderPhotos } from './photos.mjs';
import { marked } from '/vendor/marked.js';

const TABS = [['details', 'Details'], ['notes', 'Notes'], ['issues', 'Issues & repairs'], ['photos', 'Photos']];
let cur = null; // { slug, data, body, saved, problems, photoNames }

const snapshot = () => JSON.stringify({ data: cur.data, body: cur.body });
const isDirty = () => !!cur && snapshot() !== cur.saved;

export async function showMachine(main, slug, tab = 'details', { refreshSidebar }) {
  if (!cur || cur.slug !== slug) {
    const m = await api('GET', `/api/machines/${slug}`);
    cur = { slug, data: m.data, body: m.body, problems: m.problems || [], photoNames: [] };
    cur.saved = snapshot();
    api('GET', `/api/machines/${slug}/photos`).then(p => { cur.photoNames = p.photos.map(x => x.name); }).catch(() => {});
  }
  state.dirty = isDirty;
  cur.refreshSidebar = refreshSidebar;
  render(main, tab);
}
export const forgetMachine = () => { cur = null; };

function render(main, tab) {
  const d = cur.data;
  const openCount = (d.issues || []).filter(i => i.status === 'open').length;
  const fails = cur.problems.filter(p => p.level === 'FAIL'), warns = cur.problems.filter(p => p.level === 'WARN');
  const urls = state.schema.urls;
  fill(main, 
    h('header.page-head',
      h('div',
        h('p.eyebrow', h('code', `_machines/${cur.slug}.md`)),
        h('h1', d.title || cur.slug),
        d.nickname ? h('p.nickname', `“${d.nickname}”`) : null),
      h('div.head-actions',
        h('a.btn', { href: `${urls.preview}machines/${cur.slug}/`, target: '_blank', rel: 'noopener', title: 'The local Jekyll preview (updates when you save)' }, 'Preview page ↗'),
        urls.live ? h('a.btn', { href: `${urls.live}machines/${cur.slug}/`, target: '_blank', rel: 'noopener', title: 'The published site (updates after you publish)' }, 'Live ↗') : null,
        h('button.btn', { type: 'button', onclick: renameFlow }, 'Rename…'),
        h('button.btn.danger-text', { type: 'button', onclick: trashFlow }, 'Move to trash…'))),
    (fails.length || warns.length) ? h('section.problems' + (fails.length ? '' : '.warn-only'),
      h('strong', fails.length ? `${plural(fails.length, 'problem')} to fix before saving` : plural(warns.length, 'warning')),
      h('ul', [...fails, ...warns].map(p => h('li.' + (p.level === 'FAIL' ? 'error' : 'warn'), p.msg)))) : null,
    h('nav.tabs', TABS.map(([k, label]) => h('a.tab' + (k === tab ? '.active' : ''), { href: `#/m/${cur.slug}/${k}` }, label, k === 'issues' && openCount ? h('span.count', openCount) : null))),
    h('section.tab-body', { id: 'tab-body' }),
    saveBar());
  const body = main.querySelector('#tab-body');
  ({ details: renderDetails, notes: renderNotes, issues: renderIssues, photos: renderPhotosTab }[tab] || renderDetails)(body);
  updateSaveBar();
}

// ---------------------------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------------------------

function saveBar() {
  return h('div.savebar', { id: 'savebar' },
    h('span.savebar-msg', { id: 'savebar-msg' }),
    h('button.btn', { type: 'button', id: 'discard-btn', onclick: discard }, 'Discard changes'),
    h('button.btn.primary', { type: 'button', id: 'save-btn', onclick: () => save() }, 'Save'));
}
function updateSaveBar() {
  const bar = document.getElementById('savebar');
  if (!bar) return;
  const dirty = isDirty();
  bar.classList.toggle('dirty', dirty);
  document.getElementById('savebar-msg').textContent = dirty ? 'Unsaved changes' : 'All changes saved';
  document.getElementById('save-btn').disabled = !dirty;
  document.getElementById('discard-btn').hidden = !dirty;
}
const changed = () => updateSaveBar();

/** Save the form. Returns true on success. */
export async function save({ quiet = false } = {}) {
  const btn = document.getElementById('save-btn');
  if (btn) btn.disabled = true;
  try {
    const r = await api('PUT', `/api/machines/${cur.slug}`, { data: cur.data, body: cur.body });
    cur.data = r.data; cur.body = r.body; cur.problems = r.problems || [];
    cur.saved = snapshot();
    if (!quiet) toast(r.changed ? 'Saved' : 'Nothing to save');
    cur.refreshSidebar?.();
    rerender();
    return true;
  } catch (e) {
    if (e.data?.problems) { cur.problems = e.data.problems; rerender(); }
    toastError(e);
    updateSaveBar();
    return false;
  }
}
async function discard() {
  if (!(await confirmDialog({ title: 'Discard changes?', body: 'Your unsaved edits to this machine will be lost.', ok: 'Discard', danger: true }))) return;
  const s = JSON.parse(cur.saved);
  cur.data = s.data; cur.body = s.body;
  rerender();
}
function rerender() {
  const main = document.getElementById('main');
  const tab = (location.hash.split('/')[3] || 'details');
  if (cur && location.hash.startsWith(`#/m/${cur.slug}`)) render(main, tab);
}

/** Run a quick action on the open machine and save straight away. */
async function act(fn, ...args) {
  const before = snapshot();
  try {
    if (!(await fn(cur.data, ...args))) return;
  } catch (e) { return toastError(e); }
  if (snapshot() === before) return;
  await save();
}

// Ctrl+S / Cmd+S saves the open machine
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && cur && location.hash.startsWith('#/m/')) {
    e.preventDefault();
    if (isDirty()) save();
  }
});

// ---------------------------------------------------------------------------------------------
// Details
// ---------------------------------------------------------------------------------------------

function renderDetails(el) {
  const probs = problemMap(cur.problems);
  const ctx = { problems: probs, photoNames: cur.photoNames, issues: cur.data.issues || [] };
  el.append(h('div.groups', state.schema.groups.map(g => h('fieldset.group',
    h('legend', g.title),
    h('div.form-grid', g.fields.map(f => field(f, cur.data[f.key], v => { cur.data[f.key] = v; changed(); }, ctx)))))));
}

// ---------------------------------------------------------------------------------------------
// Notes (the Markdown body)
// ---------------------------------------------------------------------------------------------

function renderNotes(el) {
  const preview = h('div.md-preview.prose');
  const draw = () => { preview.innerHTML = marked.parse(cur.body || ''); };
  const ta = h('textarea.md-editor', { value: cur.body, spellcheck: true, oninput: e => { cur.body = e.target.value; draw(); changed(); } });
  draw();
  el.append(
    h('p.help', 'Markdown. Headings start with ##, *italic*, **bold**, blank line = new paragraph. The preview is approximate; the site styles it.'),
    h('div.md-split', h('div.md-pane', h('h3.pane-title', 'Markdown'), ta), h('div.md-pane', h('h3.pane-title', 'Preview'), preview)));
}

// ---------------------------------------------------------------------------------------------
// Issues & repairs
// ---------------------------------------------------------------------------------------------

function renderIssues(el) {
  const d = cur.data;
  const issues = d.issues || [];
  const repairs = d.repairs || [];
  const statusOrder = state.schema.options['issue_statuses.yml'].map(s => s.key);
  const sorted = [...issues].sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status));
  const probs = problemMap(cur.problems);

  el.append(
    h('div.toolbar',
      h('button.btn.primary', { type: 'button', onclick: () => act(A.logRepair) }, '+ Log a repair'),
      h('button.btn', { type: 'button', onclick: () => act(A.newIssue) }, '+ New issue')),
    h('h2.section-title', 'Issues', h('span.muted', ` ${issueCounts(issues)}`)),
    issues.length ? h('div.issue-list', sorted.map(i => issueCard(i, repairs, probs, issues.indexOf(i)))) : h('p.empty', 'No issues logged. Use “New issue” when something needs attention.'),
    h('h2.section-title', 'Repair log', h('span.muted', ` ${plural(repairs.length, 'job')}, newest first`)),
    repairs.length ? repairTable(repairs, issues, probs) : h('p.empty', 'No repairs yet.'));
}

function issueCounts(issues) {
  return state.schema.options['issue_statuses.yml'].map(s => [s, issues.filter(i => i.status === s.key).length]).filter(([, n]) => n).map(([s, n]) => `${n} ${s.label.toLowerCase()}`).join(' · ');
}

function issueCard(issue, repairs, probs, idx) {
  const s = optionInfo('issue_statuses.yml', issue.status) || { label: issue.status || '?', color: '#555' };
  const cat = optionInfo('fields.yml#issue_category', issue.category);
  const linked = repairs.filter(r => [].concat(r.issue ?? []).includes(issue.id)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const issueProbs = [...probs.entries()].filter(([p]) => p.startsWith(`issues.${idx}.`)).flatMap(([, v]) => v);
  const open = issue.status === 'open';
  return h('details.issue-card', { style: `--c:${s.color}` },
    h('summary',
      h('span.badge', { style: `--c:${s.color}` }, `${s.icon || ''} ${s.label}`),
      h('span.issue-main',
        h('span.issue-title', issue.title || issue.id),
        h('span.meta', [cat?.label || issue.category, issue.opened && `since ${fmtDate(issue.opened)}`, linked.length ? plural(linked.length, 'repair') : 'no repairs yet'].filter(Boolean).join(' · ')),
        !open && issue.resolution ? h('span.resolution', h('strong', `${s.label}: `), issue.resolution) : null,
        issueProbs.map(p => h('span.msg.' + (p.level === 'FAIL' ? 'error' : 'warn'), p.msg))),
      h('span.card-actions', { onclick: e => e.preventDefault() },
        open ? h('button.btn.small', { type: 'button', onclick: () => act(A.logRepair, { issueId: issue.id }) }, 'Log repair') : null,
        open ? h('button.btn.small', { type: 'button', onclick: () => act(A.closeIssue, issue) }, 'Close…') : h('button.btn.small', { type: 'button', onclick: () => act(A.reopenIssue, issue) }, 'Reopen'),
        h('button.btn.small', { type: 'button', onclick: () => act(A.editIssue, issue) }, 'Edit'))),
    h('div.issue-details',
      issue.description ? h('div.problem-box', h('p.label', 'The problem'), h('p', issue.description)) : null,
      h('ol.history',
        !open ? h('li', h('span.when', `${s.label} ${fmtDate(issue.resolved)}`), h('p', issue.resolution || '(no resolution written)')) : null,
        linked.map(r => h('li', h('span.when', `Repair ${fmtDate(r.date)}`, r.outcome ? h('span.outcome', ` · ${optionInfo('fields.yml#repair_outcome', r.outcome)?.label || r.outcome}`) : null), h('p', r.work))),
        h('li.first', h('span.when', `Problem found ${fmtDate(issue.opened)}`))),
      h('p.muted.small', `Id: ${issue.id}`)));
}

function repairTable(repairs, issues, probs) {
  const rows = repairs.map((r, i) => ({ r, i })).sort((a, b) => String(b.r.date || '').localeCompare(String(a.r.date || '')));
  return h('table.repairs',
    h('thead', h('tr', h('th', 'Date'), h('th', 'For'), h('th', 'Outcome'), h('th', 'Work done'), h('th', ''))),
    h('tbody', rows.map(({ r, i }) => {
      const ids = [].concat(r.issue ?? []).filter(Boolean);
      const outcome = optionInfo('fields.yml#repair_outcome', r.outcome);
      const rowProbs = [...probs.entries()].filter(([p]) => p.startsWith(`repairs.${i}.`)).flatMap(([, v]) => v);
      return h('tr',
        h('td.nowrap', fmtDate(r.date)),
        h('td', ids.length ? ids.map(id => h('span.chip', issues.find(x => x.id === id)?.title || id)) : h('span.muted', 'General')),
        h('td', outcome ? h('span.outcome-chip', { style: `--c:${outcome.color}` }, `${outcome.icon} ${outcome.label}`) : ''),
        h('td', h('p.clamp', { onclick: e => e.currentTarget.classList.toggle('open'), title: 'Click to expand' }, r.work), rowProbs.map(p => h('p.msg.' + (p.level === 'FAIL' ? 'error' : 'warn'), p.msg))),
        h('td.right', h('button.btn.small', { type: 'button', onclick: () => act(A.editRepair, r) }, 'Edit')));
    })));
}

// ---------------------------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------------------------

function renderPhotosTab(el) {
  renderPhotos(el, cur.slug, {
    cover: () => cur.data.cover || '',
    async setCover(name) {
      if (isDirty() && !(await confirmDialog({ title: 'Save other changes too?', body: 'Setting the cover saves the machine, including your unsaved edits.', ok: 'Save' }))) return;
      cur.data.cover = name;
      await save({ quiet: true });
      toast(name ? `Cover photo: ${name}` : 'Cover reset to the first photo');
    },
    onChange(list) {
      cur.photoNames = list.photos.map(p => p.name);
      // Renames/deletes can change `cover:` on the server; pick that up without losing unsaved edits
      if (cur.data.cover !== list.cover) {
        const saved = JSON.parse(cur.saved);
        saved.data.cover = list.cover;
        cur.saved = JSON.stringify(saved);
        cur.data.cover = list.cover;
      }
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Rename and trash
// ---------------------------------------------------------------------------------------------

async function renameFlow() {
  if (isDirty()) return toast('Save or discard your changes first.', 'error');
  const to = await modal('Rename machine', close => {
    const input = h('input', { type: 'text', value: cur.slug, autofocus: true, pattern: '[a-z0-9]+(-[a-z0-9]+)*' });
    return h('form.modal-body', { onsubmit: e => { e.preventDefault(); close(input.value.trim().toLowerCase()); } },
      h('div.field', h('label', 'New name (slug)'), input, h('p.help', 'Lowercase words joined by hyphens. Renames the .md file, originals/ and photos/ folders.')),
      h('footer.modal-foot', h('button.btn', { type: 'button', onclick: () => close(null) }, 'Cancel'), h('button.btn.primary', { type: 'submit' }, 'Continue…')));
  });
  if (!to || to === cur.slug) return;
  const info = await api('GET', `/api/machines/${cur.slug}/rename-info`);
  const base = state.schema.urls.live || state.schema.urls.preview;
  const warnings = [
    h('p', 'The page address changes:'),
    h('p.mono', `${base}machines/${cur.slug}/`), h('p.mono', `→ ${base}machines/${to}/`),
    h('p', h('strong', 'Links you have already shared (Facebook posts, messages) will stop working.')),
    info.ledgerKey
      ? h('p.warn-box', `The private ledger has an entry “${cur.slug}:”. The CMS doesn't touch the ledger, so that entry will be orphaned. Rename it to “${to}:” in ledger.yml by hand.`)
      : info.ledger
        ? h('p', 'The private ledger has no entry for this machine, so nothing there is affected.')
        : h('p.warn-box', `The private ledger isn't set up on this computer, so it can't be checked. If it has an entry “${cur.slug}:” elsewhere, rename that by hand.`),
  ];
  if (!(await confirmDialog({ title: `Rename to “${to}”?`, body: warnings, ok: 'Rename', danger: true }))) return;
  try {
    const r = await api('POST', `/api/machines/${cur.slug}/rename`, { to });
    cur = null;
    toast(`Renamed to ${r.slug}`);
    location.hash = `#/m/${r.slug}/details`;
  } catch (e) { toastError(e); }
}

async function trashFlow() {
  const ok = await confirmDialog({
    title: `Move “${cur.data.title || cur.slug}” to the trash?`,
    body: [`The machine file, its originals and its published photos move to the _trash folder (not deleted, and not published). To undo, move them back by hand.`, 'If it was sold, consider setting its status to Sold instead: that keeps its page.'],
    ok: 'Move to trash', danger: true,
  });
  if (!ok) return;
  try {
    const r = await api('DELETE', `/api/machines/${cur.slug}`);
    cur = null;
    toast(`Moved to ${r.trash}`);
    location.hash = '#/';
  } catch (e) { toastError(e); }
}
