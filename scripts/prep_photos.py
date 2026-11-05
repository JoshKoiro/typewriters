#!/usr/bin/env python3
"""
Prepare typewriter photos for the website.

For every image in the input folder (default: originals/), this script:
  1. Rotates it upright using the camera's orientation tag (so nothing ends up sideways),
  2. Resizes it so the LONGER side is at most 2000 px (smaller images are never enlarged),
  3. Strips ALL metadata (EXIF, GPS location, camera/phone model, timestamps, XMP, comments),
  4. Saves it into the matching folder under photos/ with a web-safe file name.

The folder structure is preserved, so put each machine's originals in a folder named after
its slug (the machine's file name in _machines/ without .md):

    originals/1947-smith-corona-sterling/IMG_4821.HEIC
      -> photos/1947-smith-corona-sterling/img_4821.jpg

Only the colour profile (ICC) is kept, because it affects how colours display and contains
nothing about you, your device or your location.

Usage (run from the repo root):
    pip install pillow pillow-heif      # pillow-heif is only needed for iPhone .HEIC photos
    python scripts/prep_photos.py                 # originals/ -> photos/
    python scripts/prep_photos.py --force         # re-process files that already exist
    python scripts/prep_photos.py SRC DEST --max 2000 --quality 90
"""

import argparse
import re
import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    sys.exit("Pillow is required:  pip install pillow")

try:
    from pillow_heif import register_heif_opener  # optional, for .heic/.heif
    register_heif_opener()
    HEIF = True
except ImportError:
    HEIF = False

INPUT_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".heic", ".heif"}


def web_name(path: Path) -> str:
    """Lowercase, spaces -> hyphens, drop anything unusual. Keeps names URL-friendly."""
    stem = path.stem.lower()
    stem = re.sub(r"\s+", "-", stem)
    stem = re.sub(r"[^a-z0-9._-]", "", stem) or "photo"
    return stem


def clean_copy(img: Image.Image) -> Image.Image:
    """Return a new image containing only pixel data: no EXIF, GPS, XMP, text chunks etc."""
    return Image.frombytes(img.mode, img.size, img.tobytes())


def process(src: Path, dest: Path, max_side: int, quality: int) -> tuple[Path, int, int]:
    with Image.open(src) as img:
        icc = img.info.get("icc_profile")
        img = ImageOps.exif_transpose(img)  # apply rotation BEFORE the orientation tag is dropped

        # Decide the output format: keep PNGs (and anything with transparency) as PNG,
        # everything else becomes JPEG.
        has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
        as_png = src.suffix.lower() == ".png" or has_alpha

        if as_png:
            img = img.convert("RGBA" if has_alpha else "RGB")
        else:
            img = img.convert("RGB")

        if max(img.size) > max_side:
            img.thumbnail((max_side, max_side), Image.LANCZOS)

        img = clean_copy(img)
        out = dest.with_suffix(".png" if as_png else ".jpg")
        out.parent.mkdir(parents=True, exist_ok=True)

        save_args = {"icc_profile": icc} if icc else {}
        if as_png:
            img.save(out, "PNG", optimize=True, **save_args)
        else:
            img.save(out, "JPEG", quality=quality, optimize=True, progressive=True, **save_args)
        return out, img.width, img.height


def main() -> None:
    repo = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(description="Resize photos and strip their metadata for the website.")
    ap.add_argument("src", nargs="?", default=repo / "originals", type=Path, help="input folder (default: originals/)")
    ap.add_argument("dest", nargs="?", default=repo / "photos", type=Path, help="output folder (default: photos/)")
    ap.add_argument("--max", type=int, default=2000, help="longest side in pixels (default: 2000)")
    ap.add_argument("--quality", type=int, default=90, help="JPEG quality 1-95 (default: 90)")
    ap.add_argument("--force", action="store_true", help="re-process images that already exist in dest")
    args = ap.parse_args()

    if not args.src.is_dir():
        sys.exit(f"Input folder not found: {args.src}")

    files = sorted(p for p in args.src.rglob("*") if p.is_file() and p.suffix.lower() in INPUT_EXTS)
    if not files:
        sys.exit(f"No images found in {args.src}")

    done = skipped = failed = 0
    for src in files:
        rel = src.relative_to(args.src)
        if src.suffix.lower() in (".heic", ".heif") and not HEIF:
            print(f"  SKIP  {rel}  (install pillow-heif to read HEIC photos)")
            failed += 1
            continue

        dest_base = args.dest / rel.parent / web_name(src)
        existing = [dest_base.with_suffix(e) for e in (".jpg", ".png") if dest_base.with_suffix(e).exists()]
        if existing and not args.force:
            skipped += 1
            continue

        try:
            out, w, h = process(src, dest_base, args.max, args.quality)
            print(f"  OK    {rel}  ->  {out.relative_to(args.dest.parent)}  ({w}x{h})")
            done += 1
        except Exception as e:  # keep going if one file is bad
            print(f"  FAIL  {rel}: {e}")
            failed += 1

    print(f"\n{done} processed, {skipped} already done (use --force to redo), {failed} failed.")


if __name__ == "__main__":
    main()
