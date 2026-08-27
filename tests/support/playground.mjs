// Boots the real `dist/playground.js` — the bundle the deploy copies to
// vilan-lang.org — under the DOM stub, with the vendored editor bundle stood
// in for.
//
// What is stubbed and why: `playground/editor.js` is CodeMirror plus a Worker
// lifecycle plus a live iframe, none of which node has. It is the HOST from
// `src/playground.vl`'s point of view — the entry declares it as `external`,
// exactly as it declares `document` — so standing it in leaves the code under
// test (the compiled `src/playground.vl`) entirely real. Every event this
// harness feeds is one the bundle genuinely emits, in the order it emits them.

import { installDom } from "./dom.mjs";

/// Boots the page and returns the handles to drive it.
export async function bootPlayground({ bundle }) {
	const dom = installDom(["app"]);

	const calls = { runProgram: [], clearProgram: 0, setMode: [], compile: [], setDoc: [] };
	let onCompilerEvent = null;
	let document_ = "let count = Signal::new(0)\n";

	globalThis.VilanPlayground = {
		init: (_selector, doc) => {
			document_ = doc;
		},
		value: () => document_,
		setDoc: (text) => {
			calls.setDoc.push(text);
			document_ = text;
		},
		example: (name) => `// example ${name}\n`,
		startCompiler: (handler) => {
			onCompilerEvent = handler;
		},
		compile: (source) => {
			calls.compile.push(source);
			return true;
		},
		format: () => true,
		share: () => {},
		setMode: (platform) => calls.setMode.push(platform),
		runProgram: (...args) => calls.runProgram.push(args),
		clearProgram: () => {
			calls.clearProgram += 1;
		},
	};

	await import(bundle);
	if (!onCompilerEvent) throw new Error("the page never called startCompiler");

	return {
		calls,
		/// One event from the compile worker, as `startCompiler`'s callback
		/// receives it. Missing fields read `undefined`, which is exactly what
		/// the real event objects give for the fields their kind does not
		/// carry.
		compilerEvent: (event) => onCompilerEvent(event),
		/// The page as rendered: every text the mounted tree contains.
		texts: () => dom.mount("app").texts(),
		/// True when `needle` is somewhere on the rendered page.
		shows: (needle) => dom.mount("app").texts().includes(needle),
		messageListeners: () => dom.listenerCount("message"),
		/// A `message` event arriving at the page's own window. A test supplies
		/// the whole event, so it can present any `data`, `origin` or `source`
		/// a hostile document could.
		postMessage: (event) => dom.dispatch("message", event),
	};
}

/// The boot sequence the vendored bundle really performs: the worker comes up
/// ("ready"), the initial document settles ("doc"), and the page auto-runs.
/// Returns nothing; the page is left waiting for a compile result.
export function bootCompiler(page, { version = "0.0.0-test", canFormat = true, canPlatform = true } = {}) {
	page.compilerEvent({ kind: "ready", version, canFormat, canPlatform });
	page.compilerEvent({ kind: "doc" });
}

/// A successful browser compile — the event that makes the page mount a
/// program in the runner iframe.
export function compileSucceeded(page, { version = "0.0.0-test", js = "// program\n", css = "" } = {}) {
	page.compilerEvent({
		kind: "result",
		version,
		ok: true,
		platform: "browser",
		js,
		css,
		diagnostics: [],
	});
}
