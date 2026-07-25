# The vilan website

The promo site for [vilan](https://github.com/vilan-lang/vilan) — built with
vilan itself, as a fullstack workspace in the render-then-replace SSR shape.

## Layout

- **`common/`** — the shared `fun page(): View` both legs build, plus its
  `std::style` styles. It imports `std::ui`, which resolves per platform: live
  DOM in the client build, an HTML string tree in the server build.
- **`server/`** — the node package. Renders `page()` to markup, splices it into
  `server/src/app.html` at the `<!--ssr-->` marker, and serves the page plus the
  client bundle and stylesheet. The page arrives fully painted (first paint, SEO).
- **`client/`** — the browser package. `mount_root` clears the server markup on
  boot and mounts the same page as live DOM.

## Develop

```sh
vilan run .            # build everything and serve http://localhost:3000/
vilan run . --watch    # the dev loop: rebuild + HMR on save
vilan build .          # compile only (dist/client.js, dist/client.css, dist/server.js)
vilan fmt              # format the sources
```
