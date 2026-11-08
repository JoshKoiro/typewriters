/**
 * Quick actions for issues and repairs: the everyday edits, each one dialog and one save.
 *
 *   logRepair   date (today) + which issue + outcome + what you did. If the outcome is "Fixed it" (or
 *               you tick the box) the issue is closed in the same step, using the work as resolution.
 *   closeIssue  managed/fixed + date + resolution, optionally logging the repair that did it.
 *   newIssue    title (the id is made from it), category, the problem.
 *   editIssue / editRepair   every field, plus delete.
 *
 * Each action changes a machine's data object and returns true if something changed. The caller
 * saves: the machine page saves its open form; the dashboard uses onMachine() to load-change-save.
 */
import { h, api, modal, state, optionsFor, slugify, confirmDialog } from './core.mjs';
import { field } from './fields.mjs';

const lists = () => Object.fromEntries(state.schema.lists.map(l => [l.key, l.item.fields]));
const fieldDef = (list, key) => lists()[list].find(f => f.key === key);
const issueStatuses = () => optionsFor({ options: 'issue_statuses.yml' });

/** Load a machine, run an action on its data, save if it changed. Used from the dashboard. */
export async function onMachine(slug, action) {
  const m = await api('GET', `/api/machines/${slug}`);
  const changed = await action(m.data);
  if (!changed) return null;
  return api('PUT', `/api/machines/${slug}`, { data: m.data, body: m.body });
}

/** A dialog with schema fields. Resolves with the edited values, 'delete', or null. */
function formDialog(title, defs, values, ctx, { ok = 'Save', extra = null, onDelete = null, validate = null } = {}) {
  const v = structuredClone(values);
  return modal(title, close => {
    const err = h('p.msg.error', { hidden: true });
    const body = h('form.modal-body', {
      onsubmit: e => {
        e.preventDefault();
        const problem = validate?.(v);
        if (problem) { err.textContent = problem; err.hidden = false; return; }
        close(v);
      },
    },
      h('div.form-grid', defs.map(f => field(f, v[f.key], x => { v[f.key] = x; extra?.update?.(v); }, ctx))),
      extra?.el,
      err,
      h('footer.modal-foot',
        onDelete ? h('button.btn.danger.left', { type: 'button', onclick: async () => { if (await onDelete()) close('delete'); } }, 'Delete…') : null,
        h('button.btn', { type: 'button', onclick: () => close(null) }, 'Cancel'),
        h('button.btn.primary', { type: 'submit' }, ok)));
    // Ctrl+Enter submits from a textarea
    body.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) body.requestSubmit(); });
    return body;
  }, { wide: true });
}

// ---------------------------------------------------------------------------------------------

export async function logRepair(data, { issueId = '' } = {}) {
  const issues = data.issues || [];
  const defs = ['date', 'issue', 'outcome', 'work'].map(k => fieldDef('repairs', k));
  // "Close the issue too": shown when the repair is for an open issue
  const closeBox = h('input', { type: 'checkbox' });
  const closeRow = h('label.inline-check', closeBox, ' This fixed it: mark the issue ', h('strong', 'Fixed'), ' (the work becomes the resolution)');
  const extra = {
    el: h('div.extra', closeRow),
    update(v) {
      const issue = issues.find(i => i.id === v.issue);
      closeRow.hidden = !issue || issue.status !== 'open';
      if (v.outcome === 'fixed' && !closeRow.hidden) closeBox.checked = true;
    },
  };
  const values = { date: state.schema.today, issue: issueId, outcome: '', work: '' };
  extra.update(values);
  const r = await formDialog('Log a repair', defs, values, { issues }, {
    ok: 'Log repair', extra,
    validate: v => (!v.work?.trim() ? 'Describe the work you did.' : !v.date ? 'Pick a date.' : null),
  });
  if (!r) return false;
  data.repairs = [...(data.repairs || []), { date: r.date, issue: r.issue || '', outcome: r.outcome || '', work: r.work }];
  const issue = issues.find(i => i.id === r.issue);
  if (issue && closeBox.checked && !closeRow.hidden) {
    issue.status = 'fixed';
    issue.resolved = r.date;
    if (!issue.resolution) issue.resolution = r.work;
  }
  return true;
}

