/**
 * CMS configuration: what the editor knows about this site.
 *
 * This file is the one place that's specific to the typewriter site. The server and the editor are
 * written against it, so another Jekyll site could reuse the CMS by changing this file (and its
 * photo-order rules). Keep it declarative.
 *
 * FIELDS
 *   key      the YAML key in the machine file
 *   label    shown in the form
 *   kind     how the value is stored and written (see cms/lib/yaml-patch.mjs for the full list):
 *            quoted | string | long | number | boolean | date | flowList | issueRef | items
 *   input    how the form shows it: text | textarea | number | checkbox | date | select | tags | url | rating | photo-shot
 *   options  for selects: where the choices come from, as "<file in _data>" or "<file>#<key>".
 *            Each entry needs `key` and `label` (icon/color are used when present). Add a value to the
 *            data file and it appears in the form automatically.
 *   suggest  for text/tags inputs: offer values already used in other machines (autocomplete)
 *   help     one line under the input
 *
 * Order matters: it's the order of the template, so new keys are written in the expected place.
 */

export const site = {
  // Where things live, relative to the repo root
  collectionDir: '_machines',
  template: '_templates/machine-template.md',
  originalsDir: 'originals',
  photosDir: 'photos',
  trashDir: '_trash', // underscore: Jekyll ignores it; also in .gitignore
  // The local preview: `npm run serve` (Jekyll on port 4000, using baseurl from _config.yml)
  previewCommand: 'npm run serve',
  previewPort: 4000,
  cmsPort: 4100,
};

const issueFields = [
  { key: 'id', label: 'Id', kind: 'string', input: 'text', required: true, help: 'Short, lowercase-with-hyphens. Repairs point at this; it also forms the link #issue-<id>.' },
  { key: 'title', label: 'Title', kind: 'string', input: 'text', required: true },
  { key: 'category', label: 'Category', kind: 'string', input: 'select', options: 'fields.yml#issue_category' },
  { key: 'status', label: 'Status', kind: 'string', input: 'select', options: 'issue_statuses.yml', required: true },
  { key: 'opened', label: 'Opened', kind: 'date', input: 'date' },
  { key: 'description', label: 'The problem', kind: 'long', input: 'textarea' },
  { key: 'resolved', label: 'Resolved', kind: 'date', input: 'date' },
  { key: 'resolution', label: 'Resolution', kind: 'long', input: 'textarea', help: 'How it was fixed, or why you are living with it.' },
  { key: 'related', label: 'Related issues', kind: 'flowList', input: 'tags' },
];

const repairFields = [
  { key: 'date', label: 'Date', kind: 'date', input: 'date', required: true },
  { key: 'issue', label: 'For issue', kind: 'issueRef', input: 'issue-ref' },
  { key: 'outcome', label: 'Outcome', kind: 'string', input: 'select', options: 'fields.yml#repair_outcome' },
  { key: 'work', label: 'Work done', kind: 'long', input: 'textarea', required: true },
];

