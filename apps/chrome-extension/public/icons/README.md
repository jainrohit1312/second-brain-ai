# Extension icons

**These four PNGs are generated placeholders, and they are committed.**
`manifest.json` references all four sizes, and CRXJS refuses to build when a manifest
asset is missing — `Could not load manifest asset "icons/icon-16.png"` — so a repository
without them cannot produce a loadable `dist/`. They are deliberately plain: a rounded
accent tile with a ring. Replace them with real artwork before any release.

## Files

| File           | Size (px) | Referenced by                  | Purpose                                             |
| -------------- | --------- | ------------------------------ | --------------------------------------------------- |
| `icon-16.png`  | 16 × 16   | `icons`, `action.default_icon` | Favicon-sized; extension menu and toolbar fallback. |
| `icon-32.png`  | 32 × 32   | `icons`, `action.default_icon` | Toolbar button on HiDPI displays, Windows taskbar.  |
| `icon-48.png`  | 48 × 48   | `icons`                        | `chrome://extensions` card.                         |
| `icon-128.png` | 128 × 128 | `icons`                        | Install dialog, Chrome Web Store listing.           |

All four are RGBA PNGs with a transparent margin. Chrome does not read `icon-24.png` or
`icon-96.png` here because the manifest does not declare them, so do not add them without
also editing `manifest.json`.

## Regenerating the placeholders

```bash
cd apps/chrome-extension
node scripts/generate-placeholder-icons.mjs
```

The script writes all four sizes and reads each one back to confirm the PNG header
reports the size it asked for — a hand-rolled encoder is exactly the kind of code that
writes a plausible-looking file no decoder will open. It needs nothing beyond Node.

## How they reach the build

Vite copies everything under `public/` verbatim into `dist/`, so a file at
`apps/chrome-extension/public/icons/icon-16.png` ends up at
`dist/icons/icon-16.png`, which is exactly the path the manifest uses (manifest paths are
relative to the extension root, i.e. `dist/`).

```bash
pnpm --filter @second-brain/chrome-extension build
# then load dist/ unpacked
```

## Replacing them with real artwork

Keep one design source (SVG or a 512 × 512 master) outside this directory and export the
four sizes over these filenames. Never hand-edit a PNG to fake a missing size — a scaled
128 px copy registered as 16 px renders as a blurry block in the toolbar.
