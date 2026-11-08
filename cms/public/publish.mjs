/**
 * The Publish page (#/publish): what changed, commit, check, publish.
 * Runs the same npm scripts as the command line (npm run check / npm run deploy), so the editor can't
 * publish anything the deploy check would refuse. Output streams in while a job runs.
 */
import { h, fill, api, clear, state, toast, toastError } from './core.mjs';

const KIND = { modified: 'M', new: '+', deleted: '−', renamed: 'R' };

export async function showPublish(main, { refreshSidebar, log = '' }) {
  const g = await api('GET', '/api/git');
  state.git = g;
  if (!g.available) {
    fill(main, h('header.page-head', h('h1', 'Publish')), h('p.warn-box', `git isn't available here: ${g.message}`));
    return;
  }

  const output = h('pre.job-output', { hidden: !log }, log); // `log`: output carried over from before a reload
  const diffBox = h('pre.diff', { hidden: true });
  const reload = () => showPublish(main, { refreshSidebar, log: output.textContent });

  /** Start an npm job and stream its output into the page. Resolves true if it succeeded. */
  async function runJob(name) {
    output.hidden = false;
    output.textContent = '';
    try {
      let job = await api('POST', `/api/jobs/${name}`);
      while (job.status === 'running') {
        output.textContent = job.out;
        output.scrollTop = output.scrollHeight;
        await new Promise(r => setTimeout(r, 700));
        job = await api('GET', `/api/jobs/${name}/${job.id}`);
      }
      output.textContent = job.out;
      output.scrollTop = output.scrollHeight;
      if (job.status !== 'ok') toast(`${job.label}: failed (see the output)`, 'error', 7000);
      return job.status === 'ok';
    } catch (e) { toastError(e); return false; }
  }

  // Suggested commit message from the machines that changed
  const changedSlugs = [...new Set(g.files.map(f => f.file.match(/^(?:_machines|originals|photos)\/([a-z0-9-]+?)(?:\.md)?(?:\/|$)/)?.[1]).filter(Boolean))];
  const names = changedSlugs.map(s => { const m = state.overview.machines.find(x => x.slug === s); return m?.nickname || m?.title || s; });
  const msg = h('input', { type: 'text', value: names.length ? `Update ${names.slice(0, 4).join(', ')}${names.length > 4 ? ' and more' : ''}` : '', placeholder: 'What changed, e.g. "Log Olivia feed roller repair"' });

  async function commit() {
    try { await api('POST', '/api/git/commit', { message: msg.value }); toast('Committed'); await refreshSidebar(); return true; }
    catch (e) { toastError(e); return false; }
  }
  async function publish() {
    const ok = await runJob('deploy');
    await refreshSidebar();
    if (ok) toast('Published. The live site updates in a minute or two.', 'ok', 7000);
    return ok;
  }

  fill(main, 
    h('header.page-head', h('div', h('p.eyebrow', `Branch ${g.branch}`), h('h1', 'Publish'))),
    h('p.lead', 'Publishing = commit your changes, then ', h('code', 'npm run deploy'), ', which runs every check (photos have no GPS data, issues are consistent, the site builds) and pushes to GitHub. The live site updates a minute or two later.'),

    h('h2.section-title', 'Changed files', h('span.muted', ` ${g.files.length}`)),
    g.files.length ? h('div.files', g.files.map(f => h('button.file', {
      type: 'button', title: 'Show the change',
      onclick: async () => {
        try {
          const d = await api('GET', `/api/git/diff?file=${encodeURIComponent(f.file)}`);
          diffBox.hidden = false;
          diffBox.replaceChildren(...colorDiff(d.diff || '(binary file or no text change)'));
          diffBox.scrollIntoView({ block: 'nearest' });
        } catch (e) { toastError(e); }
      },
    }, h('span.kind.' + f.kind, KIND[f.kind] || '?'), f.file))) : h('p.empty', 'Nothing changed since the last commit.'),
    diffBox,

    g.files.length ? h('div.commit-box',
      h('div.field', h('label', 'Commit message'), msg),
      h('div.toolbar',
        h('button.btn', { type: 'button', onclick: () => runJob('check') }, 'Run checks'),
        h('button.btn', { type: 'button', onclick: async () => { if (await commit()) reload(); } }, 'Commit'),
        h('button.btn.primary', { type: 'button', onclick: async () => { if (await commit()) { await publish(); reload(); } } }, 'Commit and publish'))) : null,

    g.ahead ? h('div.ahead-box',
      h('p', h('strong', `${g.ahead} commit${g.ahead === 1 ? '' : 's'}`), ' not published yet.'),
      h('button.btn.primary', { type: 'button', onclick: async () => { await publish(); reload(); } }, 'Publish now')) : null,
    output);
}

function colorDiff(text) {
  return text.split('\n').map(l => h('span.' + (l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : l.startsWith('@@') ? 'hunk' : 'ctx'), l + '\n'));
}
