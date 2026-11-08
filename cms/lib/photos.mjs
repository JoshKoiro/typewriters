/**
 * Photos for one machine, built on the existing pipeline rather than around it:
 *
 *   originals/<slug>/<shot>.jpg  --(scripts/prep-photos.mjs)-->  photos/<slug>/NN-<shot>.jpg
 *
 * The display ORDER comes from file NAMES (scripts/photo-order.mjs), not from a stored list. So the
 * editor's "slots" (thumbnail, front, side, ...) are just names: dropping a photo on the "side" slot
 * saves it as originals/<slug>/side.jpg, and prep-photos numbers it. Moving a photo to another slot
 * is a rename. The files on disk look exactly as if you'd named them by hand.
 *
 * Things that need care:
 *   - prep-photos skips a photo whose numbered web copy already exists. When an original is replaced
 *     or renamed, we delete its web copy first so it gets reprocessed.
 *   - originals/ isn't in git, so a fresh clone can have published photos but no originals. Running
 *     prep-photos for a folder with SOME originals deletes web copies that have no original. So while
 *     a machine has "web-only" photos, uploads are blocked until restoreFromWeb() copies the web
 *     versions back into originals/ (they're already resized and stripped, which is fine as a source).
 *   - Only JPEG uploads: sharp can't read most phone HEIC files. Checked by the file's first bytes.
 *   - Replaced/deleted originals go to the trash (cms/lib/util.mjs moveToTrash), never deleted.
 *   - `cover:` in the machine file names a shot; renames and deletes keep it pointing right.
 */
import { readdir, readFile, writeFile, mkdir, stat, copyFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { repo, exists, moveSafe, moveToTrash, run } from './util.mjs';
import { site, photos as photoConfig } from '../config.mjs';
import { PHOTO_ORDER, shotIndex, comparePhotoNames, isConventionalName } from '../../scripts/photo-order.mjs';
import { readMachine, setField, SLUG } from './machines.mjs';

const IMG = /\.(jpe?g|png|webp|tiff?|heic|heif)$/i;
const WEB = /\.(jpe?g|png)$/i;
const origDir = slug => path.join(repo, site.originalsDir, slug);
const webDir = slug => path.join(repo, site.photosDir, slug);
const err = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

/** Same as webName() in scripts/prep-photos.mjs (not importable: that file runs on import). Keep in sync. */
export function webName(file) {
  const stem = path.parse(file).name.toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '');
  return stem || 'photo';
}
const stemOfWeb = f => path.parse(f).name.replace(/^\d+-/, '');
const listDir = async d => ((await exists(d)) ? readdir(d) : []);

/**
 * Everything the Photos tab needs: one entry per photo in display order.
 *   name   the shot name (file name without extension) = what `cover:` refers to
 *   slot   the PHOTO_ORDER entry it belongs to (front-open -> front), or null for extras
 *   web    the processed file in photos/<slug>/ (null until prep-photos has run)
 *   webOnly  true when there's a published photo but no original on this computer
 */
export async function listPhotos(slug) {
  const originals = (await listDir(origDir(slug))).filter(f => IMG.test(f));
  const web = (await listDir(webDir(slug))).filter(f => WEB.test(f));
  const webByStem = new Map(web.map(f => [stemOfWeb(f), f]));
  const fromOriginals = new Set();

  const list = originals.map(file => {
    const wn = webName(file);
    fromOriginals.add(wn);
    const idx = shotIndex(wn);
    return { name: path.parse(file).name, file, web: webByStem.get(wn) || null, slot: idx === -1 ? null : PHOTO_ORDER[idx], conventional: isConventionalName(path.parse(file).name), webOnly: false };
  });
  for (const f of web) {
    const stem = stemOfWeb(f);
    if (fromOriginals.has(stem)) continue;
    const idx = shotIndex(stem);
    list.push({ name: stem, file: null, web: f, slot: idx === -1 ? null : PHOTO_ORDER[idx], conventional: true, webOnly: true });
  }
  list.sort((a, b) => comparePhotoNames(webName(a.name), webName(b.name)));

  const machine = await readMachine(slug).catch(() => null);
  return {
    photos: list,
    order: PHOTO_ORDER,
    cover: machine?.data?.cover || '',
    webOnly: list.filter(p => p.webOnly).length,
  };
}

/** Run prep-photos for this one machine. Returns its output for the editor's log. */
export async function prep(slug, { force = false } = {}) {
  const args = ['scripts/prep-photos.mjs', '--only', slug];
  if (force) args.push('--force');
  return run(process.execPath, args);
}

function checkNames(slug, name) {
  if (!SLUG.test(slug)) throw err(400, 'Bad machine name');
  if (!isConventionalName(name)) throw err(400, `"${name}" isn't a valid photo name: lowercase words joined by hyphens, e.g. front or typebars-2`);
}

