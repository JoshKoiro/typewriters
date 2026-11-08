/**
 * Form fields built from the schema in cms/config.mjs. One function per `input` type.
 *
 * field(f, value, set, ctx) returns a labelled element; `set(newValue)` is called on every change.
 * ctx: { problems: Map(path -> [{level,msg}]), path: 'issues.0', issues: [...], photoNames: [...] }
 * Select options come from the _data files (state.schema.options), so adding a status or category
 * there shows up here without code changes.
 */
import { h, state, optionsFor } from './core.mjs';

let uid = 0;

export function field(f, value, set, ctx = {}) {
  const id = `f${++uid}`;
  const path = ctx.path ? `${ctx.path}.${f.key}` : f.key;
  const probs = ctx.problems?.get(path) || [];
  const input = (INPUTS[f.input] || INPUTS.text)(f, value, set, id, ctx);
  const wrapClass = 'field' + (f.input === 'checkbox' ? '.check' : '') + (f.input === 'textarea' ? '.full' : '') + (probs.some(p => p.level === 'FAIL') ? '.has-error' : probs.length ? '.has-warn' : '');
  if (f.input === 'checkbox') {
    return h('div.' + wrapClass, h('label', { for: id }, input, h('span', f.label)), msgs(probs, f.help));
  }
  return h('div.' + wrapClass, { dataset: { path } },
    h('label', { for: id }, f.label, f.required ? h('span.req', { title: 'Required' }, ' *') : null),
    input,
    msgs(probs, f.help));
}

function msgs(probs, help) {
  return [
    ...probs.map(p => h('p.msg.' + (p.level === 'FAIL' ? 'error' : 'warn'), p.msg)),
    help ? h('p.help', help) : null,
  ];
}

const datalist = (id, values) => (values?.length ? h('datalist', { id: id + '-list' }, values.map(v => h('option', { value: v }))) : null);

const INPUTS = {
  text(f, v, set, id) {
    const sugg = f.suggest ? state.schema.suggestions[f.key] : null;
    return h('span.input-wrap',
      h('input', { id, type: 'text', value: v ?? '', list: sugg?.length ? id + '-list' : null, oninput: e => set(e.target.value) }),
      datalist(id, sugg));
  },
  url(f, v, set, id) {
    const link = h('a.icon-link', { href: v || '#', target: '_blank', rel: 'noopener', title: 'Open link', hidden: !v }, '↗');
    return h('span.input-wrap.with-btn',
      h('input', { id, type: 'url', value: v ?? '', placeholder: 'https://…', oninput: e => { set(e.target.value); link.href = e.target.value || '#'; link.hidden = !e.target.value; } }),
      link);
  },
  number(f, v, set, id) {
    return h('input', { id, type: 'number', value: v ?? '', step: 'any', oninput: e => set(e.target.value === '' ? null : Number(e.target.value)) });
  },
  checkbox(f, v, set, id) {
    return h('input', { id, type: 'checkbox', checked: v === true, onchange: e => set(e.target.checked) });
  },
  date(f, v, set, id) {
    return h('span.input-wrap.with-btn',
      h('input', { id, type: 'date', value: v ?? '', oninput: e => set(e.target.value || null) }),
      h('button.mini', { type: 'button', title: 'Today', onclick: e => { const i = e.target.previousSibling; i.value = state.schema.today; set(i.value); } }, 'Today'));
  },
  select(f, v, set, id) {
    const opts = optionsFor(f).filter(o => !(f.exclude || []).includes(o.key)); // `exclude`: hide some values (e.g. "open" when closing an issue)
    const known = opts.some(o => o.key === v);
    return h('select', { id, value: v ?? '', onchange: e => set(e.target.value) },
      h('option', { value: '' }, f.required ? 'Choose…' : '—'),
      opts.map(o => h('option', { value: o.key }, `${o.icon ? o.icon + ' ' : ''}${o.label}`)),
      v && !known ? h('option', { value: v }, `${v} (not in the data file)`) : null);
  },
  textarea(f, v, set, id) {
    const ta = h('textarea', { id, value: v ?? '', rows: 3, oninput: e => { set(e.target.value); grow(e.target); } });
    requestAnimationFrame(() => grow(ta));
    return ta;
  },
  rating(f, v, set, id) {
    const wrap = h('span.rating', { id, role: 'radiogroup' });
    const draw = val => wrap.replaceChildren(
      ...[1, 2, 3, 4, 5].map(n => h('button.dot' + (val >= n ? '.on' : ''), { type: 'button', title: `${n} of 5`, onclick: () => { set(n); draw(n); } }, '●')),
      h('button.mini', { type: 'button', onclick: () => { set(null); draw(null); }, hidden: !val }, 'Clear'));
    draw(v);
    return wrap;
  },
  tags(f, v, set, id, ctx) {
    let list = [].concat(v ?? []).filter(Boolean);
    const sugg = f.key === 'related' ? (ctx.issues || []).map(i => i.id).filter(x => x && x !== ctx.selfId) : f.suggest ? state.schema.suggestions[f.key] : null;
    const chips = h('span.chips');
    const input = h('input', { id, type: 'text', placeholder: 'Add…', list: sugg?.length ? id + '-list' : null });
    const draw = () => chips.replaceChildren(...list.map((t, i) => h('span.chip', t, h('button', { type: 'button', title: 'Remove', onclick: () => { list.splice(i, 1); set([...list]); draw(); } }, '×'))));
    const add = () => {
      const vals = input.value.split(',').map(s => s.trim()).filter(Boolean);
      if (!vals.length) return;
      for (const t of vals) if (!list.includes(t)) list.push(t);
      input.value = '';
      set([...list]);
      draw();
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } else if (e.key === 'Backspace' && !input.value && list.length) { list.pop(); set([...list]); draw(); } });
    input.addEventListener('change', add); // picking from the datalist
    input.addEventListener('blur', add);
    draw();
    return h('span.tags-input', { onclick: () => input.focus() }, chips, input, datalist(id, sugg));
  },
  'photo-shot'(f, v, set, id, ctx) {
    const names = ctx.photoNames || [];
    return h('select', { id, value: v ?? '', onchange: e => set(e.target.value) },
      h('option', { value: '' }, 'First photo (default)'),
      names.map(n => h('option', { value: n }, n)),
      v && !names.includes(v) ? h('option', { value: v }, `${v} (no such photo)`) : null);
  },
  'issue-ref'(f, v, set, id, ctx) {
    // One issue (or "general" work). Several issues per repair are allowed in the file format, and
    // shown here as a read-only note so they aren't lost: edit those by hand.
    const ids = [].concat(v ?? []).filter(Boolean);
    if (ids.length > 1) return h('p.note', { id }, `This repair is for several issues: ${ids.join(', ')}. Edit that in the file.`);
    return h('select', { id, value: ids[0] || '', onchange: e => set(e.target.value) },
      h('option', { value: '' }, 'General work (no issue)'),
      (ctx.issues || []).map(i => h('option', { value: i.id }, `${i.title || i.id}${i.status && i.status !== 'open' ? ` (${i.status})` : ''}`)));
  },
};

export function grow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight + 2, 560) + 'px';
}

/** Problems from the server as Map(path -> [problem]). */
export function problemMap(problems = []) {
  const m = new Map();
  for (const p of problems) {
    if (!p.path) continue;
    if (!m.has(p.path)) m.set(p.path, []);
    m.get(p.path).push(p);
  }
  return m;
}
