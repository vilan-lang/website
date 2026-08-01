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
import { closeBrackets } from "@codemirror/autocomplete";
import { setDiagnostics, lintGutter } from "@codemirror/lint";
import { tags } from "@lezer/highlight";

// --- the vilan mode: a stream tokenizer, enough for the pane to read as
// --- vilan (the real grammar lives in the compiler; this is presentation)

const KEYWORDS = new Set([
	"async", "await", "borrows", "const", "else", "enum", "export", "external",
	"for", "fun", "if", "impl", "import", "in", "is", "jump", "let", "macro",
	"match", "mod", "mut", "own", "resource", "ret", "struct", "trait", "type",
	"use", "with",
]);

const ATOMS = new Set(["true", "false", "null"]);

const vilanLanguage = StreamLanguage.define({
	startState: () => ({ triple: false }),
	token(stream, state) {
		if (state.triple) {
			while (!stream.eol()) {
				if (stream.match('"""')) {
					state.triple = false;
					return "string";
				}
				stream.next();
			}
			return "string";
		}
		if (stream.match("//")) {
			stream.skipToEnd();
			return "comment";
		}
		if (stream.match('"""') || stream.match('i"""')) {
			state.triple = true;
			return "string";
		}
		if (stream.match(/^i?"/)) {
			while (!stream.eol()) {
				const ch = stream.next();
				if (ch === "\\") {
					stream.next();
					continue;
				}
				if (ch === '"') {
					break;
				}
			}
			return "string";
		}
		if (stream.match(/^\d[\d_]*(\.[\d_]+)?([a-z][a-z0-9]*)?/)) {
			return "number";
		}
		if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)) {
			const word = stream.current();
			if (KEYWORDS.has(word)) return "keyword";
			if (ATOMS.has(word)) return "atom";
			if (/^[A-Z]/.test(word)) return "typeName";
			return null;
		}
		stream.next();
		return null;
	},
});

// --- the brand look (theme.vl's palette: ink, blush, panel, ember, rose)

const vilanTheme = EditorView.theme(
	{
		"&": {
			backgroundColor: "#1B060D",
			color: "#F9DFE7",
			height: "100%",
			fontSize: "13px",
		},
		".cm-content": {
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
			caretColor: "#F9DFE7",
		},
		".cm-cursor, .cm-dropCursor": { borderLeftColor: "#F9DFE7" },
		".cm-gutters": {
			backgroundColor: "#1B060D",
			color: "rgba(249, 223, 231, 0.35)",
			border: "none",
			borderRight: "1px solid rgba(249, 223, 231, 0.10)",
		},
		".cm-activeLine": { backgroundColor: "rgba(249, 223, 231, 0.04)" },
		".cm-activeLineGutter": { backgroundColor: "rgba(249, 223, 231, 0.07)" },
		"&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
			{ backgroundColor: "rgba(249, 223, 231, 0.18) !important" },
		".cm-lintRange-error": {
			backgroundImage: "none",
			textDecoration: "underline wavy #EB682E 1px",
		},
		".cm-lintRange-warning": {
			backgroundImage: "none",
			textDecoration: "underline wavy #E5AFD9 1px",
		},
	},
	{ dark: true },
);

const vilanHighlight = HighlightStyle.define([
	{ tag: tags.keyword, color: "#EB682E" },
	{ tag: tags.atom, color: "#EB682E" },
	{ tag: tags.string, color: "#E5AFD9" },
	{ tag: tags.number, color: "#E5AFD9" },
	{ tag: tags.lineComment, color: "rgba(249, 223, 231, 0.5)", fontStyle: "italic" },
	{ tag: tags.typeName, color: "#F9DFE7", fontWeight: "600" },
]);

// --- the editor ---

let view = null;

// --- share-via-fragment: the buffer IS the link -----------------------------
//
// `#code=<base64url(deflate-raw(source))>` — no server holds anything, and a
// fragment never reaches one in a request. Share writes the fragment and
// copies the full URL; a page opened with one loads it instead of the
// default example.

function encodeBase64Url(bytes) {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(text) {
	const padded = text.replaceAll("-", "+").replaceAll("_", "/");
	const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
	return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

async function deflate(text) {
	const stream = new Blob([new TextEncoder().encode(text)])
		.stream()
		.pipeThrough(new CompressionStream("deflate-raw"));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(bytes) {
	const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
	return new Response(stream).text();
}

function fragmentPayload() {
	const match = location.hash.match(/^#code=([A-Za-z0-9_-]+)$/);
	return match ? match[1] : null;
}

function share() {
	(async () => {
		const source = view ? view.state.doc.toString() : "";
		const encoded = encodeBase64Url(await deflate(source));
		const url = `${location.origin}${location.pathname}#code=${encoded}`;
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
	const payload = fragmentPayload();
	const fallback = savedDoc() ?? doc;
	if (payload != null) {
		inflate(decodeBase64Url(payload)).then(
			(text) => {
				setDoc(text);
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
			doc: payload != null ? "" : fallback,
			extensions: [
				lineNumbers(),
				highlightActiveLine(),
				highlightActiveLineGutter(),
				history(),
				bracketMatching(),
				closeBrackets(),
				lintGutter(),
				indentUnit.of("\t"),
				vilanLanguage,
				syntaxHighlighting(vilanHighlight),
				vilanTheme,
				EditorView.updateListener.of((update) => {
					if (update.docChanged) persist();
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
	if (payload == null) {
		dispatch({ kind: "doc" });
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
	worker = new Worker("/playground/worker.js", { type: "module" });
	worker.onmessage = (event) => {
		const message = event.data;
		if (message.kind === "ready") {
			ready = true;
			loadFailures = 0;
			dispatch(message);
			flushPending();
		} else if (message.kind === "result") {
			inFlight = false;
			compileCount += 1;
			applyEditorDiagnostics(message.diagnostics);
			dispatch(message);
			if (compileCount >= RECYCLE_AFTER && pending == null) {
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
	if (pending != null && ready && !inFlight) {
		const source = pending;
		pending = null;
		inFlight = true;
		worker.postMessage({ action: "compile", source });
	}
}

function startCompiler(onEvent) {
	emit = onEvent;
	while (queuedEvents.length > 0) {
		emit(queuedEvents.shift());
	}
	spawn();
}

function compile(source) {
	if (!ready || inFlight) {
		pending = source;
		return false;
	}
	inFlight = true;
	worker.postMessage({ action: "compile", source });
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
	note.style.cssText = "margin:auto;opacity:.45;font-size:13px;padding:16px;";
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
	runProgram,
	clearProgram: placeholder,
};
