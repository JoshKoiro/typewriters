/**
 * Format-preserving YAML editing for the machine files.
 *
 * WHY THIS EXISTS
 * The machine files are hand-edited YAML: inline comments (`status: collection # collection | ...`),
 * `>-` folded text wrapped by hand, quoted vs. plain strings, blank lines between list items, a fixed
 * key order from the template. Loading the YAML into an object and writing it back out with a library
 * would re-wrap every paragraph, move or drop comments and restyle values that were never touched.
 * The requirement for the CMS is that files keep EXACTLY the format they have, with only the edited
 * values changing, so a git diff of a CMS save looks like a careful hand edit.
 *
 * HOW
 * `yaml` (already a dependency) parses the original text and records the byte offsets of every node
 * (`node.range = [start, valueEnd, nodeEnd]`). We compare the parsed values with the new values from
 * the form and, only where they differ, splice freshly rendered text into the ORIGINAL string at
 * those offsets. Everything else is copied through byte for byte.
 *
 *   - scalars:      only the value text is replaced; a trailing `# comment` stays in its column
 *   - flow lists:   `tags: [a, b]` is re-rendered as one unit
 *   - block lists of maps (issues, repairs): matched item by item using `_index` (the item's position
 *                   in the file when it was loaded, sent back by the editor). Changed fields are patched
 *                   inside the item, removed items are cut out, new items are inserted in place.
 *   - anything awkward (e.g. removing the first key of a list item, which sits on the `- ` line) falls
 *     back to re-rendering just that one item.
 *
 * SAFETY NET
 * After patching, the result is parsed again and compared with what the form asked for. If they differ
 * (a bug here, or a value that can't be expressed in place) we throw and nothing is written.
 *
 * SCHEMA
 * The renderer needs to know what kind of value each key holds (see cms/config.mjs):
 *   quoted   always "double quoted" when written new (text fields in the template: title: "")
 *   string   plain when safe, quoted when YAML would misread it (yes, 1e3, a: b ...)
 *   long     multi-line prose (description, resolution, work): written as `>-` folded text
 *   number, boolean, date (YYYY-MM-DD, written unquoted so Jekyll reads it as a date)
 *   flowList `[a, b]` lists of short strings (tags, features, related)
 *   issueRef a repair's `issue:`; one id is written plain, several as a flow list
 *   items    block list of maps, with `item: { fields: [...] }`
 * Existing values keep their original quoting style regardless of kind.
 */
import YAML from 'yaml';

const WRAP_AT = 110; // column to wrap folded text at; matches how the existing files were hand-wrapped

class Fallback extends Error {} // "can't patch this item in place, re-render the whole item"

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

/**
 * Apply `next` (top-level key -> new value) to the YAML text `src` and return the new text.
 * Keys not mentioned in `next` are left untouched. Top-level keys are never removed: clearing a
 * value leaves `key:` (or `key: ""`) in place, the way the template has them.
 */
export function patchYaml(src, next, schema) {
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const text = eol === '\n' ? src : src.replace(/\r\n/g, '\n');
  const doc = YAML.parseDocument(text);
  if (doc.errors.length) throw new Error(`The existing YAML has errors, fix it by hand first: ${doc.errors[0].message}`);
  if (doc.contents && !YAML.isMap(doc.contents)) throw new Error('Front matter is not a key: value map');

  const ctx = { src: text, edits: [], seq: 0 };
  if (!doc.contents) {
    // Empty front matter: just render every key
    ctx.edits.push({ start: 0, end: text.length, text: Object.entries(next).map(([k, v]) => renderPair(k, v, fieldFor(schema, k), 0)).join(''), seq: 0 });
  } else {
    patchMap(ctx, doc.contents, next, schema, { topLevel: true });
  }
  let out = applyEdits(text, ctx.edits);

  // ---- Safety net: the patched text must parse back to exactly what was asked for ----
  const check = YAML.parseDocument(out);
  if (check.errors.length) throw new Error(`Internal error: the edited YAML doesn't parse (${check.errors[0].message}). Nothing was saved.`);
  const expected = { ...(doc.toJS() || {}), ...stripIndexes(next) };
  const got = check.toJS() || {};
  const a = normalize(expected, schema), b = normalize(got, schema);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    const key = Object.keys({ ...a, ...b }).find(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    throw new Error(`Internal error: the edited YAML wouldn't match the form (field "${key}"). Nothing was saved.`);
  }
  return eol === '\n' ? out : out.replace(/\n/g, '\r\n');
}

