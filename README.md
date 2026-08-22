# The vilan website

The promo site for [vilan](https://github.com/vilan-lang/vilan) — built with
vilan itself: one fullstack package in the render-then-replace SSR shape.

## Layout

One package, four entries. Every file is visible to every entry; the compiler
sorts out what may run where by what each entry reaches.

- **`src/page.vl`** — the one `fun page(): View` the landing entries build, plus
  its `std::style` styles. It imports `std::ui`, which resolves per entry
  platform: live DOM in the client build, an HTML string tree in the server build.
- **`src/server.vl`** — the node entry, at rung 2 of the full-stack ladder.
  Each page's HTML document is written from its leg's build (`Document::of`) —
  the stylesheet link, the module script and the mount div are derived, so they
  cannot disagree with the artifacts `serve_build` serves — and everything the
  build cannot know (theme metas, icons, social cards, fonts, each page's frame
  rules, the playground's vendored scripts) rides the `head()`/`body()`
  hatches. There are no HTML shells and no `<!--ssr-->` marker:
  `Document::render(view)` splices the server render inside the mount element
  by construction. The pages arrive fully painted (first paint, SEO).
- **`src/client.vl`** — the landing page's browser entry. `mount_root` clears
  the server markup on boot and mounts the same page as live DOM.
- **`src/topbar.vl`** — the sticky toolbar every surface wears (the landing
  page, the playground, and the book); its own module so a leg that wants only
  the bar reaches only the bar's rules. **`src/chrome.vl`** is the node entry
  that exports it for the book: `node dist/chrome.mjs <dir>` renders `top_bar`
  through the same SSR path the server uses and writes `<dir>/header.html`
  (the `<nav>`, one root element, nothing around it) and `<dir>/header.css`
  (the chrome leg's own emitted stylesheet — exactly the rules the bar
  reaches). Every colour in it is a `var(--role)`; the `:root` values it
  declares (dark, and light behind `prefers-color-scheme`) sit at
  specificity (0,1,0), so a host that declares the same roles on
  `html.light` / `html.navy` (the book) re-themes the bar to itself. The
  pages repo's README states the contract in full.
- **`src/theme.vl`** — the tokens. Each is one custom property with two
  values: dark at `:root` (the default) and light behind
  `@media (prefers-color-scheme: light)` — the site follows the OS; it has no
  picker of its own. The light column is `design-language.md` §2.5. The
  section art (`src/art.vl`) is composed on the roles too, so each piece is a
  light composition in light and renders as drawn in dark; only the bloom's
  own glows and the plum/violet/scarlet marks stay literal (the art's header
  says which and why), and the two values the roles don't name — the art's
  shadow and its diagnostic red — are tokens with both values. The hero is
  the one fenced exception: the bloom is the same art in both themes.
- **`src/playground.vl`** + **`src/playground_page.vl`** — the /playground
  page: the compiler itself, compiled to WebAssembly, compiles and runs
  visitor programs in the browser (no server anywhere). The page is vilan like
  the rest of the site; the pieces vilan cannot express live in
  `playground/` — the compile worker (`worker.js`), and a vendored CodeMirror 6
  bundle (`editor.js`, built once from `editor-src/` and committed) that also
  carries the worker lifecycle, the completion source (the compiler's own
  engine, through the wasm's `complete` export), and the sandboxed per-Run
  iframe. Seeded
  examples are the `playground/examples/*.vl` files, shipped as the generated
  `examples.js` (`node scripts/gen-examples.mjs` after editing one).

## Develop

You need the `vilan` CLI on your PATH — grab it from the
[install instructions](https://vilan-lang.org/#install) or
`brew install vilan-lang/vilan/vilan`.

```sh
vilan run .            # build every entry and serve http://localhost:3000/
vilan run . --watch    # the dev loop: rebuild + HMR on save
vilan build .          # compile only (dist/client.js, dist/client.css, dist/server.mjs, dist/playground.*)
vilan fmt              # format the sources
```

The playground needs its wasm compiler once per release:

```sh
sh scripts/fetch-wasm.sh
```

That downloads the `vilan-playground-wasm.tar.gz` release asset into
`playground/wasm/` (gitignored). Without it the site still builds and serves —
the playground page just reports the compiler missing. Gate the playground
pieces the way the deploy does:

```sh
node scripts/smoke-playground.mjs
```

## Deploy

vilan-lang.org serves a static export of this site from the
[vilan-lang.github.io](https://github.com/vilan-lang/vilan-lang.github.io)
repository: each server-rendered page is captured as its `index.html` and
copied over together with its bundles — the landing trio at the root, the
playground set (page, bundles, wasm compiler) under `playground/`, and the
chrome pair (`header.html` + `header.css`, the masthead for the book) under
`chrome/`. Every push to `main` does this automatically.
[deploy.yml](.github/workflows/deploy.yml)
installs the toolchain from the latest release, downloads the playground's
wasm from the same release, smoke-compiles every seeded example against it,
renders the pages and the chrome export, and commits them to the pages
repository, touching only the allowlisted files (`docs/` and `assets/` there
belong to other flows; that repo's `docs.yml` copies `chrome/header.html` into
the book's theme before each build). The push authenticates as the
vilan-site-deploy GitHub App (contents read-write on the pages repository
only), whose id and private key live in this repository's `DEPLOY_APP_ID`
and `DEPLOY_APP_PRIVATE_KEY` secrets. Redeploy by hand with
`gh workflow run deploy.yml -R vilan-lang/website`.

## License

Licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))
- MIT license ([LICENSE-MIT](LICENSE-MIT))

at your option.

The Vilan logo, wordmark, and the other brand assets this site displays are
excluded from the above: all rights to them are reserved, per the
[brand assets license](https://github.com/vilan-lang/vilan/blob/main/assets/branding/LICENSE).
They are served from vilan-lang.org/assets and are not part of this
repository. The brand system itself (palette, type, layout) lives in a
private design upstream; this site consumes only its baked values.

Unless you explicitly state otherwise, any contribution intentionally
submitted for inclusion in the work by you, as defined in the Apache-2.0
license, shall be dual licensed as above, without any additional terms or
conditions.