/** The machine file's front matter, grouped the way the template groups it. */
export const groups = [
  {
    title: 'Identity',
    fields: [
      { key: 'title', label: 'Title', kind: 'quoted', input: 'text', required: true, help: 'Year + make + model reads well, e.g. "1956 Olivetti Lettera 22".' },
      { key: 'nickname', label: 'Nickname', kind: 'quoted', input: 'text' },
      { key: 'make', label: 'Make', kind: 'quoted', input: 'text', suggest: true },
      { key: 'model', label: 'Model', kind: 'quoted', input: 'text' },
      { key: 'year', label: 'Year', kind: 'number', input: 'number' },
      { key: 'year_approx', label: 'Year is approximate (shows "c.")', kind: 'boolean', input: 'checkbox' },
      { key: 'serial', label: 'Serial', kind: 'quoted', input: 'text' },
      { key: 'made_in', label: 'Made in', kind: 'quoted', input: 'text', suggest: true },
      { key: 'color', label: 'Color', kind: 'quoted', input: 'text', suggest: true },
    ],
  },
  {
    title: 'Specs',
    fields: [
      { key: 'typeface', label: 'Typeface', kind: 'quoted', input: 'text', suggest: true, help: 'e.g. Pica, Elite, #84 Bodoni Elite' },
      { key: 'pitch', label: 'Pitch (cpi)', kind: 'number', input: 'number' },
      { key: 'size_class', label: 'Size', kind: 'quoted', input: 'select', options: 'fields.yml#size_class' },
      { key: 'keyboard', label: 'Keyboard', kind: 'quoted', input: 'text', suggest: true },
      { key: 'carriage_width', label: 'Carriage width (inches of paper)', kind: 'number', input: 'number' },
      { key: 'spools', label: 'Ribbon spools', kind: 'quoted', input: 'text', suggest: true },
      { key: 'features', label: 'Features', kind: 'flowList', input: 'tags', suggest: true },
      { key: 'weight', label: 'Weight', kind: 'quoted', input: 'text', help: 'e.g. 8.5 lb' },
    ],
  },
  {
    title: 'Condition',
    fields: [
      { key: 'parts_only', label: 'Parts machine (shows a "Parts only" badge)', kind: 'boolean', input: 'checkbox' },
      { key: 'has_case', label: 'Has a case', kind: 'boolean', input: 'checkbox' },
      { key: 'typing_feel', label: 'Typing feel', kind: 'number', input: 'rating' },
      { key: 'favorite', label: 'Favorite ★', kind: 'boolean', input: 'checkbox' },
    ],
  },
  {
    title: 'Ownership',
    fields: [
      { key: 'status', label: 'Status', kind: 'string', input: 'select', options: 'statuses.yml', required: true },
      { key: 'acquired', label: 'Acquired', kind: 'date', input: 'date' },
      { key: 'acquired_approx', label: 'Only the month is known (use the 1st)', kind: 'boolean', input: 'checkbox' },
      { key: 'purchased_from', label: 'Purchased from', kind: 'quoted', input: 'text', suggest: true, help: 'The general kind of place. Specifics belong in the private ledger.' },
      { key: 'sold_date', label: 'Sold date', kind: 'date', input: 'date' },
      { key: 'price', label: 'Asking price', kind: 'quoted', input: 'text', help: 'Shown while the status is "for sale", e.g. $150' },
      { key: 'listing_url', label: 'Listing URL', kind: 'quoted', input: 'url' },
    ],
  },
  {
    title: 'Links & display',
    fields: [
      { key: 'twdb_url', label: 'Typewriter Database URL', kind: 'quoted', input: 'url' },
      { key: 'tags', label: 'Tags', kind: 'flowList', input: 'tags', suggest: true, help: 'lowercase-with-hyphens; each tag becomes a gallery filter' },
      { key: 'cover', label: 'Cover photo', kind: 'quoted', input: 'photo-shot', help: 'Pick with the ★ on the Photos tab. Blank = the first photo.' },
    ],
  },
];

/** Issues and repairs have their own tab; listed here so they're part of the same schema. */
export const lists = [
  { key: 'issues', label: 'Issues', kind: 'items', item: { fields: issueFields } },
  { key: 'repairs', label: 'Repairs', kind: 'items', item: { fields: repairFields } },
];

/** Every front-matter field, in template order: what yaml-patch uses. */
export const schema = { fields: [...groups.flatMap(g => g.fields), ...lists] };

/** Shown on the Photos tab. The slot order itself comes from scripts/photo-order.mjs (PHOTO_ORDER). */
export const photos = {
  accept: ['.jpg', '.jpeg'], // JPEG only: sharp can't read most phone HEIC files (see README)
  slotLabels: {
    thumbnail: 'Thumbnail (gallery cover)',
    'type-sample': 'Type sample',
    'case-closed': 'Case, closed',
    'case-open': 'Case, open',
    'case-empty': 'Case, empty',
  },
};
