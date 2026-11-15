# Bundles the three web fonts used by the studio into `src/ui/styles/fonts/`.

The studio used to load Cairo / Inter / JetBrains Mono from `fonts.googleapis.com` at runtime,
which means **no network → no fonts** (and a render-blocking third-party request even when the
desktop app is fully offline capable). This script makes the fonts first-class app assets.

All three families are licensed under the SIL Open Font License 1.1, which allows bundling and
redistribution inside an application.

## Run

```powershell
cd app
node scripts/bundle-fonts.mjs
```

The script is idempotent: it rewrites `src/ui/styles/fonts.css` and only downloads files that are
not already present.

## What it does

1. Requests the Google Fonts CSS2 endpoint with a modern Chrome user-agent so the response is
   `woff2` + `unicode-range` subsets (latin, latin-ext, arabic, ...).
2. Downloads every referenced `.woff2` into `src/ui/styles/fonts/`.
3. Rewrites the `src: url(...)` entries to relative `./fonts/<sha>.woff2` paths and writes the
   result to `src/ui/styles/fonts.css`, which `main.ts` imports.
4. Preserves `unicode-range` so Arabic and Latin still pick the correct subset glyphs.

The font URLs are content-addressed by a hash of the URL, so re-running with an unchanged upstream
CSS produces no churn.

## Verifying it worked

```powershell
cd app
npm run build
```

`dist/index.html` must contain no `fonts.googleapis.com` / `fonts.gstatic.com` reference, and
`dist/assets/` must contain `.woff2` files.
