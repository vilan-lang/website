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

```sh
vilan run .            # build both entries and serve http://localhost:3000/
vilan run . --watch    # the dev loop: rebuild + HMR on save
vilan build .          # compile only (dist/client.js, dist/client.css, dist/server.js)
vilan fmt              # format the sources
```
