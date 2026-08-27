// The other half of the console's admission rule, in the vendored bundle:
// `playground/editor.js` must actually splice the page's Run token into the
// frame it starts, or the page would hold a secret nobody quotes and every
// line of real program output would be dropped.
//
// This drives the COMMITTED, minified `playground/editor.js` — the file the
// deploy copies to the site, not `editor-src/editor.mjs` — because that file is
// generated, and the failure worth catching is the one where it was not
// regenerated. CodeMirror reads a few document members at import time, which is
// what `vendored: true` supplies; nothing the assertions touch is stubbed.

import { installDom } from "./support/dom.mjs";
import { check, verdict } from "./support/check.mjs";

const dom = installDom(["runner"], { vendored: true });
await import(new URL("../playground/editor.js", import.meta.url).href);

const bundle = globalThis.VilanPlayground;
check(typeof bundle?.runProgram === "function", "the bundle exports runProgram");

const runner = dom.mount("runner");
const token = "11111111-2222-4333-8444-555555555555";
bundle.runProgram("console.log(\"hi\")", ".app{color:red}", token);

check(runner.children.length === 1, "a Run mounts exactly one frame");
const frame = runner.children[0];
check(frame.tagName === "iframe", "the program is mounted in an iframe");
check(
	frame.attributes.sandbox === "allow-scripts",
	"the frame is sandboxed to scripts only — no allow-same-origin, which is why its origin is opaque and an origin check cannot identify it",
);

const srcdoc = frame.srcdoc ?? "";
check(srcdoc.includes(`var token = "${token}";`), "the bootstrap carries the page's Run token");
check(srcdoc.includes("parent.postMessage({ token: token,"), "every forwarded line quotes the token back");
check(srcdoc.includes('console.log("hi")'), "the program's js is in the document");
check(srcdoc.includes(".app{color:red}"), "the program's css is in the document");

// A second Run replaces the frame rather than accumulating them, so the old
// frame's token dies with the document that held it.
bundle.runProgram("console.log(\"again\")", "", "99999999-8888-4777-8666-555555555555");
check(runner.children.length === 1, "a second Run replaces the frame, it does not add one");
check(
	(runner.children[0].srcdoc ?? "").includes('var token = "99999999-8888-4777-8666-555555555555";'),
	"the replacement frame carries the new token",
);

// The token is spliced into a `<script>` body. A caller that could put markup
// there would hand an attacker the frame, so the bundle refuses rather than
// trusting the page.
for (const [label, bad] of [
	["a token closing the script tag", '</script><script>fetch("//evil")</script>'],
	["a token with a quote in it", '11111111-"-4333-8444-555555555555'],
	["an empty token", ""],
	["no token at all", undefined],
]) {
	let refused = false;
	try {
		bundle.runProgram("console.log(1)", "", bad);
	} catch {
		refused = true;
	}
	check(refused, `runProgram refuses ${label}`);
}
check(runner.children.length === 1, "a refused Run leaves the previous frame standing");

verdict("playground runner");