/** Render a complete new list item (used by the editor for previews and by fallbacks). */
export { renderItem };

/**
 * Normalise prose before saving: unify line endings, trim each line, trim the whole thing.
 * Leading spaces would turn a folded-text line into a "more indented" literal line, so they go.
 */
export const normalizeLongText = s => String(s ?? '').replace(/\r\n?/g, '\n').split('\n').map(l => l.trim()).join('\n').replace(/^\n+|\n+$/g, '');

// ---------------------------------------------------------------------------------------------
// Patching
// ---------------------------------------------------------------------------------------------

function patchMap(ctx, map, next, schema, { topLevel = false, itemIndent = 0 } = {}) {
  const fields = schema.fields || [];
  const order = [...fields.map(f => f.key), ...Object.keys(next).filter(k => !fields.some(f => f.key === k))];

  for (const key of order) {
    if (!(key in next) || key === '_index') continue;
    const f = fieldFor(schema, key);
    const val = next[key];
    const pair = map.items.find(p => scalarValue(p.key) === key);

    if (pair) {
      const old = pair.value == null ? null : (YAML.isNode(pair.value) ? pair.value.toJSON() : pair.value);
      if (f.kind !== 'items' && same(old, val, f)) continue;
      if (isEmpty(val) && !topLevel && !f.required) { deletePair(ctx, map, pair); continue; }
      if (f.kind === 'items') patchItems(ctx, pair, val || [], f.item, keyColumn(ctx, pair));
      else replaceValue(ctx, pair, renderValue(val, f, keyColumn(ctx, pair) + 2, pair.value?.type));
    } else {
      if (isEmpty(val)) continue;
      insertPair(ctx, map, key, val, f, order, topLevel, itemIndent);
    }
  }
}

function patchItems(ctx, pair, nextItems, itemSchema, keyCol) {
  const node = pair.value;
  const isBlockSeq = YAML.isSeq(node) && !node.flow && node.items.length > 0;
  const indexes = nextItems.map(it => it?._index).filter(i => Number.isInteger(i));
  const inOrder = indexes.every((v, i) => i === 0 || v > indexes[i - 1]);

  if (!nextItems.length) {
    if (YAML.isSeq(node) && node.flow && node.items.length === 0) return; // already []
    replaceValue(ctx, pair, { inline: '[]' });
    return;
  }

  const itemCol = keyCol + 2;
  if (!isBlockSeq || !inOrder) {
    // Empty `[]`, a flow list, or the editor reordered items: render the list fresh.
    const sep = isBlockSeq && hasBlankSeparators(ctx, node) ? '\n' : '';
    const prev = isBlockSeq ? node.items.map(n => n.toJSON()) : [];
    replaceValue(ctx, pair, {
      block: '\n' + nextItems.map(it => {
        const old = Number.isInteger(it._index) ? prev[it._index] : null;
        return old && same(old, it, { kind: 'item' }) ? ctx.src.slice(itemStart(ctx, node.items[it._index]), itemEnd(ctx, node.items[it._index])) : renderItem(it, itemSchema, itemCol);
      }).join(sep),
    });
    return;
  }

  const existing = node.items;
  const kept = new Set(indexes);
  const blank = hasBlankSeparators(ctx, node);
  const sep = blank ? '\n' : '';

  // Removed items
  existing.forEach((item, i) => {
    if (kept.has(i)) return;
    const isLast = i === existing.length - 1;
    const start = isLast && i > 0 ? itemEnd(ctx, existing[i - 1]) : itemStart(ctx, item);
    const end = isLast ? itemEnd(ctx, item) : itemStart(ctx, existing[i + 1]);
    addEdit(ctx, start, end, '');
  });

  // Changed and new items, in order
  let lastExisting = -1;
  let pendingBefore = []; // new items that come before the first kept item
  for (const it of nextItems) {
    if (Number.isInteger(it._index)) {
      const item = existing[it._index];
      if (!item) throw new Error(`List item ${it._index} no longer exists in the file; reload and try again.`);
      if (pendingBefore.length) {
        addEdit(ctx, itemStart(ctx, item), itemStart(ctx, item), pendingBefore.map(n => renderItem(n, itemSchema, itemCol) + sep).join(''));
        pendingBefore = [];
      }
      if (!same(item.toJSON(), it, { kind: 'item' })) {
        const before = ctx.edits.length;
        try {
          patchMap(ctx, item, it, itemSchema, { itemIndent: itemCol });
        } catch (e) {
          if (!(e instanceof Fallback)) throw e;
          ctx.edits.length = before; // undo partial edits for this item and re-render it whole
          addEdit(ctx, itemStart(ctx, item), itemEnd(ctx, item), renderItem(it, itemSchema, itemCol));
        }
      }
      lastExisting = it._index;
    } else if (lastExisting === -1) {
      pendingBefore.push(it);
    } else {
      const at = itemEnd(ctx, existing[lastExisting]);
      addEdit(ctx, at, at, sep + renderItem(it, itemSchema, itemCol));
    }
  }
  if (pendingBefore.length) {
    // Every existing item was removed and only new ones remain: append after the last item's end
    const at = itemEnd(ctx, existing[existing.length - 1]);
    addEdit(ctx, at, at, pendingBefore.map(n => sep + renderItem(n, itemSchema, itemCol)).join(''));
  }
}

