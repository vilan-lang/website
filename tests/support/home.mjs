// Boots the real `dist/client.js` — the landing page the deploy ships — under
// the DOM stub, and reads back what it rendered.
//
// The landing page's `main` probes a few host members after it mounts (the
// scroll position, `prefers-reduced-motion`, the reveal targets, the glow
// grid); those are the browser's, so they are stood in for here — with
// reduced motion ON, which is the branch that touches the fewest of them.
// The page itself runs unmodified.

import { pathToFileURL } from "node:url";
import { installDom } from "./dom.mjs";

/// Every element in `node`'s subtree (itself included), in document order.
export function walk(node, into = []) {
	into.push(node);
	for (const child of node.children) walk(child, into);
	return into;
}

/// A `<pre>` code panel's text, one string per rendered line: each line is a
/// `div` of token spans (src/code.vl's `ln`), and an empty line renders as a
/// single space (`blank`), so trailing whitespace is not part of the text.
export function panelLines(pre) {
	return pre.children.map((line) => line.texts().join("").trimEnd());
}

/// A panel's lines as the program a visitor would paste. The panels indent
/// with four spaces; the compiler's own files (and `vilan fmt`) use tabs, and
/// a diagnostic's column counts a tab as one — so each leading run of four
/// spaces goes back to the tab it stands for.
export function programOf(lines) {
	return `${lines.map((line) => line.replace(/^(?: {4})+/, (run) => "\t".repeat(run.length / 4))).join("\n")}\n`;
}

export async function bootHome(bundle) {
	const dom = installDom(["app"]);
	const probe = {
		scrollTop: 0,
		clientHeight: 800,
		style: { setProperty() {} },
		getBoundingClientRect: () => ({ top: 0, left: 0 }),
		addEventListener() {},
	};
	globalThis.document.querySelector = () => probe;
	globalThis.document.querySelectorAll = () => [];
	globalThis.window.matchMedia = () => ({ matches: true });

	await import(pathToFileURL(bundle).href);
	const app = dom.mount("app");
	return {
		app,
		/// Every `<pre>` on the page, as its lines.
		pres: () =>
			walk(app)
				.filter((node) => node.tagName === "pre")
				.map(panelLines),
	};
}
