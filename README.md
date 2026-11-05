# Typewriter Collection

My typewriter collection: photos, serials, typefaces and notes, published with GitHub Pages.
This repo is both the website and the backup of the data.

## Publishing it (one-time setup)

1. Create a new GitHub repo named **`typewriters`** and push this folder to it.
2. In the repo go to **Settings → Pages**, set **Source: Deploy from a branch**, branch **`main`**, folder **`/ (root)`**, and save.
3. After a minute or two the site is live at `https://joshkoiro.github.io/typewriters/`.

If you name the repo something else, change `baseurl` in `_config.yml` to match (`"/repo-name"`).
If you ever point a custom domain at it, set `baseurl: ""`.

## Layout

```
_machines/            one Markdown file per typewriter (the data)
photos/<slug>/        web-ready photos for each machine (committed)
originals/<slug>/     your full-size camera originals (NOT committed, see .gitignore)
_data/statuses.yml    the list of statuses (In collection, For sale, Sold, Sighting)
_templates/           blank machine file to copy
scripts/prep_photos.py  resizes photos and strips their metadata
```

A machine's **slug** is its file name without `.md`, e.g. `1971-royal-mercury`.
The slug ties everything together: its photos folder, its page URL, and its originals folder.

## Adding a typewriter

1. Copy `_templates/machine-template.md` to `_machines/<slug>.md` and fill in what you know.
   Blank fields are simply hidden on the page.
2. Put the original photos in `originals/<slug>/`.
3. Run the photo script (below). The web versions land in `photos/<slug>/`.
4. Commit and push. GitHub rebuilds the site automatically.

Photos display in alphabetical order, and the first one is the gallery cover.
Name them `01-front.jpg`, `02-side.jpg`, … to control the order, or set `cover:` in the machine file.

## Photos: resize + strip metadata

```
pip install pillow pillow-heif     # once; pillow-heif is only for iPhone .HEIC files
python scripts/prep_photos.py      # originals/ -> photos/
```

For each photo the script:
- rotates it upright,
- resizes it so the longest side is 2000 px (smaller photos are left at their size),
- removes **all** metadata: GPS location, phone/camera model, timestamps and everything else
  (only the colour profile is kept),
- saves it as a JPEG (PNG stays PNG) with a lowercase, URL-safe name.

Photos it has already processed are skipped; use `--force` to redo them.
Options: `--max 2000`, `--quality 90`, or custom folders: `python scripts/prep_photos.py SRC DEST`.

Always run photos through the script before committing. The repo is public, and phone photos
taken at home carry your GPS coordinates.

**Back up `originals/` somewhere else** (homelab, external drive, cloud). It's deliberately
kept out of git to keep the repo small.

## Status and tags

`status:` is one of the keys in `_data/statuses.yml`:

| status       | shown as       | visible by default |
|--------------|----------------|--------------------|
| `collection` | In collection  | yes |
| `for-sale`   | For sale       | yes |
| `sold`       | Sold           | no (visitors can switch it on) |
| `sighting`   | Sighting       | no |

To sell a machine, set `status: for-sale`, plus `price:` and `listing_url:` (e.g. the Marketplace
post). The page shows a "for sale" box with a link to the listing. Once it's sold, switch it to
`sold` rather than deleting the file, so the history stays.

`tags:` are free-form, e.g. `[ultra-portable, 1960s, script]`. Every tag used anywhere shows up
as a filter automatically. To add a new status, add it to `_data/statuses.yml`
(and optionally give it a badge colour in `assets/css/style.css` as `.status-<key>`).

## Shareable links

The gallery keeps its filters in the URL, so you can link straight to a view:

- `…/typewriters/?status=for-sale`: everything currently for sale
- `…/typewriters/?tag=ultra-portable`: just the ultra-portables
- `…/typewriters/?status=collection,for-sale,sold`: including sold machines
- `…/typewriters/?q=olivetti`: a search

## Previewing locally (optional)

Requires Ruby. Then:

```
bundle install
bundle exec jekyll serve
```

and open http://localhost:4000/typewriters/
