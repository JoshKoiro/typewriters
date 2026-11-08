/**
 * The Photos tab: slots instead of free ordering.
 *
 * The site orders photos by NAME (scripts/photo-order.mjs), so each slot is a name: thumbnail, front,
 * side... Dropping a JPEG on the "side" slot saves it as originals/<slug>/side.jpg and runs
 * prep-photos for this machine. Variants (front-open) sit with their slot; anything else is an
 * "extra" and sorts alphabetically after the standard shots. Moving a photo between slots is a rename.
 *
 *   drop files on an empty slot    -> saved under the slot name (several files: slot, slot-2, slot-3...)
 *   drop files on a filled slot    -> asks: replace it, or add as a variant
 *   drop files on Extras           -> asks for a name for each
 *   drag a photo onto another slot -> rename (asks before replacing)
 *   ★ sets `cover:`, ✎ renames, 🗑 moves to the trash
 * Only JPEG is accepted (sharp can't read most phone HEIC files).
 */
import { h, fill, api, clear, state, toast, toastError, confirmDialog, modal, slugify } from './core.mjs';

const isJpeg = f => f.type === 'image/jpeg' || /\.jpe?g$/i.test(f.name);
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function renderPhotos(el, slug, ctx) {
  let list = null;
  const root = h('div.photos');
  el.append(root);

  const busy = h('div.busy', { hidden: true }, h('span.spinner'), h('span', 'Processing photos…'));
  const log = h('details.prep-log', { hidden: true }, h('summary', 'Last processing output'), h('pre'));

  async function load() {
    try { list = await api('GET', `/api/machines/${slug}/photos`); draw(); ctx.onChange?.(list); }
    catch (e) { toastError(e); }
  }

  /** Run a photo operation with the busy overlay, then redraw from the server's answer. */
  async function op(fn) {
    busy.hidden = false;
    try {
      const r = await fn();
      if (r?.photos) { list = r; ctx.onChange?.(list); }
      if (r?.prep?.out) {
        log.hidden = false;
        log.querySelector('pre').textContent = r.prep.out;
        if (r.prep.code !== 0 || /FAIL/.test(r.prep.out)) toast('Photo processing reported a problem; see the output below.', 'error', 7000);
      }
      draw();
      return r;
    } catch (e) {
      if (e.data?.needsRestore) draw();
      toastError(e);
      return null;
    } finally { busy.hidden = true; }
  }

  const has = name => list.photos.some(p => p.name === name);
  const nextFree = base => { let n = 2; while (has(`${base}-${n}`)) n++; return `${base}-${n}`; };

  async function upload(file, name, replace = false) {
    if (!isJpeg(file)) { toast(`${file.name}: only JPEG photos can be added. Export it as JPEG first.`, 'error', 7000); return null; }
    return op(() => api('PUT', `/api/machines/${slug}/photos/${encodeURIComponent(name)}${replace ? '?replace=1' : ''}`, file, { raw: true }));
  }

  // ---- Drop handlers ----
  async function dropOnSlot(slot, files) {
    files = [...files];
    if (!files.length) return;
    let start = 0;
    if (!has(slot)) {
      await upload(files[0], slot);
      start = 1;
    } else {
      const choice = await chooseReplaceOrVariant(slot, nextFree(slot));
      if (!choice) return;
      if (choice.replace) { await upload(files[0], slot, true); start = 1; }
      else { await upload(files[0], choice.name); start = 1; }
    }
    for (const f of files.slice(start)) await upload(f, nextFree(slot));
  }

  async function dropOnExtras(files) {
    for (const f of [...files]) {
      if (!isJpeg(f)) { toast(`${f.name}: only JPEG photos can be added.`, 'error', 7000); continue; }
      const name = await askName(`Name for ${f.name}`, suggestName(f.name), n => (has(n) ? `There is already a "${n}" photo.` : null));
      if (!name) continue;
      await upload(f, name);
    }
  }

  async function movePhoto(name, to) {
    if (name === to) return;
    let replace = false;
    if (has(to)) {
      replace = await confirmDialog({ title: `Replace “${to}”?`, body: `“${to}” already has a photo. It will be moved to the trash and “${name}” takes its place.`, ok: 'Replace', danger: true });
      if (!replace) return;
    }
    await op(() => api('POST', `/api/machines/${slug}/photos/${encodeURIComponent(name)}/rename`, { to, replace }));
  }

  // ---- Drawing ----
  function draw() {
    const labels = state.schema.photos.slotLabels || {};
    const bySlot = new Map(list.order.map(s => [s, []]));
    const extras = [];
    for (const p of list.photos) (p.slot ? bySlot.get(p.slot) : extras).push(p);
    const cover = list.cover || ctx.cover();
    const firstName = list.photos[0]?.name;

    fill(root, 
      h('div.photo-intro',
        h('p', 'Drop JPEG photos onto a slot. The order on the site follows the slots (from scripts/photo-order.mjs), then extras alphabetically. Drag a photo onto another slot to move it.'),
        h('button.btn.small', { type: 'button', onclick: () => op(() => api('POST', `/api/machines/${slug}/photos-prep`, { force: true })) }, 'Reprocess all')),
      list.webOnly ? h('div.warn-box',
        h('p', h('strong', `${list.webOnly} published photo(s) have no original on this computer`), ' (originals/ isn’t in git, so this happens on a fresh clone). Changing photos now would make the processing script delete them.'),
        h('button.btn.primary', { type: 'button', onclick: () => op(() => api('POST', `/api/machines/${slug}/photos-restore`, {})).then(r => r && toast(`Restored ${r.restored} original(s) from the published photos`)) }, 'Restore originals from published photos')) : null,
      h('div.slots', list.order.map(slot => {
        const photos = bySlot.get(slot);
        const main = photos.find(p => p.name === slot);
        const variants = photos.filter(p => p !== main);
        return h('section.slot' + (main ? '.filled' : ''),
          h('h3.slot-name', labels[slot] || cap(slot), h('code', slot)),
          main ? tile(main) : dropTarget(`Drop the ${labels[slot]?.toLowerCase() || slot} photo`, files => dropOnSlot(slot, files), name => movePhoto(name, slot)),
          variants.length ? h('div.variants', variants.map(tile)) : null);
      })),
      h('section.extras',
        h('h3.slot-name', 'Extras', h('span.muted', ' after the standard shots, A–Z')),
        h('div.extras-grid', extras.map(tile), dropTarget('Drop extra photos', files => dropOnExtras(files), async name => {
          const to = await askName(`Move “${name}” to extras as…`, name.replace(/^(thumbnail|front|side|back|top|bottom)-?/, '') || 'detail', n => (has(n) ? `There is already a "${n}" photo.` : null));
          if (to) await movePhoto(name, to);
        }))),
      busy, log);

    function tile(p) {
      const src = p.file ? `/media/originals/${slug}/${encodeURIComponent(p.file)}` : `/media/photos/${slug}/${encodeURIComponent(p.web)}`;
      const isCover = cover ? cover === p.name : p.name === firstName;
      const t = h('figure.tile' + (isCover ? '.cover' : ''), { draggable: !p.webOnly, title: p.webOnly ? 'Published copy only (no original here)' : 'Drag onto another slot to move it' },
        h('a', { href: src, target: '_blank', rel: 'noopener' }, h('img', { src: src + '?w=360', alt: p.name, loading: 'lazy' })),
        h('figcaption',
          h('span.tile-name', p.name),
          !p.web && !p.webOnly ? h('span.tag.warn', 'not processed') : null,
          p.webOnly ? h('span.tag.warn', 'no original') : null,
          !p.conventional ? h('span.tag.warn', { title: 'Not lowercase-with-hyphens; it sorts unpredictably. Rename it.' }, 'odd name') : null),
        h('div.tile-actions',
          h('button.icon-btn' + (isCover ? '.on' : ''), { type: 'button', title: isCover ? (cover ? 'Cover photo (click to use the default)' : 'Cover (the first photo, by default)') : 'Use as cover photo', onclick: () => ctx.setCover(isCover && cover ? '' : p.name) }, '★'),
          !p.webOnly ? h('button.icon-btn', { type: 'button', title: 'Rename', onclick: async () => { const to = await askName(`Rename “${p.name}”`, p.name, n => (n !== p.name && has(n) ? `There is already a "${n}" photo.` : null)); if (to) await movePhoto(p.name, to); } }, '✎') : null,
          h('button.icon-btn', { type: 'button', title: 'Move to trash', onclick: async () => {
            if (await confirmDialog({ title: `Move “${p.name}” to the trash?`, body: 'The original and its published copy move to the _trash folder. The other photos are renumbered.', ok: 'Move to trash', danger: true })) {
              await op(() => api('DELETE', `/api/machines/${slug}/photos/${encodeURIComponent(p.name)}`));
            }
          } }, '🗑')));
      t.addEventListener('dragstart', e => { e.dataTransfer.setData('application/x-photo', p.name); e.dataTransfer.effectAllowed = 'move'; });
      // Dropping onto a filled tile = dropping onto its slot (or onto extras for extra photos)
      t.addEventListener('dragover', e => { e.preventDefault(); t.classList.add('over'); });
      t.addEventListener('dragleave', () => t.classList.remove('over'));
      t.addEventListener('drop', e => {
        e.preventDefault(); e.stopPropagation(); t.classList.remove('over');
        const moving = e.dataTransfer.getData('application/x-photo');
        if (p.slot) {
          if (moving) movePhoto(moving, p.name === p.slot ? p.slot : p.name);
          else if (e.dataTransfer.files.length) (p.name === p.slot ? dropOnSlot(p.slot, e.dataTransfer.files) : replaceOne(p.name, e.dataTransfer.files[0]));
        } else if (e.dataTransfer.files.length) replaceOne(p.name, e.dataTransfer.files[0]);
      });
      return t;
    }
  }

  async function replaceOne(name, file) {
    if (await confirmDialog({ title: `Replace “${name}”?`, body: 'The current photo moves to the trash.', ok: 'Replace', danger: true })) await upload(file, name, true);
  }

  function dropTarget(label, onFiles, onPhoto) {
    const input = h('input', { type: 'file', accept: '.jpg,.jpeg,image/jpeg', multiple: true, hidden: true, onchange: e => { onFiles(e.target.files); e.target.value = ''; } });
    const z = h('div.drop', { tabindex: 0, role: 'button', onclick: () => input.click(), onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } } }, h('span', label), h('span.muted.small', 'or click to choose'), input);
    z.addEventListener('dragover', e => { e.preventDefault(); z.classList.add('over'); });
    z.addEventListener('dragleave', () => z.classList.remove('over'));
    z.addEventListener('drop', e => {
      e.preventDefault(); z.classList.remove('over');
      const moving = e.dataTransfer.getData('application/x-photo');
      if (moving) onPhoto(moving);
      else if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
    });
    return z;
  }

  // Dropping files anywhere else on the tab shouldn't navigate the browser to the image
  root.addEventListener('dragover', e => e.preventDefault());
  root.addEventListener('drop', e => e.preventDefault());

  load();
}

