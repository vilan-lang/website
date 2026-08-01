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

function init(selector, doc) {
	const host = document.querySelector(selector);
	if (!host) return;
	view = new EditorView({
		parent: host,
		state: EditorState.create({
			doc,
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
				keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
			],
		}),
	});
	placeholder();
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
let emit = () => {};

function spawn() {
	ready = false;
	worker = new Worker("/playground/worker.js", { type: "module" });
	worker.onmessage = (event) => {
		const message = event.data;
		if (message.kind === "ready") {
			ready = true;
			loadFailures = 0;
			emit(message);
			flushPending();
		} else if (message.kind === "result") {
			inFlight = false;
			compileCount += 1;
			applyEditorDiagnostics(message.diagnostics);
			emit(message);
			if (compileCount >= RECYCLE_AFTER && pending == null) {
				recycle();
			} else {
				flushPending();
			}
		} else if (message.kind === "crash") {
			inFlight = false;
			emit(message);
			recycle();
		}
	};
	// A worker-level error is a load failure (bad path, wasm fetch refused) —
	// respawning forever would loop, so give up after a few.
	worker.onerror = () => {
		inFlight = false;
		loadFailures += 1;
		if (loadFailures >= 3) {
			emit({ kind: "crash", error: "the compiler failed to load" });
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
		worker.postMessage(source);
	}
}

function startCompiler(onEvent) {
	emit = onEvent;
	spawn();
}

function compile(source) {
	if (!ready || inFlight) {
		pending = source;
		return false;
	}
	inFlight = true;
	worker.postMessage(source);
	return true;
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
	runProgram,
	clearProgram: placeholder,
};
