// The editor restores a visitor's buffer from localStorage — and that buffer
// can be OUR old example, seeded on an earlier visit and never touched. After
// v0.42.0 renamed a source's `.map` to `.derive`, every returning visitor who
// had once opened the counter got the old counter back, broken, while the
// shipped examples all compiled clean (K25). The vendored bundle now swaps a
// restored buffer that is verbatim a retired example for the current one;
// this holds that, against the COMMITTED `src/playground/editor.js` and
// `src/playground/examples.js` — the generated files the deploy ships, so a
// bundle that was not rebuilt fails here.

import { readFileSync } from "node:fs";
import { installDom } from "./support/dom.mjs";
import { check, verdict } from "./support/check.mjs";

installDom(["runner"], { vendored: true });
let stored = null;
globalThis.localStorage = {
	getItem: () => stored,
	setItem: (_key, value) => {
		stored = value;
	},
};
await import(new URL("../src/playground/examples.js", import.meta.url).href);
await import(new URL("../src/playground/editor.js", import.meta.url).href);

const bundle = globalThis.VilanPlayground;
const examples = globalThis.VILAN_EXAMPLES;
check(typeof bundle?.restoredDoc === "function", "the bundle exports restoredDoc");
check(Object.keys(globalThis.VILAN_RETIRED_EXAMPLES ?? {}).length > 0, "examples.js carries the retired record");

const fallback = "// the default doc\n";

stored = null;
check(bundle.restoredDoc(fallback) === fallback, "nothing saved: the default doc");

// The counter as v0.41 shipped it — the one buffer K25 was about. It is the
// counter v0.42.0 and v0.43.0 shipped (spelled out here, since the current
// example has moved on since: the prelude's idiom, element syntax) with the
// one line v0.42.0 renamed. Both are in the retired record.
const shipped = "// A reactive counter: the signal is the state, the bindings follow it.\n// Change the label, add a second button \u2014 then press Run.\n\nimport std::reactive::Signal;\nimport std::ui::{ mount_root, view };\n\nfun main() {\n\tmount_root(\"app\", || {\n\t\tlet count = Signal::new(0);\n\t\tview(\"div\")\n\t\t\t.child(view(\"h2\").text(\"Counter\"))\n\t\t\t.child(view(\"button\").text(\"+1\").on(\"click\", || count.set(count.get() + 1)))\n\t\t\t.child(view(\"p\").bind_text(count.derive(|n| i\"clicked {n} times\")))\n\t});\n}\n";
const counter = examples.counter;
const old = shipped.replace("count.derive(|n| i\"clicked {n} times\")", "count.map(|n| i\"clicked {n} times\")");
check(old !== shipped, "the v0.41 counter differs from the v0.42 one by the renamed call");
stored = old;
check(bundle.restoredDoc(fallback) === counter, "a saved, untouched v0.41 counter opens as the current counter");
stored = shipped;
check(bundle.restoredDoc(fallback) === counter, "a saved, untouched v0.42 counter opens as the current counter");

stored = `${old}// mine\n`;
check(bundle.restoredDoc(fallback) === stored, "an edited buffer is the visitor's program, restored as it was");

stored = counter;
check(bundle.restoredDoc(fallback) === counter, "a current example restores as itself");

stored = "fun main() {}\n";
check(bundle.restoredDoc(fallback) === stored, "any other program restores as itself");

// A retired example whose name is no longer seeded falls back to the default.
const saved = globalThis.VILAN_EXAMPLES;
globalThis.VILAN_EXAMPLES = { ...saved, counter: undefined };
stored = old;
check(bundle.restoredDoc(fallback) === fallback, "a retired example that is no longer seeded opens on the default doc");
globalThis.VILAN_EXAMPLES = saved;

// The committed record itself: fingerprint → the example it was.
const record = JSON.parse(readFileSync(new URL("../playground/retired-examples.json", import.meta.url), "utf8"));
check(
	Object.values(record).every((name) => typeof name === "string" && name.length > 0),
	"playground/retired-examples.json maps fingerprints to example names",
);

verdict("playground restore");
