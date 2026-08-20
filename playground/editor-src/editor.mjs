// The playground's vendored bundle: CodeMirror 6 plus the delivery machinery
// the page cannot express in vilan — the worker lifecycle (a Worker needs
// `new`), the per-Run sandboxed iframe (an srcdoc needs escaping), and the
// editor widget itself. Everything application-shaped (page state, what an
// event means) stays in src/playground.vl, which talks to this surface
// through `window.VilanPlayground`.
//
// Built once by build.mjs and COMMITTED as playground/editor.js — the site
// build stays npm-free and the page loads no CDN. Rebuild only to change
// this file or bump CodeMirror: cd playground/editor-src && npm install &&
// npm run build.

import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentUnit, StreamLanguage, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
// `closeBrackets` is the only reason this package is here — bracket closing
// ships inside @codemirror/autocomplete even though it is not completion. The
// completion half of K9 is deliberately NOT wired: the wasm compiler exports
// `compile`, `compile_for`, `format` and `version` and nothing else (see
// playground/wasm/<version>/vilan_wasm.js; `CompileResult` carries js, css and
// diagnostics), so there is no analyzer surface for a completion source to
// ask. A keyword list hand-typed here would be a language feature invented on
// the website side, which is the wrong side of the fence. `autocompletion` is
// never imported, so esbuild drops the whole completion machinery — the
// shipped bundle pays nothing for the unused half. When vilan-wasm grows a
// `complete(source, offset)` export, it plugs in exactly where `scheduleCheck`
// already round-trips this worker.
import { closeBrackets } from "@codemirror/autocomplete";
import { setDiagnostics, lintGutter } from "@codemirror/lint";
import { tags } from "@lezer/highlight";
import { decodeBase64Url, deflate, encodeBase64Url, inflate } from "../codec.js";

// --- the vilan mode: a stream tokenizer, enough for the pane to read as
// --- vilan (the real grammar lives in the compiler; this is presentation)

const KEYWORDS = new Set([
	"async", "await", "borrows", "const", "else", "enum", "export", "external",
	"for", "fun", "if", "impl", "import", "in", "is", "jump", "let", "macro",
	"match", "mod", "mut", "own", "resource", "ret", "struct", "trait", "type",
	"use", "with",
]);

const ATOMS = new Set(["true", "false", "null"]);

// Tokenizes with a mode stack so an i-string's `{holes}` read as the code
// they are: string text stays rose, a hole's contents go back through the
// code rules, and the brace seams mark themselves. Attributes, function
// names, `::` paths and operators each get their own voice — the compiler
// owns the real grammar; this is presentation, resynced by eye against it.
const vilanLanguage = StreamLanguage.define({
	startState: () => ({ stack: [], afterFun: false }),
	token(stream, state) {
		const top = state.stack[state.stack.length - 1];

		// Inside a plain (or interpolated) string body.
		if (top && (top.mode === "str" || top.mode === "istr")) {
			const closer = top.triple ? '"""' : '"';
			let consumed = false;
			while (!stream.eol()) {
				if (stream.match(closer)) {
					state.stack.pop();
					return "string";
				}
				if (stream.peek() === "\\") {
					stream.next();
					stream.next();
					consumed = true;
					continue;
				}
				if (top.mode === "istr" && stream.peek() === "{") {
					if (consumed) return "string"; // flush the text, hole next call
					stream.next();
					state.stack.push({ mode: "hole", depth: 1 });
					return "hole";
				}
				stream.next();
				consumed = true;
			}
			return "string"; // an unterminated line degrades to string text
		}

		// Inside an interpolation hole: code rules, with brace bookkeeping.
		if (top && top.mode === "hole") {
			if (stream.peek() === "{") {
				stream.next();
				top.depth += 1;
				return "hole";
			}
			if (stream.peek() === "}") {
				stream.next();
				top.depth -= 1;
				if (top.depth === 0) state.stack.pop();
				return "hole";
			}
			return codeToken(stream, state);
		}

		return codeToken(stream, state);
	},
	tokenTable: {
		fn: tags.function(tags.variableName),
		def: tags.function(tags.definition(tags.variableName)),
		attr: tags.meta,
		hole: tags.special(tags.brace),
	},
});