export async function closeIssue(data, issue) {
  const defs = [
    { ...fieldDef('issues', 'status'), label: 'Close as', required: true, exclude: ['open'], help: 'Fixed = solved. Managed = living with it, or worked around it.' },
    fieldDef('issues', 'resolved'),
    { ...fieldDef('issues', 'resolution'), required: true },
  ];
  // Optional: log the repair that solved it, in the same step
  const logBox = h('input', { type: 'checkbox' });
  const work = h('textarea', { rows: 3, placeholder: 'What you did (logged as a repair dated the same day, outcome "Fixed it")' });
  const extra = { el: h('div.extra', h('label.inline-check', logBox, ' Also log the repair that fixed it'), work) };
  work.hidden = true;
  logBox.addEventListener('change', () => { work.hidden = !logBox.checked; if (logBox.checked) work.focus(); });
  const r = await formDialog(`Close “${issue.title}”`, defs, { status: 'fixed', resolved: state.schema.today, resolution: issue.resolution || '' }, {}, {
    ok: 'Close issue', extra,
    validate: v => (!v.resolution?.trim() ? 'Say how it was handled: future-you will want to know.' : logBox.checked && !work.value.trim() ? 'Describe the repair, or untick "Also log".' : null),
  });
  if (!r) return false;
  Object.assign(issue, { status: r.status, resolved: r.resolved, resolution: r.resolution });
  if (logBox.checked) data.repairs = [...(data.repairs || []), { date: r.resolved || state.schema.today, issue: issue.id, outcome: r.status === 'fixed' ? 'fixed' : '', work: work.value.trim() }];
  return true;
}

export async function reopenIssue(data, issue) {
  if (!(await confirmDialog({ title: 'Reopen issue?', body: `“${issue.title}” goes back to Open. Its resolution text is kept.`, ok: 'Reopen' }))) return false;
  issue.status = 'open';
  issue.resolved = null;
  return true;
}

export async function newIssue(data) {
  const issues = data.issues || [];
  const defs = ['title', 'category', 'opened', 'description'].map(k => fieldDef('issues', k));
  const idNote = h('p.help');
  const extra = { el: idNote, update: v => { idNote.textContent = v.title ? `Id: ${uniqueId(issues, slugify(v.title))} (used in links: #issue-…)` : ''; } };
  const r = await formDialog('New issue', defs, { title: '', category: '', opened: state.schema.today, description: '' }, {}, {
    ok: 'Add issue', extra,
    validate: v => (!v.title?.trim() ? 'Give the issue a title.' : null),
  });
  if (!r) return false;
  data.issues = [...issues, { id: uniqueId(issues, slugify(r.title)), title: r.title.trim(), category: r.category, status: 'open', opened: r.opened, description: r.description }];
  return true;
}

export async function editIssue(data, issue) {
  const issues = data.issues || [];
  const defs = lists().issues;
  const r = await formDialog(`Edit issue`, defs, issue, { issues, selfId: issue.id, path: '' }, {
    validate: v => (!v.id || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v.id) ? 'The id must be lowercase-with-hyphens.' : issues.some(i => i !== issue && i.id === v.id) ? 'Another issue already uses that id.' : !v.title ? 'Give the issue a title.' : null),
    onDelete: () => confirmDialog({ title: 'Delete this issue?', body: [`“${issue.title}” will be removed from the file.`, linkedCount(data, issue.id) ? `${linkedCount(data, issue.id)} repair(s) point at it; they'll be kept as general work.` : ''].filter(Boolean), ok: 'Delete', danger: true }),
  });
  if (!r) return false;
  if (r === 'delete') {
    data.issues = issues.filter(i => i !== issue);
    for (const rep of data.repairs || []) if ([].concat(rep.issue ?? []).includes(issue.id)) rep.issue = [].concat(rep.issue).filter(x => x !== issue.id);
    return true;
  }
  // Renamed id: keep repairs and related links pointing at it
  if (r.id !== issue.id) {
    for (const rep of data.repairs || []) rep.issue = Array.isArray(rep.issue) ? rep.issue.map(x => (x === issue.id ? r.id : x)) : rep.issue === issue.id ? r.id : rep.issue;
    for (const i of issues) if (Array.isArray(i.related)) i.related = i.related.map(x => (x === issue.id ? r.id : x));
  }
  Object.assign(issue, r);
  return true;
}

export async function editRepair(data, repair) {
  const r = await formDialog('Edit repair', lists().repairs, repair, { issues: data.issues || [] }, {
    validate: v => (!v.work?.trim() ? 'Describe the work.' : !v.date ? 'Pick a date.' : null),
    onDelete: () => confirmDialog({ title: 'Delete this repair?', body: 'It will be removed from the repair log.', ok: 'Delete', danger: true }),
  });
  if (!r) return false;
  if (r === 'delete') data.repairs = (data.repairs || []).filter(x => x !== repair);
  else Object.assign(repair, r);
  return true;
}

function uniqueId(issues, base) {
  base = base || 'issue';
  let id = base, n = 2;
  while (issues.some(i => i.id === id)) id = `${base}-${n++}`;
  return id;
}
const linkedCount = (data, id) => (data.repairs || []).filter(r => [].concat(r.issue ?? []).includes(id)).length;
