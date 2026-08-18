# The vilan website

The promo site for [vilan](https://github.com/vilan-lang/vilan) — built with
vilan itself: one fullstack package in the render-then-replace SSR shape.

## Layout

One package, three entries. Every file is visible to every entry; the compiler
sorts out what may run where by what each entry reaches.

- **`src/page.vl`** — the one `fun page(): View` the landing entries build, plus
  its `std::style` styles. It imports `std::ui`, which resolves per entry
  platform: live DOM in the client build, an HTML string tree in the server build.
- **`src/server.vl`** — the node entry. Renders each page to markup, splices it
  into its shell (`src/app.html`, `src/playground.html`) at the `<!--ssr-->`
  marker, and serves the pages plus every bundle and asset. The pages arrive
  fully painted (first paint, SEO).
- **`src/client.vl`** — the landing page's browser entry. `mount_root` clears
  the server markup on boot and mounts the same page as live DOM.
- **`src/playground.vl`** + **`src/playground_page.vl`** — the /playground
  page: the compiler itself, compiled to WebAssembly, compiles and runs
  visitor programs in the browser (no server anywhere). The page is vilan like
  the rest of the site; the pieces vilan cannot express live in
  `playground/` — the compile worker (`worker.js`), and a vendored CodeMirror 6
  bundle (`editor.js`, built once from `editor-src/` and committed) that also
  carries the worker lifecycle and the sandboxed per-Run iframe. Seeded
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
playground set (page, bundles, wasm compiler) under `playground/`. Every push
to `main` does this automatically. [deploy.yml](.github/workflows/deploy.yml)
installs the toolchain from the latest release, downloads the playground's
wasm from the same release, smoke-compiles every seeded example against it,
renders the pages, and commits the export to the pages repository, touching
only the allowlisted files (`docs/` and `assets/` there belong to other
flows). The push authenticates as the
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
