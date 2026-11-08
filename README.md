# Typewriter Collection

My typewriter collection: photos, serials, typefaces and notes.
Live at **https://joshkoiro.github.io/typewriters/**

This repo is both the **website** and the **backup** of the collection data. GitHub Pages
rebuilds the site automatically on every push to `main`.

---

## Quick start (new computer, or coming back after a while)

**1. Install the tools** (skip any you already have)

| Tool | Version | Check with | Get it |
|------|---------|------------|--------|
| Git | any | `git --version` | git-scm.com |
| Node.js | 20.9 or newer | `node -v` | nodejs.org (LTS) |
| Ruby | any recent | `ruby -v` | Windows: rubyinstaller.org, the **with DevKit** version |
| Bundler | any | `bundle -v` | `gem install bundler` |

**2. Get the code and install everything**

```
git clone https://github.com/joshkoiro/typewriters.git
cd typewriters
npm run setup
```

**3. Run the site locally**

```
npm run serve
```

Open **http://localhost:4000/typewriters/**. Pages reload automatically when you save a file.
Press `Ctrl+C` to stop the server.

---

## Command cheat sheet

| Command | What it does |
|---------|--------------|
| `npm run setup` | Installs everything: Node packages (sharp) and Ruby gems (Jekyll). Run after cloning. |
| `npm run serve` | Local preview at http://localhost:4000/typewriters/ with live reload |
| `npm run serve:private` | Same, plus your private ledger details (🔒) on each machine. Local only. |
| `npm run ledger` | Prints the private ledger joined with the machine data, with totals |
| `npm run finances` | Builds and opens a private finance report: cash flow, profit & loss, per machine |
| `npm run build` | Builds the site into `_site/` without serving it. Catches template errors. |
| `npm run clean` | Deletes the `_site/` build output and cache. Try this if the preview acts strangely. |
| `npm run new -- <slug>` | Creates a new machine, e.g. `npm run new -- 1965-brother-valiant` |
| `npm run rename` | **Preview** renaming photos in `originals/` to the naming convention. Changes nothing. |
| `npm run rename -- --apply` | Actually renames them |
| `npm run photos` | Processes photos: `originals/` → `photos/` (order, resize, strip metadata) |
| `npm run photos:force` | Reprocesses *all* photos, including ones already done |
| `npm run check:photos` | Makes sure no published photo still has GPS or other metadata |
| `npm run check:private` | Makes sure the private ledger copy can't be committed |
| `npm run check:issues` | Checks issues and repairs: repairs pointing at issue ids that don't exist, bad statuses, missing resolutions |
| `npm run check` | `check:photos` + `check:private` + `check:issues` + `build`: everything that should pass before publishing |
| `npm run deploy` | Runs `check`, then `git push` if it passes. **Commit first.** |

The `--` in `npm run new -- <slug>` is required. It passes the slug through npm to the script.

---

## Everyday tasks

### Add a typewriter

```
npm run new -- 1965-brother-valiant
```

1. Fill in `_machines/1965-brother-valiant.md`. Blank fields are simply hidden on the site.
2. Put the original photos in `originals/1965-brother-valiant/`, named by the
   [photo naming convention](#photo-naming-convention) (`thumbnail.jpg`, `front.jpg`, …).
   If you're not sure you named them right, run `npm run rename` to preview fixes.
3. `npm run photos`
4. `npm run serve` to check it looks right.
5. Commit and publish (below).

### Publish changes

```
git add .
git commit -m "Add Brother Valiant"
npm run deploy
```

`deploy` refuses to push if any photo in `photos/` still has metadata, if a repair points at an
issue that doesn't exist, or if the site fails to build. The live site updates 1–2 minutes after a push. Progress shows in the repo's **Actions** tab.

### Sell a machine

In its machine file, set:

```yaml
status: for-sale
price: "$150 CAD"
listing_url: "https://www.facebook.com/marketplace/item/..."
```

Its page then shows a "for sale" box linking to the listing. To share everything that's for sale:
**https://joshkoiro.github.io/typewriters/?status=for-sale**

Once it's sold, change it to `status: sold` and set `sold_date:`. **Don't delete the file**, so the
history stays. Record what you got for it in the private ledger (`sold_for:`).

### Edit details or notes

Edit the machine's file in `_machines/`. Everything below the second `---` is the notes section,
written in Markdown (`## Heading`, `- bullet`, `**bold**`).

---

### Log an issue or a repair

Problems with a machine go in its `issues:` list; the work you do goes in `repairs:`. A repair
that was for an issue points at it with `issue: <id>`. Ad-hoc work (a cleaning, new spools) just
leaves `issue:` out.

1. Something's wrong: add an issue with `status: open`.
2. Each time you work on it: add a repair with `issue: <id>`, and optionally how it went
   (`outcome: fixed`, `partial` or `no-help`). Failed attempts are worth logging too.
3. Once it's dealt with: set `status: fixed` (or `managed` if you're living with it), plus
   `resolved:` and a `resolution:` saying how.