// ---------------------------------------------------------------------------------------------

const cap = s => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');

/** "IMG_1234 Platen Detail.JPG" -> "img-1234-platen-detail" (the same cleanup prep-photos does). */
const suggestName = file => slugify(file.replace(/\.[^.]+$/, '')) || 'photo';

function chooseReplaceOrVariant(slot, variantName) {
  return modal(`“${slot}” already has a photo`, close => {
    const input = h('input', { type: 'text', value: variantName });
    const err = h('p.msg.error', { hidden: true });
    return h('div.modal-body',
      h('p', 'Replace it (the current photo goes to the trash), or add this one as a variant that sits next to it?'),
      h('div.field', h('label', 'Variant name'), input, h('p.help', `Variants are named ${slot}-something, e.g. ${slot}-open or ${slot}-2.`)),
      err,
      h('footer.modal-foot',
        h('button.btn', { type: 'button', onclick: () => close(null) }, 'Cancel'),
        h('button.btn.danger', { type: 'button', onclick: () => close({ replace: true }) }, 'Replace'),
        h('button.btn.primary', { type: 'button', onclick: () => {
          const n = input.value.trim().toLowerCase();
          if (!NAME.test(n) || !n.startsWith(slot + '-')) { err.textContent = `Use ${slot}- followed by lowercase words, e.g. ${slot}-open.`; err.hidden = false; return; }
          close({ name: n });
        } }, 'Add as variant')));
  });
}

function askName(title, suggestion, check) {
  return modal(title, close => {
    const input = h('input', { type: 'text', value: suggestion, autofocus: true });
    const err = h('p.msg.error', { hidden: true });
    return h('form.modal-body', {
      onsubmit: e => {
        e.preventDefault();
        const n = input.value.trim().toLowerCase();
        const problem = !NAME.test(n) ? 'Use lowercase words joined by hyphens, e.g. platen-detail.' : check?.(n);
        if (problem) { err.textContent = problem; err.hidden = false; return; }
        close(n);
      },
    },
      h('div.field', h('label', 'Photo name'), input, h('p.help', 'Lowercase words joined by hyphens. A standard shot name (front, side, case-open…) puts it in that slot.')),
      err,
      h('footer.modal-foot', h('button.btn', { type: 'button', onclick: () => close(null) }, 'Cancel'), h('button.btn.primary', { type: 'submit' }, 'OK')));
  });
}