async function findOriginal(slug, name) {
  const want = webName(name);
  return (await listDir(origDir(slug))).find(f => IMG.test(f) && webName(f) === want) || null;
}
async function findWeb(slug, name) {
  const want = webName(name);
  return (await listDir(webDir(slug))).find(f => WEB.test(f) && stemOfWeb(f) === want) || null;
}
async function removeWebCopy(slug, name) {
  const w = await findWeb(slug, name);
  if (w) await unlink(path.join(webDir(slug), w)); // regenerated by prep; the original is the source
}
async function guardWebOnly(slug) {
  const { webOnly } = await listPhotos(slug);
  if (webOnly) throw err(409, `This machine has ${webOnly} published photo(s) without originals on this computer. Restore them first (button on the Photos tab), otherwise processing would delete them.`, { needsRestore: true });
}

/** Save an uploaded JPEG as originals/<slug>/<name>.jpg and process it. */
export async function uploadPhoto(slug, name, buffer, { replace = false } = {}) {
  checkNames(slug, name);
  if (!(buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)) {
    throw err(415, 'Only JPEG photos can be added. Export HEIC/PNG photos as JPEG first (on an iPhone: Settings > Camera > Formats > Most Compatible).');
  }
  await guardWebOnly(slug);
  const existing = await findOriginal(slug, name);
  if (existing && !replace) throw err(409, `There is already a "${name}" photo.`, { exists: true });
  if (existing) await moveToTrash(path.join(origDir(slug), existing), `${slug}-photo`);
  await removeWebCopy(slug, name);
  await mkdir(origDir(slug), { recursive: true });
  await writeFile(path.join(origDir(slug), `${name}.jpg`), buffer);
  return prep(slug);
}

/** Move a photo to another name/slot. With replace, whatever is at the target goes to the trash. */
export async function renamePhoto(slug, name, to, { replace = false } = {}) {
  checkNames(slug, name);
  checkNames(slug, to);
  if (webName(name) === webName(to)) return { code: 0, out: '' };
  await guardWebOnly(slug);
  const src = await findOriginal(slug, name);
  if (!src) throw err(404, `No original for "${name}"`);
  const target = await findOriginal(slug, to);
  if (target && !replace) throw err(409, `There is already a "${to}" photo.`, { exists: true });
  if (target) {
    await moveToTrash(path.join(origDir(slug), target), `${slug}-photo`);
    await removeWebCopy(slug, to);
  }
  await removeWebCopy(slug, name);
  await moveSafe(path.join(origDir(slug), src), path.join(origDir(slug), to + path.extname(src).toLowerCase()));
  const result = await prep(slug);
  const { data } = await readMachine(slug);
  if (data.cover === name) await setField(slug, 'cover', to);
  else if (target && data.cover === to) await setField(slug, 'cover', '');
  return result;
}

/** Move a photo (original and web copy) to the trash, then renumber the rest. */
export async function deletePhoto(slug, name) {
  checkNames(slug, name);
  const src = await findOriginal(slug, name);
  const web = await findWeb(slug, name);
  if (!src && !web) throw err(404, `No photo "${name}"`);
  await moveToTrash([src && path.join(origDir(slug), src), web && path.join(webDir(slug), web)].filter(Boolean), `${slug}-photo`);
  const result = src ? await prep(slug) : { code: 0, out: '' };
  const { data } = await readMachine(slug);
  if (data.cover === name) await setField(slug, 'cover', '');
  return result;
}

/** Copy web-only photos back into originals/ so the folder is complete again. */
export async function restoreFromWeb(slug) {
  if (!SLUG.test(slug)) throw err(400, 'Bad machine name');
  const { photos } = await listPhotos(slug);
  await mkdir(origDir(slug), { recursive: true });
  let n = 0;
  for (const p of photos.filter(x => x.webOnly)) {
    await copyFile(path.join(webDir(slug), p.web), path.join(origDir(slug), p.name + path.extname(p.web).toLowerCase()));
    n++;
  }
  const result = await prep(slug); // output names match the existing web copies, so nothing is recompressed
  return { restored: n, ...result };
}

// ---------------------------------------------------------------------------------------------
// Thumbnails for the editor (small, cached in memory; never written to disk)
// ---------------------------------------------------------------------------------------------

const thumbs = new Map();
export async function thumbnail(kind, slug, file, width = 360) {
  if (!SLUG.test(slug) || !/^[\w.-]+$/.test(file)) throw err(400, 'Bad path');
  const full = path.join(kind === 'web' ? webDir(slug) : origDir(slug), file);
  const s = await stat(full).catch(() => null);
  if (!s) throw err(404, 'Not found');
  const key = `${full}|${s.mtimeMs}|${width}`;
  if (!thumbs.has(key)) {
    if (thumbs.size > 400) thumbs.clear();
    thumbs.set(key, await sharp(full).rotate().resize({ width, height: width, fit: 'inside' }).jpeg({ quality: 78 }).toBuffer());
  }
  return thumbs.get(key);
}

export const accept = photoConfig.accept;