// The code-mode rules, shared by top level and interpolation holes. A plain
// function: StreamLanguage does not preserve `this` for its spec methods.
function codeToken(stream, state) {
		if (stream.eatSpace()) return null;
		if (stream.match("//")) {
			stream.skipToEnd();
			return "comment";
		}
		// An attribute owns its line: `[derive(PartialEq)]`, `[extern(...)]`.
		// Only line-leading brackets read as one — `a[0]` never will.
		if (stream.peek() === "[" && stream.string.slice(0, stream.pos).trim() === "") {
			if (stream.match(/^\[[a-z_][^\]]*\]/)) return "attr";
		}
		if (stream.match('i"""')) {
			state.stack.push({ mode: "istr", triple: true });
			return "string";
		}
		if (stream.match('"""')) {
			state.stack.push({ mode: "str", triple: true });
			return "string";
		}
		if (stream.match('i"')) {
			state.stack.push({ mode: "istr", triple: false });
			return "string";
		}
		if (stream.match('"')) {
			state.stack.push({ mode: "str", triple: false });
			return "string";
		}
		if (stream.match(/^\d[\d_]*(\.[\d_]+)?([a-z][a-z0-9]*)?/)) {
			return "number";
		}
		if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)) {
			const word = stream.current();
			if (word === "fun") {
				state.afterFun = true;
				return "keyword";
			}
			if (KEYWORDS.has(word)) {
				state.afterFun = false;
				return "keyword";
			}
			if (ATOMS.has(word)) return "atom";
			if (state.afterFun) {
				state.afterFun = false;
				return "def";
			}
			if (/^[A-Z]/.test(word)) return "typeName";
			if (stream.match("(", false)) return "fn";
			if (stream.match("::", false)) return "namespace";
			return null;
		}
		if (stream.match(/^(=>|::|[+\-*\/%=!<>&|?]+)/)) {
			return "operator";
		}
		stream.next();
		return null;
}

// --- the look: theme.vl's palette, read out of CSS (K10) -------------------
//
// Not one value below is a colour. Every slot is a `--code-*` custom property
// minted by theme.vl's `code_palette` onto the playground page's root element,
// which this widget mounts inside — so the palette has exactly ONE home and a
// token edit re-themes the editor with no rebuild of this bundle. That is what
// ends the hand-sync src/code.vl used to concede.
//
// The names are EDITOR SLOTS, never site roles: which role plays "keyword", or
// what that role's value is, are both decisions inside theme.vl. Nothing here
// needs to know that a keyword is `primary`.
//
// No fallback values, on purpose: a fallback would be a second copy of the
// palette, which is the duplication being removed. The only way these
// properties go missing is the page's own stylesheet failing to load, and that
// takes the page with it.