/** Replace a pair's value. `rendered` is { inline: 'text' } or { block: '>-\n  ...\n' / '\n  - ...' }. */
function replaceValue(ctx, pair, rendered) {
  const { src } = ctx;
  const colon = colonAfterKey(ctx, pair);
  const node = pair.value;
  const nodeIsBlock = node && ((YAML.isScalar(node) && /^BLOCK/.test(node.type)) || ((YAML.isSeq(node) || YAML.isMap(node)) && !node.flow));

  if (rendered.inline !== undefined && !nodeIsBlock) {
    // Inline -> inline: replace just the value text, keep a trailing comment in its column
    let end = node ? node.range[1] : colon + 1;
    let region = rendered.inline === '' ? '' : ' ' + rendered.inline;
    const comment = src.slice(end, lineEnd(src, end)).match(/^([ \t]*)#/);
    if (comment) {
      // Include the spaces before the comment in the region, then pad back to the same width, so
      // the comment stays in its column (or sits one space after the value if the value grew past it).
      end += comment[1].length;
      const oldWidth = end - (colon + 1);
      region = region.padEnd(oldWidth);
      if (!/\s$/.test(region)) region += ' ';
    }
    addEdit(ctx, colon + 1, end, region);
    return;
  }

  // Anything involving a multi-line value: replace from after the colon to the end of the old value
  const end = nodeIsBlock ? contentEnd(src, node.range[0], node.range[2]) : lineEnd(src, colon) + 1;
  let text;
  if (rendered.inline !== undefined) text = (rendered.inline === '' ? '' : ' ' + rendered.inline) + '\n';
  else text = (rendered.block.startsWith('\n') ? '' : ' ') + rendered.block;
  addEdit(ctx, colon + 1, end, text);
}

function deletePair(ctx, map, pair) {
  if (map.items[0] === pair && isOnDashLine(ctx, pair)) throw new Fallback();
  const start = lineStart(ctx.src, pair.key.range[0]);
  const end = pair.value ? contentEnd(ctx.src, pair.key.range[0], pair.value.range[2]) : lineEnd(ctx.src, start) + 1;
  addEdit(ctx, start, end, '');
}

function insertPair(ctx, map, key, val, f, order, topLevel, itemIndent) {
  // Put the new key before the next key (in schema order) that exists in the file, else after the last key
  const after = order.slice(order.indexOf(key) + 1);
  const nextPair = after.map(k => map.items.find(p => scalarValue(p.key) === k)).find(Boolean);
  const col = map.items.length ? keyColumn(ctx, map.items[map.items.length - 1]) : (topLevel ? 0 : itemIndent);
  let text = renderPair(key, val, f, col);
  if (nextPair) {
    if (isOnDashLine(ctx, nextPair)) throw new Fallback(); // can't insert above the "- " line
    const at = lineStart(ctx.src, nextPair.key.range[0]);
    // A multi-line block added at the top level gets the same blank line before the next key that the
    // template uses between sections ("cover: ...\n\nrepairs:")
    if (topLevel && text.split('\n').length > 2 && ctx.src.slice(at - 2, at) === '\n\n') text += '\n';
    addEdit(ctx, at, at, text);
  } else {
    const last = map.items[map.items.length - 1];
    const at = contentEnd(ctx.src, last.key.range[0], last.value ? last.value.range[2] : last.key.range[2]);
    addEdit(ctx, at, at, text);
  }
}

// ---------------------------------------------------------------------------------------------
// Rendering new text
// ---------------------------------------------------------------------------------------------

/** Render a value for `key: <here>`. `col` is the column folded text lines are indented to. */
function renderValue(val, f, col, originalStyle) {
  const kind = f.kind || guessKind(val);
  const empty = isEmpty(val);
  switch (kind) {
    case 'number': return { inline: empty ? '' : String(Number(val)) };
    case 'boolean': return { inline: val === true ? 'true' : val === false ? 'false' : '' };
    case 'date': return { inline: empty ? '' : /^\d{4}-\d{2}-\d{2}$/.test(String(val)) ? String(val) : plainOrQuoted(String(val)) };
    case 'flowList': return { inline: flowList(val) };
    case 'issueRef': {
      const ids = [].concat(val ?? []).filter(Boolean);
      return { inline: ids.length === 0 ? '' : ids.length === 1 ? plainOrQuoted(String(ids[0])) : flowList(ids) };
    }
    case 'items': return { block: '\n' + (val || []).map(it => renderItem(it, f.item, col)).join('') };
    case 'long': {
      const s = String(val ?? '');
      if (!s) return { inline: originalStyle === 'QUOTE_DOUBLE' ? '""' : '' };
      // Keep a short value inline if it was written inline; otherwise use `>-` like the rest of the file
      if (originalStyle && !/^BLOCK/.test(originalStyle) && !s.includes('\n') && s.length < 70) return { inline: styled(s, originalStyle) };
      return { block: folded(s, col) };
    }
    default: { // quoted | string
      const s = String(val ?? '');
      if (s.includes('\n')) return { block: folded(s, col) };
      if (originalStyle && originalStyle !== 'PLAIN') return { inline: styled(s, originalStyle) };
      if (!s) return { inline: kind === 'quoted' && !originalStyle ? '""' : '' };
      return { inline: kind === 'quoted' && !originalStyle ? JSON.stringify(s) : plainOrQuoted(s) };
    }
  }
}

function renderPair(key, val, f, col) {
  const r = renderValue(val, f, col + 2);
  if (r.inline !== undefined) return `${' '.repeat(col)}${key}:${r.inline === '' ? '' : ' ' + r.inline}\n`;
  return `${' '.repeat(col)}${key}:${r.block.startsWith('\n') ? '' : ' '}${r.block}`;
}

/** A whole list item: "- first: ...\n  second: ...\n", with the dash at column `col`. */
function renderItem(obj, itemSchema, col) {
  const fields = itemSchema.fields;
  const keys = [...fields.map(f => f.key), ...Object.keys(obj).filter(k => k !== '_index' && !fields.some(f => f.key === k))];
  const lines = keys
    .filter(k => k in obj && (!isEmpty(obj[k]) || fieldFor(itemSchema, k).required))
    .map(k => renderPair(k, obj[k], fieldFor(itemSchema, k), col + 2));
  if (!lines.length) throw new Error('Cannot write an empty list item');
  lines[0] = ' '.repeat(col) + '- ' + lines[0].slice(col + 2);
  return lines.join('');
}

/** `>-` folded text, wrapped at WRAP_AT, paragraphs separated by blank lines. */
function folded(s, col) {
  const pad = ' '.repeat(col);
  const width = Math.max(40, WRAP_AT - col);
  const out = [];
  normalizeLongText(s).split('\n').forEach((para, i) => {
    if (i > 0) out.push(''); // a blank line in folded text = one newline in the value
    // Only break at single spaces: a line can't start with a space, and double spaces must survive
    const words = para.split(/(?<! ) (?! )/);
    let line = '';
    for (const w of words) {
      if (line && line.length + 1 + w.length > width) { out.push(line); line = w; }
      else line = line ? line + ' ' + w : w;
    }
    if (line) out.push(line);
  });
  return '>-\n' + out.map(l => (l ? pad + l : '')).join('\n') + '\n';
}

function styled(s, style) {
  if (style === 'QUOTE_DOUBLE') return JSON.stringify(s); // JSON strings are valid YAML double-quoted scalars
  if (style === 'QUOTE_SINGLE') return `'${s.replace(/'/g, "''")}'`;
  return plainOrQuoted(s);
}

/**
 * Plain if YAML would read it back as the same string, otherwise quoted. Checked against YAML 1.1
 * because that's what Jekyll (Ruby's Psych) uses: there `yes`, `on`, `no` are booleans.
 */
function plainOrQuoted(s) {
  if (s === '') return '""';
  const out = YAML.stringify(s, { version: '1.1', lineWidth: 0 }).replace(/\n$/, '');
  if (out.includes('\n')) return JSON.stringify(s);
  return out;
}

function flowList(arr) {
  const items = [].concat(arr ?? []).map(String).filter(s => s !== '');
  return '[' + items.map(s => { const p = plainOrQuoted(s); return /^["']/.test(p) || !/[,\[\]{}#]/.test(p) ? p : JSON.stringify(s); }).join(', ') + ']';
}

// ---------------------------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------------------------

const lineStart = (src, pos) => src.lastIndexOf('\n', pos - 1) + 1;
const lineEnd = (src, pos) => { const i = src.indexOf('\n', pos); return i === -1 ? src.length : i; };
/** End of the last non-blank line within [start, end), including its newline. Skips trailing blank lines. */
function contentEnd(src, start, end) {
  const chunk = src.slice(start, end).replace(/\s+$/, '');
  const pos = start + chunk.length;
  const nl = src.indexOf('\n', pos);
  return nl === -1 ? src.length : nl + 1;
}
const keyColumn = (ctx, pair) => pair.key.range[0] - lineStart(ctx.src, pair.key.range[0]);
function colonAfterKey(ctx, pair) {
  const i = ctx.src.indexOf(':', pair.key.range[1]);
  if (i === -1) throw new Error('Could not find the ":" after a key');
  return i;
}
const itemStart = (ctx, item) => lineStart(ctx.src, item.range[0]);
const itemEnd = (ctx, item) => contentEnd(ctx.src, item.range[0], item.range[2]);
const isOnDashLine = (ctx, pair) => /-\s*$/.test(ctx.src.slice(lineStart(ctx.src, pair.key.range[0]), pair.key.range[0]));
function hasBlankSeparators(ctx, seq) {
  if (seq.items.length < 2) return false;
  return /\n[ \t]*\n/.test(ctx.src.slice(itemEnd(ctx, seq.items[0]) - 1, itemStart(ctx, seq.items[1]) + 1));
}

function addEdit(ctx, start, end, text) { ctx.edits.push({ start, end, text, seq: ctx.seq++ }); }

function applyEdits(src, edits) {
  // Apply from the end of the file backwards so earlier offsets stay valid. Several inserts at the same
  // position keep the order they were added in.
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end || b.seq - a.seq);
  let out = src;
  let floor = Infinity;
  for (const e of sorted) {
    if (e.end > floor) throw new Error('Internal error: overlapping edits. Nothing was saved.');
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    floor = e.start;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------

function fieldFor(schema, key) {
  return (schema.fields || []).find(f => f.key === key) || { key, kind: undefined };
}
function guessKind(v) {
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (Array.isArray(v)) return v.some(x => x && typeof x === 'object') ? 'items' : 'flowList';
  return 'string';
}
const scalarValue = n => (YAML.isScalar(n) ? n.value : n);
const isEmpty = v => v == null || v === '' || (Array.isArray(v) && v.length === 0);

function stripIndexes(v) {
  if (Array.isArray(v)) return v.map(stripIndexes);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (k !== '_index') o[k] = stripIndexes(x);
    return o;
  }
  return v;
}

/**
 * Comparable form of a value: empty-ish values become null, null keys inside list items are dropped
 * (an optional field that's absent and one that's blank mean the same), booleans false ≈ blank,
 * one-element issue refs ≈ the plain id.
 */
function normalize(v, schema) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.map(x => normalize(x, schema?.item || {}));
  if (typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) {
      if (k === '_index') continue;
      const f = fieldFor(schema || {}, k);
      let x = v[k];
      if (f.kind === 'boolean' && x === false) x = null;
      if (f.kind === 'issueRef' && Array.isArray(x) && x.length === 1) x = x[0];
      if (f.kind === 'number' && x !== null && x !== '' && x !== undefined) x = Number(x);
      if (f.kind === 'date' && x) x = String(x);
      x = normalize(x, f.kind === 'items' ? f.item : f.item || {});
      if (x !== null) o[k] = x;
    }
    return o;
  }
  return v;
}

function same(a, b, f) {
  if (f.kind === 'item') return JSON.stringify(normalize(stripIndexes(a), {})) === JSON.stringify(normalize(stripIndexes(b), {}));
  const wrap = x => normalize({ v: x }, { fields: [{ ...f, key: 'v' }] }).v ?? null; // key last: f's own key must not win
  return JSON.stringify(wrap(a)) === JSON.stringify(wrap(b));
}
