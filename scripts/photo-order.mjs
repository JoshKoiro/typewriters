/**
 * Photo naming convention and display order: the single source of truth.
 *
 * NAMING (files in originals/<slug>/):
 *   <shot>.jpg            e.g. front.jpg, type-sample.jpg, case-open.jpg
 *   <shot>-<variant>.jpg  e.g. front-open.jpg, thumbnail-paper-hold.jpg, typebars-2.jpg
 *   - lowercase, words separated by hyphens
 *   - no machine name in the file name (the folder already says which machine it is)
 *
 * ORDER on the site:
 *   1. The shots in PHOTO_ORDER below, in that order.
 *      Within one shot, the plain version comes first, then its variants alphabetically
 *      (front.jpg, front-open.jpg, ...).
 *   2. Everything else, alphabetically.
 *
 * The first photo (normally thumbnail.jpg) is the gallery cover.
 * prep-photos numbers the web copies in this order (01-thumbnail.jpg, 02-front.jpg, ...),
 * so the website only has to sort the file names.
 *
 * To change the order, edit this list and run:  npm run photos:force
 */
export const PHOTO_ORDER = [
  // The standard angles, always in this order
  'thumbnail',
  'front',
  'side',
  'back',
  'top',
  'bottom',
  // Details
  'type-sample',
  'serial',
  'typebars',
  'interior',
  // Case shots
  'case',
  'case-closed',
  'case-open',
  'case-empty',
];

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Which PHOTO_ORDER entry a name belongs to (longest match wins), or -1 if none. */
export function shotIndex(name) {
  let best = -1;
  PHOTO_ORDER.forEach((shot, i) => {
    if ((name === shot || name.startsWith(shot + '-')) && (best === -1 || shot.length > PHOTO_ORDER[best].length)) {
      best = i;
    }
  });
  return best;
}

/** Compare two photo base names (no extension) by the display order. */
export function comparePhotoNames(a, b) {
  const ia = shotIndex(a), ib = shotIndex(b);
  const ra = ia === -1 ? PHOTO_ORDER.length : ia;
  const rb = ib === -1 ? PHOTO_ORDER.length : ib;
  if (ra !== rb) return ra - rb;
  if (ia !== -1) {
    // Same shot: the plain one first, then variants
    const shot = PHOTO_ORDER[ia];
    if (a === shot) return -1;
    if (b === shot) return 1;
  }
  return collator.compare(a, b);
}

/** True if a base name follows the naming rules (lowercase words joined by hyphens). */
export const isConventionalName = name => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