const vilanTheme = EditorView.theme(
	{
		"&": {
			backgroundColor: "var(--code-bg)",
			color: "var(--code-plain)",
			height: "100%",
			fontSize: "var(--code-size)",
		},
		// CodeMirror's base theme puts `monospace` on the scroller, which would
		// beat anything inherited from the page, so the code face and its
		// ratified feature settings (§2.3) are claimed here — and claimed on
		// content and gutters too, so neither can be reached without the other.
		".cm-scroller, .cm-content, .cm-gutters": {
			fontFamily: "var(--code-face)",
			fontFeatureSettings: "var(--code-features)",
		},
		".cm-content": { caretColor: "var(--code-fg)" },
		".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--code-fg)" },
		// The editor fills whatever box the page gives it and scrolls INSIDE
		// it (the app shell never scrolls the page): height 100% above, and
		// the scroller owns the overflow.
		".cm-scroller": { overflow: "auto" },
		".cm-gutters": {
			backgroundColor: "var(--code-bg)",
			color: "var(--code-dim)",
			border: "none",
			borderRight: "1px solid var(--code-gutter-edge)",
		},
		// The line numbers breathe evenly: the base theme's 5px/3px insets are
		// what read lopsided, so the digit column gets the same 10px on both
		// sides. The lint gutter sits at the far edge (extension order below,
		// VS Code's own glyph-margin position), a fixed narrow strip, so it
		// reads as the window-edge inset rather than a hole between the
		// numbers and the code.
		".cm-lineNumbers .cm-gutterElement": { padding: "0 10px", minWidth: "34px" },
		".cm-gutter-lint": { width: "14px" },
		".cm-gutter-lint .cm-gutterElement": { padding: "0", paddingLeft: "3px" },
		".cm-activeLine": { backgroundColor: "var(--code-active-line)" },
		".cm-activeLineGutter": { backgroundColor: "var(--code-active-gutter)" },
		"&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
			{ backgroundColor: "var(--code-selection) !important" },
		// The squiggles wear the diagnostics pane's own semantic hues, so one
		// problem reads the same in the gutter, under the code, and in the list.
		".cm-lintRange-error": {
			backgroundImage: "none",
			textDecoration: "underline wavy var(--code-error) 1px",
		},
		".cm-lintRange-warning": {
			backgroundImage: "none",
			textDecoration: "underline wavy var(--code-caution) 1px",
		},
		// The gutter markers, redrawn as flat dots: CodeMirror's own are inline
		// SVGs with the colour baked into the data URI, which is precisely the
		// duplication K10 exists to remove.
		".cm-lint-marker": {
			content: "none",
			width: "8px",
			height: "8px",
			margin: "5px 0 0",
			borderRadius: "50%",
		},
		".cm-lint-marker-error": { backgroundColor: "var(--code-error)" },
		".cm-lint-marker-warning": { backgroundColor: "var(--code-caution)" },
		// A lint tooltip is the only thing this widget ever floats, so it is the
		// only thing that may cast a shadow (§2.2). Its severity edge is the
		// same 2px the diagnostics rows carry, in the same hues.
		".cm-tooltip": {
			backgroundColor: "var(--code-bg)",
			border: "1px solid var(--code-gutter-edge)",
			borderRadius: "6px",
			color: "var(--code-plain)",
			boxShadow: "0 8px 24px rgb(0 0 0 / 0.45)",
			overflow: "hidden",
		},
		".cm-diagnostic": { padding: "4px 8px", fontSize: "var(--code-size)" },
		".cm-diagnostic-error": { borderLeft: "2px solid var(--code-error)" },
		".cm-diagnostic-warning": { borderLeft: "2px solid var(--code-caution)" },
	},
	{ dark: true },
);

// Same story for the syntax colours: slots, filled by theme.vl. The one value
// with no role name is the callable tint — primary pulled toward the up ladder
// — and it is a token there rather than a literal here.
const vilanHighlight = HighlightStyle.define([
	{ tag: tags.keyword, color: "var(--code-keyword)" },
	{ tag: tags.atom, color: "var(--code-keyword)" },
	{ tag: tags.string, color: "var(--code-string)" },
	{ tag: tags.number, color: "var(--code-string)" },
	{ tag: tags.lineComment, color: "var(--code-comment)", fontStyle: "italic" },
	{ tag: tags.typeName, color: "var(--code-type)", fontWeight: "600" },
	{ tag: tags.function(tags.variableName), color: "var(--code-callable)" },
	{ tag: tags.function(tags.definition(tags.variableName)), color: "var(--code-callable)", fontWeight: "600" },
	{ tag: tags.meta, color: "var(--code-attr)", fontStyle: "italic" },
	{ tag: tags.special(tags.brace), color: "var(--code-keyword)" },
	{ tag: tags.namespace, color: "var(--code-path)" },
	{ tag: tags.operator, color: "var(--code-operator)" },
]);

// --- the editor ---

let view = null;

// --- share-via-fragment: the buffer IS the link -----------------------------
//
// `#code=<base64url(deflate-raw(source))>` — no server holds anything, and a
// fragment never reaches one in a request. Share writes the fragment and
// copies the full URL; a page opened with one loads it instead of the
// default example. The codec itself lives in ../codec.js — its ONE home
// (K15): esbuild inlines it here, and the book's harness carries a suite-
// pinned copy of the half it needs (see that file's header).