4. `npm run check:issues` catches typos in ids before you publish.

Full field list: [Issues and repairs](#issues-and-repairs).

## How it fits together

```
_machines/<slug>.md       one file per typewriter: details at the top, notes below
photos/<slug>/            web-ready photos (committed to git, published)
originals/<slug>/         full-size camera originals (NOT in git, back these up separately!)
_data/statuses.yml        statuses: labels, emoji, colours
_data/fields.yml          allowed values for size_class, condition badges, issue categories, repair outcomes
_data/issue_statuses.yml  issue statuses (open / managed / fixed): labels, emoji, colours
_data/fonts.yml           the site's fonts (change typography here)
_data/private.yml         LOCAL copy of the private ledger (git-ignored, see "Private data")
_templates/               blank machine file used by `npm run new`
scripts/                  the Node scripts behind the npm commands
_layouts/, _includes/     page templates (Jekyll / Liquid)
index.html                the gallery page with the filters
issues.html               the /issues/ page: every issue on every machine, with filters
assets/css, assets/js     styles, gallery + issues filtering, photo lightbox
_config.yml               site title, URL, baseurl
```

The **slug** is the machine's file name without `.md`, e.g. `1971-royal-mercury`. It ties
everything together: the photos folder, the originals folder and the page URL
(`/machines/1971-royal-mercury/`). If a machine shows "No photos yet", check that the
photo folder name matches the slug exactly. `npm run check:photos` warns about mismatches.

### Machine fields

Every field is optional; blank ones are hidden on the site. Dates are written `YYYY-MM-DD`
**without quotes**, numbers without quotes, and text in quotes (always quote text containing `#`).

| Field | Example | Notes |
|-------|---------|-------|
| `title` | `"1956 Olivetti Lettera 22"` | Shown everywhere. Year + make + model reads well. |
| `nickname` | `"Olivia (Liv)"` | |
| `make`, `model` | `"Olivetti"`, `"Lettera 22"` | "Make & model A–Z" sorts on these |
| `year` | `1956` | A number, so it sorts properly |
| `year_approx` | `true` | Shows the year as "c. 1956" |
| `serial`, `made_in`, `color` | `"327548"`, `"Italy"`, `"brown"` | |
| `typeface` | `"#84 Bodoni Elite"` | |
| `pitch` | `12` | Characters per inch, shown as "12 cpi" |
| `size_class` | `ultra-portable` | `ultra-portable`, `portable`, `semi-portable`, `standard`. Gallery filter. |
| `keyboard` | `"QWERTY"` | |
| `carriage_width` | `9` | Inches of paper it takes |
| `spools` | `"universal 2-inch"` | Which ribbon spools it uses |
| `features` | `[tabulator, paper support]` | |
| `weight` | `"8 lb"` | |
| `parts_only` | `true` | A parts machine: shows a "Parts only" badge. Otherwise the condition comes from issues: any **open issue** shows a "Needs work" badge with the count, linking to the issues. |
| `has_case` | `true` | `true` or `false` |
| `typing_feel` | `4` | 1–5, shown as dots. "Typing feel" sort. |
| `favorite` | `true` | ★ on the card, and a "Favorites" filter |
| `status` | `collection` | See statuses below |
| `acquired` | `2026-11-02` | Default sort (newest first). Shows "4 weeks ago" etc. |
| `acquired_approx` | `true` | Only the month is known: use the 1st, shows "c. Nov 2026" |
| `purchased_from` | `"Facebook Marketplace"` | The general kind of place. Specifics go in the private ledger. |
| `sold_date` | `2026-09-19` | Shows the sold date and how long you owned it |
| `price`, `listing_url` | `"$140"`, `"https://…"` | Only shown while `status: for-sale` |
| `twdb_url` | `"https://typewriterdatabase.com/…"` | |
| `tags` | `[glass-keys, script]` | Free-form; each becomes a filter |
| `cover` | `front` | Shot to use as the gallery cover (default: thumbnail) |
| `issues` | see below | Problems with the machine: a list under the notes; click one for its repair timeline |
| `repairs` | see below | Repair log table under the issues, newest first; can point at an issue |

Allowed values and display labels for `size_class` (and the condition badges) live in `_data/fields.yml`.

### Issues and repairs

An **issue** is a problem with the machine. A **repair** is one job you did. Repairs can point at
the issue they were for, so each issue gets a timeline: the problem, every attempt at it (and how
it went), then how it was resolved. `>-` lets text run over several lines.

```yaml
issues:
  - id: feed-rollers                 # repairs point at this; lowercase-with-hyphens
    title: "Paper not advancing: flat-spotted feed rollers"
    category: paper-feed
    status: open                     # open | managed | fixed
    opened: 2026-11-03
    description: >-
      What's wrong and how it shows up.
    resolved: 2026-11-20             # once it's managed or fixed
    resolution: >-
      How it was fixed, or why you're living with it.
    related: [line-space-ratchet]    # optional: other issues on this machine

repairs:
  - date: 2026-11-03
    issue: feed-rollers              # optional; leave out for ad-hoc work like a cleaning
    outcome: partial                 # optional: fixed | partial | no-help
    work: >-
      Replaced the flat-spotted feed rollers with 3/8" OD silicone tubing.
  - date: 2026-11-10
    work: Cleaned and oiled the segment.
```

| Issue field | Notes |
|-------------|-------|
| `id` | Unique on that machine. Also the link: `/machines/olivia/#issue-feed-rollers` |
| `title` | One line. Quote it if it contains a `:` |
| `category` | From `issue_category` in `_data/fields.yml`. Filter on the /issues/ page. |
| `status` | `open`, `managed` (living with it / worked around it), `fixed`. In `_data/issue_statuses.yml`. |
| `opened`, `resolved` | Dates, no quotes |
| `description`, `resolution` | Markdown. The resolution closes the timeline. |
| `related` | List of other issue ids on the same machine |

A repair can deal with several issues at once: `issue: [feed-rollers, hard-platen]`.
The repair log table still lists every job; linked ones get a chip that jumps to the issue.

Every issue from every machine is also listed on **/issues/**, with status and category filters.
Those keep their state in the URL, so e.g. every paper-feed problem across the collection is
**https://joshkoiro.github.io/typewriters/issues/?category=paper-feed**

Anything in the front matter is **public**. GitHub shows the raw file even if the site doesn't
display a field. Prices paid, sellers and places go in the private ledger (below).

### Statuses

| `status:` | Shown as |
|-----------|----------|
| `collection` | ⌨️ In collection (green) |
| `for-sale` | 🏷️ For sale (red) |
| `sold` | 🤝 Sold (grey) |
| `sighting` | 👀 Sighting (blue) |

All machines are shown by default; the filters narrow it down. Labels, emoji and colours are in
`_data/statuses.yml`. Add a status there (e.g. `wanted`) and it gets a filter automatically.

### Tags

Free-form, e.g. `tags: [glass-keys, script]`. Every tag used anywhere becomes a filter button
automatically. Keep them lowercase with hyphens so they stay consistent.

### Shareable links

The gallery keeps its filters in the URL:

- `?status=for-sale`: only machines for sale
- `?tag=ultra-portable`: only ultra-portables
- `?size=ultra-portable&condition=needs-work`: filters combine
- `?sort=year-asc`: oldest machines first (also `acquired-asc`, `year-desc`, `make`, `feel`)
- `?q=olivetti`: a search

---

## Private data (prices, sellers, places)

Things that shouldn't be public live in a **separate private repo**, `typewriters-private`,
in a single file, `ledger.yml`, keyed by machine slug:

```yaml
olivia:
  paid: 85
  bought_at: "Lancaster, PA"
  seller: "Original owner's wife"
  sold_for:
  sold_to: ""
  notes: ""
```

**Setup (once):** create a **private** GitHub repo called `typewriters-private`, then clone it
**next to** this one so the folders sit side by side (`code/typewriters` and
`code/typewriters-private`). If you keep it elsewhere, set the `TYPEWRITERS_PRIVATE` environment
variable to its folder.

**How the two connect:**
- `npm run serve:private` copies the ledger into `_data/private.yml` and starts the preview. Each
  machine page then shows a 🔒 box with the private details, and cards show what you paid.
- `npm run serve` removes that copy first, so you see exactly what the public sees.
- `npm run ledger` prints a table of every machine with paid and sold prices, plus totals, and
  points out machines missing from the ledger.
- `npm run new -- <slug>` adds an empty ledger entry for the new machine.

**Finance report:** `npm run finances` builds `typewriters-private/reports/finances.html` and
opens it in your browser. Other spending (ribbons, parts, tools, shipping) goes in
`typewriters-private/expenses.yml`. It shows:
- totals: spent, made from sales, net cash, profit/loss, and the collection's value at cost
- monthly cash flow: a chart and table of money in vs out per month, with a running total
- profit & loss: sales minus what the sold machines cost (purchase plus parts logged against
  them), minus running costs like tools. Machines you still own count as *collection at cost*,
  not as a loss.
- per machine: paid, extra costs, total cost, sale price, profit/loss, how long you held it
- a list of missing data, e.g. a sold machine with no `sold_date`

The report is written into the private repo, never into this one.

**Why it can't leak:** GitHub builds the public site from this repo, which never contains the
ledger. The local copy `_data/private.yml` is git-ignored, and `npm run check` (so also
`npm run deploy`) fails if it is ever tracked by git.

Commit and push the private repo too. That's its backup.

## Look and feel

**Fonts:** all in `_data/fonts.yml`. There are three roles: `heading`, `body` and `ui` (labels,
filters, badges). To change one, edit its `name` and `google` lines. The file has instructions
and a list of fonts to try. Text sizes are the `--text-*` variables at the top of
`assets/css/style.css`.

**Colours:** the light and dark palettes are at the top of `assets/css/style.css`. Status colours
are in `_data/statuses.yml`, and condition badge colours in `_data/fields.yml`.

**Light/dark mode:** follows the visitor's system setting until they click the toggle (top right),
then remembers their choice.

**Gallery photos:** `--card-image-fit` in `style.css`. `cover` fills the frame and crops the edges;
`contain` shows the whole photo with bars around it. Photos are never stretched either way.

## Photo naming convention

Name the files in `originals/<slug>/` after the shot. The site orders them automatically.

```
<shot>.jpg              thumbnail.jpg, front.jpg, type-sample.jpg, case-open.jpg
<shot>-<variant>.jpg    front-open.jpg, thumbnail-paper-hold.jpg, typebars-2.jpg
```

- lowercase, words separated by **hyphens** (not underscores)
- **no machine name** in the file name. The folder already says which machine it is.

**Display order**

| # | Shot | Notes |
|---|------|-------|
| 1 | `thumbnail` | The gallery cover |
| 2 | `front` | |
| 3 | `side` | |
| 4 | `back` | |
| 5 | `top` | |
| 6 | `bottom` | |
| 7 | `type-sample` | |
| 8 | `serial` | |
| 9 | `typebars` | |
| 10 | `interior` | |
| 11 | `case-closed` | |
| 12 | `case-open` | machine sitting in the open case |
| 13 | `case-empty` | |
| … | anything else | alphabetically, after all of the above |

Variants follow their shot: `front.jpg`, then `front-case-open.jpg`, `front-open.jpg`
(the plain shot first, then variants alphabetically). Numbered variants sort naturally
(`typebars`, `typebars-2`, `typebars-10`). Missing shots are simply skipped.

The order lives in **`scripts/photo-order.mjs`**. To change it or add a standard shot, edit
`PHOTO_ORDER` there and run `npm run photos:force`.

**Cover photo:** the first photo, normally `thumbnail`. To use a different one, set `cover:`
in the machine file to the shot name, e.g. `cover: "front"`.

**Fixing names automatically:** `npm run rename` previews renaming everything in `originals/` to
the convention. It removes machine-name prefixes (`Safari_front.jpg` → `front.jpg`), switches
`_` to `-`, lowercases, and applies synonyms (`empty_case` → `case-empty`,
`case_opened` → `case-open`, a lone `case` → `case-closed`). Nothing changes until you run
`npm run rename -- --apply`. Folders where two files would end up with the same name are skipped.
Synonyms are listed at the top of `scripts/rename-originals.mjs`.

## Photos and privacy

`npm run photos` takes every machine folder in `originals/`, puts the photos in
[display order](#photo-naming-convention), and for each one:

- rotates it upright,
- resizes it so the longest side is 2000 px (smaller photos are never enlarged),
- removes **all** metadata (GPS location, phone/camera model, timestamps),
- converts colours to sRGB and saves a JPEG (PNG stays PNG),
- numbers it by position: `photos/<slug>/01-thumbnail.jpg`, `02-front.jpg`, …

`photos/<slug>/` is a **generated mirror** of `originals/<slug>/`. When you add, rename or delete
an original, the next `npm run photos` renumbers the web copies and deletes the stale ones
(it lists them as `DEL`). Don't edit `photos/` by hand.

**Never copy photos straight into `photos/`.** Always go through `originals/` and the script.
Phone photos taken at home contain your GPS coordinates, and this repo is public.
`npm run deploy` checks for this and won't push if it finds metadata.

Options for custom runs: `node scripts/prep-photos.mjs SRC DEST --max 2000 --quality 90`

**Back up `originals/` somewhere else** (homelab, external drive, cloud). It's deliberately
kept out of git to keep the repo small, so GitHub does **not** have a copy.

---

## Troubleshooting

**`cannot load such file -- csv`** (or `base64`, `logger`, `ostruct`, …)
Newer Ruby (3.4+) dropped these from its standard library. Add `gem "<name>"` to the `Gemfile`,
then run `bundle install`.

**`undefined method 'tainted?'`**
An old Jekyll/Liquid is installed. Run `bundle exec jekyll -v`, which should say **3.10.x**.
If not, delete `Gemfile.lock` and run `bundle install` again.

**`npm run serve` shows a blank or broken page**
Make sure the URL includes `/typewriters/`. If it still looks wrong, run `npm run clean`, then serve again.

**A HEIC photo fails in `npm run photos`**
sharp can't read iPhone HEIC files. Set the iPhone to *Settings → Camera → Formats →
Most Compatible*, or export the photos as JPEG first.

**`npm run setup` complains about the Node version**
sharp needs Node 20.9+. Install the current LTS from nodejs.org.

**`npm audit` reports a vulnerability**
Usually in sharp's image libraries. Update it with `npm install sharp@latest`, then run
`npm run photos:force` and check the output. Avoid `npm audit fix --force`: it installs breaking
upgrades without telling you which packages it changed.

**The live site didn't update after a push**
Check the **Actions** tab on GitHub. A failed "pages build and deployment" run shows the file
and line that broke. Running `npm run build` locally usually shows the same error.

**Renamed the repo or added a custom domain**
Update `baseurl` in `_config.yml`: `"/new-repo-name"`, or `""` for a custom domain or a repo
named `joshkoiro.github.io`. Also update `url` if the domain changed.

---

## Notes

- `Gemfile` is only used for local previews. GitHub Pages ignores it and builds with its own Jekyll 3.10.
- `package.json` is only for the local tools. Nothing from `node_modules` is published.
- The site itself has no build step beyond Jekyll: plain HTML, CSS and a little vanilla JS.
