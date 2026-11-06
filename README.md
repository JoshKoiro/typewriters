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
| `npm run build` | Builds the site into `_site/` without serving it. Catches template errors. |
| `npm run clean` | Deletes the `_site/` build output and cache. Try this if the preview acts strangely. |
| `npm run new -- <slug>` | Creates a new machine, e.g. `npm run new -- 1965-brother-valiant` |
| `npm run photos` | Processes new photos: `originals/` → `photos/` (resize, strip metadata) |
| `npm run photos:force` | Reprocesses *all* photos, including ones already done |
| `npm run check:photos` | Makes sure no published photo still has GPS or other metadata |
| `npm run check` | `check:photos` + `build`: everything that should pass before publishing |
| `npm run deploy` | Runs `check`, then `git push` if it passes. **Commit first.** |

The `--` in `npm run new -- <slug>` is required. It passes the slug through npm to the script.

---

## Everyday tasks

### Add a typewriter

```
npm run new -- 1965-brother-valiant
```

1. Fill in `_machines/1965-brother-valiant.md`. Blank fields are simply hidden on the site.
2. Put the original photos in `originals/1965-brother-valiant/`.
   Name them `01-front.jpg`, `02-side.jpg`, … to control the order. The first one is the
   gallery cover, unless you set `cover:` in the machine file.
3. `npm run photos`
4. `npm run serve` to check it looks right.
5. Commit and publish (below).

### Publish changes

```
git add .
git commit -m "Add Brother Valiant"
npm run deploy
```

`deploy` refuses to push if any photo in `photos/` still has metadata, or if the site fails to
build. The live site updates 1–2 minutes after a push. Progress shows in the repo's **Actions** tab.

### Sell a machine

In its machine file, set:

```yaml
status: for-sale
price: "$150 CAD"
listing_url: "https://www.facebook.com/marketplace/item/..."
```

Its page then shows a "for sale" box linking to the listing. To share everything that's for sale:
**https://joshkoiro.github.io/typewriters/?status=for-sale**

Once it's sold, change it to `status: sold`. **Don't delete the file**, so the history stays.
Sold machines are hidden from the gallery by default, but visitors can switch them on.

### Edit details or notes

Edit the machine's file in `_machines/`. Everything below the second `---` is the notes section,
written in Markdown (`## Heading`, `- bullet`, `**bold**`).

---

## How it fits together

```
_machines/<slug>.md       one file per typewriter: details at the top, notes below
photos/<slug>/            web-ready photos (committed to git, published)
originals/<slug>/         full-size camera originals (NOT in git, back these up separately!)
_data/statuses.yml        the list of statuses and their labels
_templates/               blank machine file used by `npm run new`
scripts/                  the Node scripts behind the npm commands
_layouts/, _includes/     page templates (Jekyll / Liquid)
index.html                the gallery page with the filters
assets/css, assets/js     styles, gallery filtering, photo lightbox
_config.yml               site title, URL, baseurl
```

The **slug** is the machine's file name without `.md`, e.g. `1971-royal-mercury`. It ties
everything together: the photos folder, the originals folder and the page URL
(`/machines/1971-royal-mercury/`). If a machine shows "No photos yet", check that the
photo folder name matches the slug exactly. `npm run check:photos` warns about mismatches.

### Statuses

| `status:` | Shown as | Visible by default |
|-----------|----------|--------------------|
| `collection` | In collection | yes |
| `for-sale` | For sale | yes |
| `sold` | Sold | no |
| `sighting` | Sighting | no |

To add one (e.g. `wanted`), add it to `_data/statuses.yml`. For a badge colour, add a
`.status-wanted { background: ... }` rule in `assets/css/style.css`.

### Tags

Free-form, e.g. `tags: [ultra-portable, 1960s, script]`. Every tag used anywhere becomes a
filter button automatically. Keep them lowercase with hyphens so they stay consistent.

### Shareable links

The gallery keeps its filters in the URL:

- `?status=for-sale`: only machines for sale
- `?tag=ultra-portable`: only ultra-portables
- `?status=collection,for-sale,sold`: including sold machines
- `?q=olivetti`: a search

---

## Photos and privacy

`npm run photos` takes every image in `originals/` and, for each one:

- rotates it upright,
- resizes it so the longest side is 2000 px (smaller photos are never enlarged),
- removes **all** metadata (GPS location, phone/camera model, timestamps),
- converts colours to sRGB and saves a JPEG (PNG stays PNG) with a lowercase, URL-safe name.

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