// `#code=<payload>` with optional `&mode=node` and `&v=<tag>` - a shared
// server-leg snippet opens straight into the check mode, and a pinned link
// (a bug repro above all) opens under the exact compiler that showed it.
function fragmentPayload() {
	const match = location.hash.match(/^#code=([A-Za-z0-9_-]+)(?:&mode=(node))?(?:&v=(v[0-9][0-9.]*))?$/);
	return match ? { payload: match[1], mode: match[2] ?? null, version: match[3] ?? null } : null;
}

function share() {
	(async () => {
		const source = view ? view.state.doc.toString() : "";
		const encoded = encodeBase64Url(await deflate(source));
		const mode = currentPlatform === "node" ? "&mode=node" : "";
		const pin = selectedVersion && currentVersion && selectedVersion !== currentVersion
			? `&v=${selectedVersion}`
			: "";
		const url = `${location.origin}${location.pathname}#code=${encoded}${mode}${pin}`;
		// window-qualified: bare `history` is CodeMirror's undo extension here.
		window.history.replaceState(null, "", url);
		let copied = false;
		try {
			await navigator.clipboard.writeText(url);
			copied = true;
		} catch {
			// No clipboard permission (or an insecure context): the address
			// bar still carries the link.
		}
		dispatch({ kind: "shared", copied });
	})();
}

// The buffer survives a reload: every edit lands in localStorage (debounced),
// and a fresh visit restores it. A shared link still wins; the seeded
// example is the last resort.
const STORAGE_KEY = "vilan-playground-doc";

function savedDoc() {
	try {
		return localStorage.getItem(STORAGE_KEY);
	} catch {
		return null; // storage denied (private mode); persistence just disarms
	}
}

let saveTimer = null;

function persist() {
	clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		try {
			localStorage.setItem(STORAGE_KEY, view.state.doc.toString());
		} catch {
			// see savedDoc
		}
	}, 400);
}

function init(selector, doc) {
	const host = document.querySelector(selector);
	if (!host) return;
	// A shared link wins over the restored buffer, which wins over the
	// default doc; a broken payload falls back down the same ladder.
	const fragment = fragmentPayload();
	if (fragment && fragment.version) {
		selectedVersion = fragment.version;
	}
	const fallback = savedDoc() ?? doc;
	if (fragment != null) {
		inflate(decodeBase64Url(fragment.payload)).then(
			(text) => {
				setDoc(text);
				// Mode before the doc event, so the arrival auto-run
				// compiles under the linked leg. (The version pin was read
				// before startCompiler spawned anything.)
				if (fragment.mode) setMode(fragment.mode);
				dispatch({ kind: "doc" });
			},
			() => {
				setDoc(fallback);
				dispatch({ kind: "doc" });
			},
		);
	}
	view = new EditorView({
		parent: host,
		state: EditorState.create({
			doc: fragment != null ? "" : fallback,
			extensions: [
				// Gutter order is extension order: the lint strip leftmost at
				// the window edge (VS Code's glyph margin), then the numbers.
				lintGutter(),
				lineNumbers(),
				highlightActiveLine(),
				highlightActiveLineGutter(),
				history(),
				bracketMatching(),
				closeBrackets(),
				indentUnit.of("\t"),
				vilanLanguage,
				syntaxHighlighting(vilanHighlight),
				vilanTheme,
				EditorView.updateListener.of((update) => {
					if (update.docChanged) {
						persist();
						refreshPicker();
						scheduleCheck();
					}
				}),
				keymap.of([
					// The playground's verbs, before the defaults so they win.
					{ key: "Mod-Enter", run: () => (dispatch({ kind: "command", command: "run" }), true) },
					{ key: "Shift-Alt-f", run: () => (dispatch({ kind: "command", command: "format" }), true) },
					...defaultKeymap,
					...historyKeymap,
					indentWithTab,
				]),
			],
		}),
	});
	placeholder();
	wirePicker();
	refreshPicker();
	if (fragment == null) {
		dispatch({ kind: "doc" });
	}
}

// --- the template picker: which example the buffer is, and whether it still
// --- is it ---
//
// The select carries two facts, and it only ever shows the true one: which
// seeded example the buffer came from, and whether it has diverged since.
// Diverged, the select falls back to its placeholder — which the page then
// labels "Modified — Counter". That single move buys three things: the
// divergence is visible (K2); the committed value is no longer the template,
// so picking that same template DOES fire `change` and the pristine copy is
// reachable again (K3); and a pick can never leave the control showing a
// choice the buffer has not taken, so a refused replacement (K4) has nothing
// to undo.
//
// `activeTemplate` is content-derived and sticky: a buffer that IS an example
// verbatim claims it (however it arrived — seeded, restored, or shared), and
// it keeps the claim through the edits that follow so the marker can name
// what was modified. A buffer that matches nothing and never did has no
// template to be modified from, but it is still someone's program: it reads
// as dirty so the page guards it.
let activeTemplate = null;
let reportedTemplate = null;
let reportedDirty = false;

