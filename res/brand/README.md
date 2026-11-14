# Buzzar brand assets

| File | What | Use |
|---|---|---|
| `icon.svg` / `icon-512.png` | Bee on the purple circle (#7000FF) | Favicon, app icon, avatars. Same as `res/svg/logo.svg`. |
| `banner-purple.svg` / `.png` | White wordmark on a purple rounded banner | GitHub README banner, social cards |
| `wordmark-black.svg` / `.png` | Bee + "buzzar", black on transparent | Light backgrounds. Same as `res/svg/logo-full.svg` (splash, landing nav). |
| `wordmark-white.svg` / `.png` | Bee + "buzzar", white on transparent | Dark or coloured backgrounds |

Brand purple: `#7000FF` (inherited from Third Room's logo).

The wordmark letters are Noto Sans Bold (SIL Open Font License 1.1) converted to outlines, so no font is needed to
display them. Regenerate the SVGs with:

```
python -m venv .venv && .venv/bin/pip install fonttools
.venv/bin/python scripts/buzzar/make-wordmark.py res/brand
cp res/brand/wordmark-black.svg res/svg/logo-full.svg
```

PNG exports were made with ImageMagick, e.g. `magick -background none -density 600 banner-purple.svg -resize 1280x banner-purple.png`.

Third Room's original logos are kept in `res/svg/thirdroom-logo.svg`, `res/svg/thirdroom-logo-full.svg` and
`docs/assets/logo.png`.
