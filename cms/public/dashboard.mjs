/**
 * The start page (#/): what needs attention, and the quick actions without opening a machine.
 * Quick actions here load the machine, change it and save (actions.onMachine).
 */
import { h, fill, api, clear, state, toast, toastError, modal, fmtDate, plural, optionInfo } from './core.mjs';
import * as A from './actions.mjs';

export function showDashboard(main, { refreshSidebar }) {
  const o = state.overview;
  const run = async (slug, action, ...args) => {
    try {
      const r = await A.onMachine(slug, data => action(data, ...args));
      if (r) { toast(`Saved ${r.data.title || slug}`); await refreshSidebar(); showDashboard(main, { refreshSidebar }); }
    } catch (e) { toastError(e); }
  };
  const findIssue = (data, id) => (data.issues || []).find(i => i.id === id);

  fill(main, 
    h('header.page-head', h('div', h('p.eyebrow', 'Typewriter CMS'), h('h1', 'Workbench'))),
    h('div.toolbar',
      h('button.btn.primary', { type: 'button', onclick: async () => { const s = await pickMachine('Log a repair on…'); if (s) run(s, A.logRepair); } }, '+ Log a repair'),
      h('button.btn', { type: 'button', onclick: async () => { const s = await pickMachine('New issue on…'); if (s) run(s, A.newIssue); } }, '+ New issue'),
      h('button.btn', { type: 'button', onclick: () => newMachine() }, '+ New machine')),

    h('h2.section-title', 'Open issues', h('span.muted', ` ${o.openIssues.length}`)),
    o.openIssues.length ? h('div.rows', o.openIssues.map(({ slug, machine, nickname, issue }) => {
      const cat = optionInfo('fields.yml#issue_category', issue.category);
      return h('div.row',
        h('div.row-main',
          h('a.row-title', { href: `#/m/${slug}/issues` }, issue.title),
          h('p.meta', h('strong', machine), nickname ? ` “${nickname}”` : '', [cat?.label, issue.opened && `since ${fmtDate(issue.opened)}`].filter(Boolean).map(s => ` · ${s}`))),
        h('div.row-actions',
          h('button.btn.small', { type: 'button', onclick: () => run(slug, A.logRepair, { issueId: issue.id }) }, 'Log repair'),
          h('button.btn.small', { type: 'button', onclick: () => run(slug, data => { const i = findIssue(data, issue.id); return i ? A.closeIssue(data, i) : false; }) }, 'Close…')));
    })) : h('p.empty', 'Nothing open. 🎉'),

    h('h2.section-title', 'Recent repairs'),
    o.recentRepairs.length ? h('div.rows', o.recentRepairs.map(({ slug, machine, nickname, repair, issueTitles }) => {
      const out = optionInfo('fields.yml#repair_outcome', repair.outcome);
      return h('div.row',
        h('div.row-main',
          h('p.meta', h('span.nowrap', fmtDate(repair.date)), ' · ', h('a', { href: `#/m/${slug}/issues` }, h('strong', machine), nickname ? ` “${nickname}”` : ''), issueTitles.length ? ` · ${issueTitles.join(', ')}` : ' · general', out ? h('span.outcome-chip', { style: `--c:${out.color}` }, `${out.icon} ${out.label}`) : null),
          h('p.clamp', repair.work)));
    })) : h('p.empty', 'No repairs logged yet.'));
}

/** Choose a machine (for dashboard quick actions). Resolves with a slug or null. */
export function pickMachine(title) {
  const ms = [...state.overview.machines].sort((a, b) => a.title.localeCompare(b.title));
  return modal(title, close => {
    const filter = h('input', { type: 'search', placeholder: 'Type to filter…', autofocus: true });
    const listEl = h('div.pick-list');
    const draw = () => {
      const q = filter.value.toLowerCase();
      listEl.replaceChildren(...ms.filter(m => `${m.title} ${m.nickname} ${m.slug}`.toLowerCase().includes(q)).map(m =>
        h('button.pick', { type: 'button', onclick: () => close(m.slug) }, h('span', m.title), m.nickname ? h('span.muted', ` “${m.nickname}”`) : null, m.openIssues ? h('span.count', m.openIssues) : null)));
    };
    filter.addEventListener('input', draw);
    // preventDefault: otherwise the same Enter keystroke "clicks" whatever button gets focus back
    // after the dialog closes (the toolbar button that opened it), reopening the picker.
    filter.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); listEl.querySelector('button')?.click(); } });
    draw();
    return h('div.modal-body', filter, listEl);
  });
}

/** Create a machine from the template (same as `npm run new -- <slug>`). */
export async function newMachine() {
  const slug = await modal('New machine', close => {
    const input = h('input', { type: 'text', placeholder: '1965-brother-valiant', autofocus: true });
    const preview = h('p.help', 'The slug becomes the file name and the page address. Lowercase words joined by hyphens; starting with the year fills in the year.');
    const err = h('p.msg.error', { hidden: true });
    input.addEventListener('input', async () => {
      const v = input.value.trim().toLowerCase();
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v)) return;
      const g = await api('GET', `/api/slug-guess/${encodeURIComponent(v)}`).catch(() => null);
      if (g) preview.textContent = `Title: “${g.title}”${g.year ? ` · Year: ${g.year}` : ''}. You can change both afterwards.`;
    });
    return h('form.modal-body', {
      onsubmit: e => {
        e.preventDefault();
        const v = input.value.trim().toLowerCase();
        if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v)) { err.textContent = 'Use lowercase words joined by hyphens, e.g. 1965-brother-valiant'; err.hidden = false; return; }
        close(v);
      },
    }, h('div.field', h('label', 'Slug'), input, preview), err,
    h('footer.modal-foot', h('button.btn', { type: 'button', onclick: () => close(null) }, 'Cancel'), h('button.btn.primary', { type: 'submit' }, 'Create')));
  });
  if (!slug) return;
  try {
    const r = await api('POST', '/api/machines', { slug });
    toast(`Created ${r.file}${r.ledgerAdded ? ' (and a private ledger entry)' : ''}`);
    location.hash = `#/m/${slug}/details`;
  } catch (e) { toastError(e); }
}