function templateFor(text) {
	const examples = window.VILAN_EXAMPLES || {};
	for (const name of Object.keys(examples)) {
		if (examples[name] === text) return name;
	}
	return null;
}

// Point the select at what the buffer actually is, and tell the page when
// that answer changes. Cheap enough to run on every keystroke: four string
// comparisons against sources of a few hundred bytes.
function refreshPicker() {
	const text = value();
	const match = templateFor(text);
	if (match != null) activeTemplate = match;
	const dirty = activeTemplate == null ? text.trim() !== "" : text !== example(activeTemplate);
	const picker = document.getElementById("template");
	// The placeholder holds the seat for everything that is not a pristine
	// example — a modified buffer, a shared one, an empty one.
	if (picker) picker.value = !dirty && activeTemplate != null ? activeTemplate : "";
	if (activeTemplate === reportedTemplate && dirty === reportedDirty) return;
	reportedTemplate = activeTemplate;
	reportedDirty = dirty;
	// `name` is the template the marker should name — empty when the buffer
	// is pristine, and empty too when it descends from no example at all.
	dispatch({ kind: "dirty", name: dirty ? (activeTemplate ?? "") : "", changed: dirty });
}

// The picker is rendered by the page; the value read needs the DOM, so the
// wiring lives here and a pick travels as a command event — whether it is
// honored is the page's call, not this file's.
function wirePicker() {
	const picker = document.getElementById("template");
	if (picker) {
		picker.addEventListener("change", () => {
			const name = picker.value;
			// Snap the control back to the buffer's own state before the
			// page hears about the pick: the select states what IS loaded,
			// never what has merely been asked for.
			refreshPicker();
			if (name) {
				dispatch({ kind: "command", command: "pick", name });
			}
		});
	}
	const mode = document.getElementById("mode");
	if (mode) {
		mode.addEventListener("change", () => setMode(mode.value));
	}
}

function value() {
	return view ? view.state.doc.toString() : "";
}

function setDoc(text) {
	if (!view) return;
	view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
	view.dispatch(setDiagnostics(view.state, []));
}

function example(name) {
	return (window.VILAN_EXAMPLES || {})[name] || "";
}

// The wire diagnostic's line/column are UTF-16 (CodeMirror's own unit); its
// start/end are byte offsets, so the range END is a byte-length
// approximation — exact for ASCII, clamped otherwise.
function applyEditorDiagnostics(diagnostics) {
	if (!view) return;
	const doc = view.state.doc;
	const mapped = diagnostics
		.filter((diagnostic) => diagnostic.file === "main.vl")
		.map((diagnostic) => {
			const line = doc.line(Math.min(diagnostic.line + 1, doc.lines));
			const from = Math.min(line.from + diagnostic.column, doc.length);
			const to = Math.min(from + Math.max(diagnostic.end - diagnostic.start, 1), doc.length);
			return {
				from,
				to: Math.max(from, to),
				severity: diagnostic.severity === "error" ? "error" : "warning",
				message: diagnostic.note
					? `${diagnostic.message}\nnote: ${diagnostic.note}`
					: diagnostic.message,
			};
		});
	view.dispatch(setDiagnostics(view.state, mapped));
}

// --- the compile worker: spawn, crash-respawn, recycle, single-flight ---

// The wasm instance leaks per compile by design and a panic poisons its
// memory, so the worker is disposable: recycled after enough compiles, and
// immediately after any crash.
const RECYCLE_AFTER = 32;

let worker = null;
let ready = false;
let inFlight = false;
let pending = null;
let compileCount = 0;
let loadFailures = 0;

// Live diagnostics: edits schedule a debounced background CHECK - the same
// compile, but only diagnostics ride back and the running program is never
// touched. Latest-wins queueing (typing keeps only the newest), a queued Run
// always outranks a queued check, and a check result whose text the visitor
// has already changed is dropped rather than squiggling the wrong spans -
// the newer check is already on its way.
let pendingCheck = null;
let sentSource = null;
let checkTimer = null;

// Which compiler version the worker loads. The manifest's `versions` list
// is the selector's inventory; `currentVersion` is the release the site
// ships today, and a different `selectedVersion` is a deliberate pin - it
// rides shared links so a repro stays a repro.
let selectedVersion = null;
let currentVersion = null;

