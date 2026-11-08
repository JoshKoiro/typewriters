/**
 * Editor entry point: loads the schema, draws the sidebar and routes by URL hash.
 *
 *   #/                     workbench (open issues, recent repairs, quick actions)
 *   #/m/<slug>/<tab>       a machine (tabs: details, notes, issues, photos)
 *   #/publish              changed files, commit, check, publish
 *
 * Leaving a machine with unsaved changes asks first (state.dirty is set by the machine view).
 */
import { h, fill, api, clear, state, toastError, confirmDialog, plural } from './core.mjs';
import { showMachine, forgetMachine } from './machine.mjs';
import { showDashboard, newMachine } from './dashboard.mjs';
import { showPublish } from './publish.mjs';

const sidebar = document.getElementById('sidebar');
const main = document.getElementById('main');
let lastHash = location.hash || '#/';
let filter = '';

async function boot() {
  try {
    [state.schema, state.overview, state.git] = await Promise.all([api('GET', '/api/schema'), api('GET', '/api/overview'), api('GET', '/api/git').catch(() => null)]);
  } catch (e) {
    main.replaceChildren(h('p.warn-box', `Couldn't reach the CMS server: ${e.message}. Is "npm run cms" still running?`));
    return;
  }
  drawSidebar();
  route();
  pollPreview();
}

/** Re-read the machine list and git status (after a save, rename, commit...). */
async function refreshSidebar() {
  try {
    [state.overview, state.git] = await Promise.all([api('GET', '/api/overview'), api('GET', '/api/git').catch(() => null)]);
    drawSidebar();
  } catch (e) { toastError(e); }
}

// ---------------------------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------------------------

window.addEventListener('hashchange', async () => {
  const leavingMachine = lastHash.split('/').slice(0, 3).join('/') !== location.hash.split('/').slice(0, 3).join('/');
  if (leavingMachine && state.dirty?.()) {
    const go = await confirmDialog({ title: 'Leave without saving?', body: 'This machine has unsaved changes. They will be lost.', ok: 'Leave', danger: true });
    if (!go) { history.replaceState(null, '', lastHash); return; }
  }
  if (leavingMachine) { forgetMachine(); state.dirty = null; }
  lastHash = location.hash;
  route();
});
window.addEventListener('beforeunload', e => { if (state.dirty?.()) { e.preventDefault(); e.returnValue = ''; } });

async function route() {
  const [, section, slug, tab] = (location.hash || '#/').split('/');
  drawSidebar();
  try {
    if (section === 'm' && slug) await showMachine(main, decodeURIComponent(slug), tab || 'details', { refreshSidebar });
    else if (section === 'publish') await showPublish(main, { refreshSidebar });
    else showDashboard(main, { refreshSidebar });
    main.scrollTop = 0;
  } catch (e) {
    fill(main, h('div.pad', h('p.warn-box', e.status === 404 ? `There's no machine "${slug}".` : e.message), h('a.btn', { href: '#/' }, 'Back to the workbench')));
  }
}

// ---------------------------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------------------------

function drawSidebar() {
  if (!state.overview) return;
  const current = location.hash.split('/')[2];
  const changed = state.git?.available ? state.git.files.length : 0;
  const ahead = state.git?.ahead || 0;
  const machines = [...state.overview.machines]
    .sort((a, b) => a.title.localeCompare(b.title))
    .filter(m => !filter || `${m.title} ${m.nickname} ${m.slug}`.toLowerCase().includes(filter));
  const search = h('input.side-search', { type: 'search', placeholder: 'Find a machine…', value: filter, oninput: e => { filter = e.target.value.toLowerCase(); drawSidebar(); sidebar.querySelector('.side-search').focus(); } });

  fill(sidebar, 
    h('div.brand', h('a', { href: '#/' }, 'Typewriter CMS')),
    h('nav.side-nav',
      h('a' + (!location.hash || location.hash === '#/' ? '.active' : ''), { href: '#/' }, 'Workbench'),
      h('a' + (location.hash.startsWith('#/publish') ? '.active' : ''), { href: '#/publish' }, 'Publish', changed || ahead ? h('span.count.accent', { title: `${plural(changed, 'changed file')}${ahead ? `, ${plural(ahead, 'unpublished commit')}` : ''}` }, changed || `↑${ahead}`) : null)),
    h('div.side-head', h('span', 'Machines'), h('button.mini', { type: 'button', onclick: () => newMachine() }, '+ New')),
    search,
    h('div.machine-list', machines.map(m => h('a.machine-link' + (m.slug === current ? '.active' : ''), { href: `#/m/${m.slug}/${location.hash.split('/')[3] && m.slug !== current ? location.hash.split('/')[3] : 'details'}`, title: m.slug },
      h('span.ml-title', m.title, m.nickname ? h('span.ml-nick', ` “${m.nickname}”`) : null),
      m.error ? h('span.count.error', { title: m.error }, '!') : m.openIssues ? h('span.count', { title: plural(m.openIssues, 'open issue') }, m.openIssues) : null,
      m.status && m.status !== 'collection' ? h('span.ml-status', m.status) : null))),
    previewBox);
}

// ---------------------------------------------------------------------------------------------
// Preview (Jekyll, started by the CMS)
// ---------------------------------------------------------------------------------------------

const previewBox = h('div.preview-box');
let previewState = null;
async function pollPreview() {
  try { previewState = await api('GET', '/api/preview'); } catch { previewState = null; }
  drawPreview();
  setTimeout(pollPreview, previewState?.status === 'starting' ? 1500 : 5000);
}
function drawPreview() {
  const p = previewState;
  const status = p?.status || 'unknown';
  const label = { running: 'Preview running', starting: 'Preview starting…', stopped: 'Preview stopped', stopping: 'Stopping…', failed: 'Preview failed' }[status] || 'Preview';
  fill(previewBox, 
    h('div.preview-line', h('span.dot.' + status), h('span', label)),
    h('div.preview-actions',
      status === 'running' ? h('a.mini', { href: p.url, target: '_blank', rel: 'noopener' }, 'Open site ↗') : null,
      status === 'running' || status === 'starting'
        ? h('button.mini', { type: 'button', onclick: async () => { previewState = await api('POST', '/api/preview/stop'); drawPreview(); } }, 'Stop')
        : h('button.mini', { type: 'button', onclick: async () => { previewState = await api('POST', '/api/preview/start'); drawPreview(); } }, 'Start'),
      p?.log ? h('details.preview-log', h('summary', 'Log'), h('pre', p.log)) : null));
}

boot();
