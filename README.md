# The vilan website

The promo site for [vilan](https://github.com/vilan-lang/vilan) — built with
vilan itself: one fullstack package in the render-then-replace SSR shape.

## Layout

One package, two entries. Every file is visible to both entries; the compiler
sorts out what may run where by what each entry reaches.

- **`src/page.vl`** — the one `fun page(): View` both entries build, plus its
  `std::style` styles. It imports `std::ui`, which resolves per entry platform:
  live DOM in the client build, an HTML string tree in the server build.
- **`src/server.vl`** — the node entry. Renders `page()` to markup, splices it
  into `src/app.html` at the `<!--ssr-->` marker, and serves the page plus the
  client bundle and stylesheet. The page arrives fully painted (first paint, SEO).
- **`src/client.vl`** — the browser entry. `mount_root` clears the server markup
  on boot and mounts the same page as live DOM.

## Develop

You need the `vilan` CLI on your PATH — grab it from the
[install instructions](https://vilan-lang.org/#install) or
`brew install vilan-lang/vilan/vilan`.

```sh
vilan run .            # build both entries and serve http://localhost:3000/
vilan run . --watch    # the dev loop: rebuild + HMR on save
vilan build .          # compile only (dist/client.js, dist/client.css, dist/server.js)
vilan fmt              # format the sources
```

## Deploy

vilan-lang.org serves a static export of this site from the
[vilan-lang.github.io](https://github.com/vilan-lang/vilan-lang.github.io)
repository: the server-rendered markup is captured as `index.html` and copied
over together with `dist/client.js` and `dist/client.css`. Every push to
`main` does this automatically. [deploy.yml](.github/workflows/deploy.yml)
builds the toolchain from source, renders the page, and commits the export to
the pages repository, touching only those three files (`docs/` and `assets/`
there belong to other flows). The push authenticates with a write deploy key
on the pages repository, stored as this repository's `PAGES_DEPLOY_KEY`
secret. Redeploy by hand with `gh workflow run deploy.yml -R
vilan-lang/website`.

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