function populateVersionSelect(versions) {
	const select = document.getElementById("version");
	if (!select) return;
	select.textContent = "";
	for (const version of versions) {
		const option = document.createElement("option");
		option.value = version;
		option.textContent = version;
		select.appendChild(option);
	}
	select.value = selectedVersion;
	select.addEventListener("change", () => {
		if (!select.value || select.value === selectedVersion) return;
		selectedVersion = select.value;
		sentSource = null; // the same text means something new under another compiler
		recycle();
	});
}

// Which leg the compiler targets: "browser" runs, "node" is check-only (the
// platform-coloring showcase). The page and the #mode select both route
// through setMode, so the state and the control never disagree.
let currentPlatform = "browser";

function setMode(platform) {
	if (platform !== "browser" && platform !== "node") return;
	if (platform === currentPlatform) return;
	currentPlatform = platform;
	const select = document.getElementById("mode");
	if (select) select.value = platform;
	sentSource = null; // the same text means something new under another leg
	scheduleCheck();
	dispatch({ kind: "command", command: "mode", name: platform });
}

function scheduleCheck() {
	clearTimeout(checkTimer);
	checkTimer = setTimeout(() => {
		if (!view) return;
		const source = view.state.doc.toString();
		if (source === sentSource) return; // already checked or being checked
		if (!ready || inFlight) {
			pendingCheck = source;
			return;
		}
		sentSource = source;
		inFlight = true;
		worker.postMessage({ action: "check", source, platform: currentPlatform });
	}, 400);
}

// Events flow to the page through one callback, wired by startCompiler.
// Anything emitted before the wiring (the editor's own "doc" event — init
// runs first) queues and drains on wire, so call order cannot lose events.
let emit = null;
const queuedEvents = [];

function dispatch(event) {
	if (emit) {
		emit(event);
	} else {
		queuedEvents.push(event);
	}
}

function spawn() {
	ready = false;
	const pin = selectedVersion ? `?v=${selectedVersion}` : "";
	worker = new Worker(`/playground/worker.js${pin}`, { type: "module" });
	worker.onmessage = (event) => {
		const message = event.data;
		if (message.kind === "ready") {
			ready = true;
			loadFailures = 0;
			dispatch(message);
			flushPending();
			scheduleCheck();
		} else if (message.kind === "result") {
			inFlight = false;
			compileCount += 1;
			applyEditorDiagnostics(message.diagnostics);
			dispatch(message);
			if (compileCount >= RECYCLE_AFTER && pending == null && pendingCheck == null) {
				recycle();
			} else {
				flushPending();
			}
		} else if (message.kind === "checked") {
			inFlight = false;
			compileCount += 1; // a check leaks like a compile; it pays the same budget
			const current = view ? view.state.doc.toString() : "";
			if (current === sentSource && message.platform === currentPlatform) {
				applyEditorDiagnostics(message.diagnostics);
				dispatch(message);
			}
			if (compileCount >= RECYCLE_AFTER && pending == null && pendingCheck == null) {
				recycle();
			} else {
				flushPending();
			}
		} else if (message.kind === "formatted") {
			// Formatting is pure text work — it neither leaks nor counts
			// toward the recycle budget.
			inFlight = false;
			if (message.changed) {
				applyFormatted(message.text);
			}
			dispatch(message);
			flushPending();
		} else if (message.kind === "crash") {
			inFlight = false;
			dispatch(message);
			recycle();
		}
	};
	// A worker-level error is a load failure (bad path, wasm fetch refused) —
	// respawning forever would loop, so give up after a few.
	worker.onerror = () => {
		inFlight = false;
		loadFailures += 1;
		if (loadFailures >= 3) {
			dispatch({ kind: "crash", error: "the compiler failed to load" });
			return;
		}
		recycle();
	};
}

function recycle() {
	if (worker) worker.terminate();
	compileCount = 0;
	spawn();
}

function flushPending() {
	if (!ready || inFlight) return;
	if (pending != null) {
		const source = pending;
		pending = null;
		sentSource = source;
		inFlight = true;
		worker.postMessage({ action: "compile", source });
		return;
	}
	if (pendingCheck != null) {
		const source = pendingCheck;
		pendingCheck = null;
		sentSource = source;
		inFlight = true;
		worker.postMessage({ action: "check", source });
	}
}

