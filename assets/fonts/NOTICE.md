# Third-party fonts

## CommitMono V143 — `commit-mono-v143.woff2`

The code face for every vilan surface, ratified in
[design-language.md](https://github.com/vilan-lang/vilan) §2.3.

- **Font**: CommitMono, version **1.143** (the family names itself
  `CommitMonoV143`; the shipped file is the *variable* font, axes `wght`
  200–700 and `ital` 0–1).
- **Author**: Eigil Nikolajsen — <https://commitmono.com>,
  <https://github.com/eigilnikolajsen/commit-mono>
- **License**: SIL Open Font License, Version 1.1 —
  <https://scripts.sil.org/OFL> (the license text is embedded in the font's
  own `name` table, IDs 13 and 14).
- **Provenance**: copied byte-for-byte from the designated reference copy,
  `client/src/public/font/CommitMono-VariableFont.woff2` on the `kolt`
  repository's `visual-overhaul-2` branch, and renamed to this repository's
  `<family>-<version>.woff2` convention. The two web estates deliberately
  serve the same file.

The OFL permits bundling and redistribution; it forbids selling the font on
its own and requires that any *modified* version be renamed. This file is
unmodified, so the original name is kept.

### Deploying it

This file is **staged here, not served from here**. The site's `@font-face`
rules (`src/app.html`, `src/playground.html`) load it from
`https://vilan-lang.org/assets/fonts/commit-mono-v143.woff2`, alongside
`inter-latin.woff2` and `vilan-display-600-latin.woff2` — and that `assets/`
tree lives in the
[vilan-lang.github.io](https://github.com/vilan-lang/vilan-lang.github.io)
pages repository, which this repository's deploy explicitly does **not**
touch (`docs/` and `assets/` there belong to other flows).

So shipping the face is one manual step, done once: copy this file to
`assets/fonts/commit-mono-v143.woff2` in the pages repository and commit it
there. Until that lands, every code surface falls back to the next family in
`code_face` (`ui-monospace`, then the platform mono) and the site is
otherwise unaffected.
