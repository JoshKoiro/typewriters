/**
 * Shared editor plumbing: API calls, a tiny DOM builder, dialogs, toasts and app state.
 * No framework and no build step on purpose: the repo has no front-end toolchain, and this keeps the
 * editor something you can read and change in place.
 */

// ---------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------

/**
 * Call the CMS server. Every state-changing request carries X-CMS: 1 (the server rejects it otherwise:
 * see SECURITY in cms/server.mjs). Errors throw with .status and the server's JSON in .data.
 */
export async function api(method, url, body, { raw = false } = {}) {
  const opts = { method, headers: {} };
  if (method !== 'GET') opts.headers['X-CMS'] = '1';
  if (raw) opts.body = body;
  else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `${res.status} ${res.statusText}`), { status: res.status, data });
  return data;
}

// ---------------------------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------------------------

/**
 * h('div.card.wide', { onclick, title, dataset: {...}, style: '...' }, child, [children], 'text')
 * Children can be nodes, strings, arrays, or null/false (skipped).
 */
export function h(sel, attrs, ...children) {
  if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) { children.unshift(attrs); attrs = {}; }
  const [tag, ...classes] = sel.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  let value; // applied after the children: a <select>'s value only sticks once its <option>s exist
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'value') { value = v; continue; }
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'class') el.className += ' ' + v;
    else if (['value', 'checked', 'selected', 'disabled', 'innerHTML', 'textContent'].includes(k)) el[k] = v; // properties, not attributes (a textarea ignores value="")
    else if (k in el && !['list', 'form', 'type'].includes(k) && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  if (value !== undefined) el.value = value ?? '';
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const clear = el => { el.replaceChildren(); return el; };
/** Replace an element's children, skipping null/false (DOM append() would print them as "null"). */
export const fill = (el, ...children) => { el.replaceChildren(); append(el, children); return el; };
export const fmtDate = d => {
  if (!d) return '';
  const [y, m, day] = String(d).split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const slugify = s => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

// ---------------------------------------------------------------------------------------------
// Toasts and dialogs
// ---------------------------------------------------------------------------------------------

export function toast(message, kind = 'ok', ms = 3500) {
  const t = h('div.toast.' + kind, message);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}
export const toastError = e => toast(e.message || String(e), 'error', 7000);

/** A modal <dialog>. `build(close)` returns its content; resolves with whatever close() is given. */
export function modal(title, build, { wide = false } = {}) {
  return new Promise(resolve => {
    const dlg = h('dialog.modal' + (wide ? '.wide' : ''));
    const close = v => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.addEventListener('cancel', e => { e.preventDefault(); close(null); });
    dlg.append(h('header.modal-head', h('h2', title), h('button.icon-btn', { type: 'button', title: 'Close', onclick: () => close(null) }, '✕')), build(close));
    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector('[autofocus], input:not([type=checkbox]), textarea, select')?.focus();
  });
}

/** Yes/no confirmation. Resolves true/false. */
export function confirmDialog({ title, body, ok = 'OK', danger = false }) {
  return modal(title, close => h('div.modal-body',
    [].concat(body).map(p => (typeof p === 'string' ? h('p', p) : p)),
    h('footer.modal-foot',
      h('button.btn', { type: 'button', onclick: () => close(false) }, 'Cancel'),
      h('button.btn.' + (danger ? 'danger' : 'primary'), { type: 'button', autofocus: true, onclick: () => close(true) }, ok)),
  )).then(v => v === true);
}

// ---------------------------------------------------------------------------------------------
// App state shared by the views
// ---------------------------------------------------------------------------------------------

export const state = {
  schema: null,   // fields, dropdown options, suggestions, photo order, urls (GET /api/schema)
  overview: null, // machine list, open issues, recent repairs (GET /api/overview)
  git: null,      // changed files (GET /api/git)
  dirty: null,    // a function returning true while the open view has unsaved changes
};

/** Options for a select field: [{ key, label, icon, color }] from the _data file named in config.mjs. */
export const optionsFor = f => state.schema.options[f.options] || [];
export const optionInfo = (source, key) => (state.schema.options[source] || []).find(o => o.key === key);