function startCompiler(onEvent) {
	emit = onEvent;
	while (queuedEvents.length > 0) {
		emit(queuedEvents.shift());
	}
	// The manifest names the current release and the selector's inventory.
	// If it cannot be read the worker resolves it itself and the selector
	// just stays empty - the compiler still comes up.
	fetch("/playground/manifest.json", { cache: "no-cache" })
		.then((response) => response.json())
		.then((manifest) => {
			currentVersion = manifest.compiler;
			if (!selectedVersion) selectedVersion = currentVersion;
			populateVersionSelect(manifest.versions ?? [manifest.compiler]);
		})
		.catch(() => {})
		.finally(spawn);
}

function compile(source) {
	if (!ready || inFlight) {
		pending = source;
		return false;
	}
	sentSource = source;
	inFlight = true;
	worker.postMessage({ action: "compile", source, platform: currentPlatform });
	return true;
}

// Format the buffer with the compiler's own formatter. No queue — a busy
// worker just answers false and the visitor presses again.
function format() {
	if (!view || !ready || inFlight) {
		return false;
	}
	inFlight = true;
	worker.postMessage({ action: "format", source: view.state.doc.toString() });
	return true;
}

// Replace the doc with its formatted form, keeping the cursor near where it
// was (clamped — good enough for a whole-buffer reprint).
function applyFormatted(text) {
	if (!view) return;
	const anchor = Math.min(view.state.selection.main.anchor, text.length);
	view.dispatch({
		changes: { from: 0, to: view.state.doc.length, insert: text },
		selection: { anchor },
	});
}

// --- the runner: one sandboxed iframe per Run, torn down and rebuilt ---

// `allow-scripts` only: an opaque origin, no same-origin access. The
// bootstrap forwards console output and uncaught errors to the parent.
const BOOTSTRAP = `(function () {
	var send = function (kind, text) { parent.postMessage({ kind: kind, text: text }, "*"); };
	var show = function (value) {
		if (typeof value === "string") return value;
		try { return JSON.stringify(value); } catch (error) { return String(value); }
	};
	var wrap = function (name, kind) {
		var original = console[name].bind(console);
		console[name] = function () {
			original.apply(null, arguments);
			send(kind, Array.prototype.map.call(arguments, show).join(" "));
		};
	};
	wrap("log", "log"); wrap("info", "log"); wrap("warn", "error"); wrap("error", "error");
	window.addEventListener("error", function (event) { send("error", event.message); });
	window.addEventListener("unhandledrejection", function (event) { send("error", String(event.reason)); });
})();`;

// Only a literal "</script" (or "</style") can close its tag early; in valid
// program text the sequence can only sit inside a string, where the escaped
// spelling means the same thing.
function escapeScript(text) {
	return text.replace(/<\/script/gi, "<\\/script");
}

function escapeStyle(text) {
	return text.replace(/<\/style/gi, "<\\/style");
}

function buildSrcdoc(js, css) {
	return [
		"<!doctype html>",
		"<html><head><meta charset=\"utf-8\">",
		`<style>${escapeStyle(css)}</style>`,
		"</head><body>",
		"<div id=\"app\"></div>",
		`<script>${BOOTSTRAP}</scr` + "ipt>",
		`<script type="module">${escapeScript(js)}</scr` + "ipt>",
		"</body></html>",
	].join("\n");
}

function runProgram(js, css) {
	const host = document.getElementById("runner");
	if (!host) return;
	host.textContent = "";
	const frame = document.createElement("iframe");
	frame.setAttribute("sandbox", "allow-scripts");
	frame.setAttribute("title", "program result");
	frame.srcdoc = buildSrcdoc(js, css);
	host.append(frame);
}

function placeholder() {
	const host = document.getElementById("runner");
	if (!host) return;
	host.textContent = "";
	const note = document.createElement("div");
	note.textContent = "Press Run to build and mount the program.";
	// Off the same palette as everything else: the dim tier is a role now, not
	// an opacity, and the size is the tool register's one size.
	note.style.cssText = "margin:auto;padding:16px;color:var(--code-dim);font-size:var(--code-size);";
	host.append(note);
}

window.VilanPlayground = {
	init,
	value,
	setDoc,
	example,
	startCompiler,
	compile,
	format,
	share,
	setMode,
	runProgram,
	clearProgram: placeholder,
};
