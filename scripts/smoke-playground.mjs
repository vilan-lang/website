// The playground gate: prove the shipped pieces agree before a deploy ships
// them. Seven claims, each of which has silently broken a playground before
// it ever reached a visitor somewhere:
//
//   1. every seeded example compiles clean against the shipped wasm compiler
//      (a language change can rot an example; the deploy must notice, exactly
//      like the toolchain repo's examples gate) - clean meaning NO diagnostic,
//      a warning included: it is the first thing a visitor's editor shows;
//   2. examples.js matches the example files byte for byte (it is generated —
//      a stale copy ships the OLD example while the smoke test checks the new
//      one, so the mismatch itself is the failure);
//   3. the wasm pair actually loads and reports a version (a truncated
//      download or a glue/wasm version skew fails here, not in a visitor's
//      browser);
//   4. when the compiler exports `complete` (K9), a `.` after the counter
//      example's signal offers its members — the one place this repo can
//      hold the completion contract the editor is wired to. Skipped, and
//      said so, on a release that predates the export;
//   5. the landing page's whole-program code panels compile in the same
//      wasm (K25): the reactive snippet clean - its caption says it is the
//      whole program and it runs, and v0.42.0's `.map` rename rotted it while
//      every seeded example stayed green - and the diagnostic demo to exactly
//      the error the page prints beside it. Read off the built landing page
//      (dist/client.js, so `vilan build .` runs first, as the deploy does).
//      tests/examples.test.mjs holds the same panels on the native compiler
//      on every push, and runs them;
//   6. when the compiler exports `compile_with` (K14), the prelude toggle's
//      OFF position really removes the ambient scope. The `"off"` word is
//      spelled in exactly one place — src/playground/worker.js — and nothing
//      else in either repo would notice if it stopped meaning anything: the
//      toggle would just quietly become a no-op. Claim 1 already proves the
//      ON position, since the examples no longer import what the prelude
//      supplies. The WEB position's module path is held the same way: on the
//      node leg, where ON is the base set, it must make `Signal` ambient;
//   7. when the compiler exports `format_checked` (E197), it DECLINES a
//      buffer it cannot reprint, with a sentence, and declines nothing on a
//      seeded example (K15). The page's status note shows that sentence; a
//      release whose export stopped declining would put "Format made no
//      changes." back over a broken buffer, and nothing else would notice.
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { generate } from "./gen-examples.mjs";
import { bootHome, programOf } from "../tests/support/home.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

// 3: the compiler loads. (--target web glue: init takes the raw bytes, so no
// fetch or DecompressionStream is needed under node.) The pair lives in the
// versioned directory the VERSION file names, exactly as the page finds it.
const release = readFileSync(`${root}playground/wasm/VERSION`, "utf8").trim();
const glue = await import(`${root}playground/wasm/${release}/vilan_wasm.js`);
const wasm = gunzipSync(readFileSync(`${root}playground/wasm/${release}/vilan_wasm_bg.wasm.gz`));
await glue.default({ module_or_path: wasm });
console.log(`playground compiler: vilan ${glue.version()} (release ${release})`);

// 2: examples.js is current.
const committed = readFileSync(`${root}src/playground/examples.js`, "utf8");
if (committed !== generate()) {
	console.error("src/playground/examples.js is stale; run: node scripts/gen-examples.mjs");
	process.exit(1);
}

// 1: every example compiles clean under ITS leg. server.vl is the process
// example: node-checked when the wasm can (compile_for), and pinned to its
// browser REJECTION when it cannot - either way the gate stays meaningful.
let failed = false;
for (const name of readdirSync(`${root}playground/examples`).filter((f) => f.endsWith(".vl")).sort()) {
	const source = readFileSync(`${root}playground/examples/${name}`, "utf8");
	const node = name === "server.vl";
	if (node && typeof glue.compile_for !== "function") {
		const rejected = glue.compile(source).diagnostics.some((d) => d.severity === "error");
		if (rejected) {
			console.log(`${name}: browser-mode rejection pinned (wasm without compile_for)`);
		} else {
			failed = true;
			console.error(`${name}: FAILED - a process program compiled clean for the browser`);
		}
		continue;
	}
	const result = node ? glue.compile_for(source, "node") : glue.compile(source);
	const errors = result.diagnostics;
	if (!result.js || errors.length > 0) {
		failed = true;
		console.error(`${name}: FAILED`);
		for (const diagnostic of errors) {
			console.error(`  ${diagnostic.severity} ${diagnostic.file}:${diagnostic.line + 1}:${diagnostic.column + 1} ${diagnostic.message}`);
			// A context-coverage refusal's chain (E80): the log names every
			// uncovered call, so the failing path reads from CI output alone.
			for (const hop of diagnostic.trace ?? []) {
				console.error(hop.call ? `      via ${hop.file}:${hop.line + 1}:${hop.column + 1} — ${hop.message}` : `      ${hop.message}`);
			}
		}
	} else {
		const css = result.css ? `, ${result.css.length} B css` : "";
		const leg = node ? ", node leg" : "";
		console.log(`${name}: ok (${result.js.length} B js${css}${leg})`);
	}
}
// 4: completion answers from the retained analysis (the `check` the page
// issues is the same compile, so the compile above is what retains it).
if (typeof glue.complete === "function") {
	const counter = readFileSync(`${root}playground/examples/counter.vl`, "utf8");
	glue.compile(counter);
	const lines = counter.split("\n");
	const line = lines.findIndex((text) => text.includes("count.set("));
	const character = lines[line].indexOf("count.set(") + "count.".length;
	const items = glue.complete(counter, line, character).map((item) => {
		const label = item.label;
		item.free();
		return label;
	});
	for (const expected of ["get", "set"]) {
		if (!items.includes(expected)) {
			failed = true;
			console.error(`completion: FAILED - \`count.\` did not offer ${expected}: ${items.join(", ")}`);
		}
	}
	if (!failed) console.log(`completion: ok (${items.length} candidates after \`count.\`)`);
} else {
	console.log("completion: skipped (this release predates the complete export)");
}
// 5: the landing page's code panels, compiled by the visitor's compiler.
const home = await bootHome(`${root}dist/client.js`);
const pres = home.pres();
const reactive = pres.find((lines) => lines.some((line) => line.includes("bind_text(")));
if (!reactive) {
	failed = true;
	console.error("landing page: FAILED - the reactive snippet is missing");
} else {
	const result = glue.compile(programOf(reactive));
	if (!result.js || result.diagnostics.length > 0) {
		failed = true;
		console.error("landing page: FAILED - the reactive snippet does not compile clean");
		for (const d of result.diagnostics) console.error(`  ${d.severity} ${d.line + 1}:${d.column + 1} ${d.message}`);
	} else {
		console.log(`landing page: reactive snippet ok (${result.js.length} B js)`);
	}
}
const demo = pres.find((lines) => lines.some((line) => line.startsWith("fun find_user(")));
const shown = pres.find((lines) => lines[0]?.startsWith("Error:"));
if (!demo || !shown) {
	failed = true;
	console.error("landing page: FAILED - the diagnostic demo is missing");
} else {
	// "Error: <message>" and "╭─[ demo.vl:<line>:<column> ]" are what the page
	// claims; the wasm reports the same diagnostic as data.
	const message = shown[0].replace(/^Error: /, "");
	const at = shown.find((line) => line.includes("╭─["))?.match(/:(\d+):(\d+) \]/);
	const said = glue.compile(programOf(demo)).diagnostics;
	const agrees =
		said.length === 1 &&
		said[0].severity === "error" &&
		said[0].message === message &&
		at != null &&
		said[0].line + 1 === Number(at[1]) &&
		said[0].column + 1 === Number(at[2]);
	if (agrees) {
		console.log(`landing page: diagnostic demo ok (${at[1]}:${at[2]} ${message})`);
	} else {
		failed = true;
		console.error(`landing page: FAILED - the page shows ${at?.[1]}:${at?.[2]} ${message}; the compiler says:`);
		for (const d of said) console.error(`  ${d.severity} ${d.line + 1}:${d.column + 1} ${d.message}`);
	}
}
// 6: the toggle's OFF position. hello.vl imports neither `print` nor `view`
// any more, so with no ambient scope it MUST fail — and fail on those names.
if (typeof glue.compile_with === "function") {
	const hello = readFileSync(`${root}playground/examples/hello.vl`, "utf8");
	const off = glue.compile_with(hello, "browser", "off");
	const missing = off.diagnostics
		.filter((d) => d.severity === "error")
		.map((d) => d.message)
		.join(" | ");
	if (off.js != null || !missing.includes("print")) {
		failed = true;
		console.error(`prelude toggle: FAILED - "off" did not remove the ambient scope: ${missing || "(clean compile)"}`);
	} else {
		console.log("prelude toggle: ok (off requires the explicit imports)");
	}
	// The worker's "web" word is the module path below; ON on the node leg is
	// the base set, which has no `Signal`.
	const webOnly = "fun main() {\n\tlet count = Signal::new(0);\n\tprint(i\"{count.get()}\");\n}\n";
	const base = glue.compile_with(webOnly, "node", undefined);
	const web = glue.compile_with(webOnly, "node", "std::web");
	if (base.js != null || web.js == null || web.diagnostics.length > 0) {
		failed = true;
		console.error("prelude toggle: FAILED - the web position does not pin the web set on the node leg");
		for (const d of web.diagnostics) console.error(`  ${d.severity} ${d.line + 1}:${d.column + 1} ${d.message}`);
	} else {
		console.log("prelude toggle: ok (web pins the web set on the node leg)");
	}
} else {
	console.log("prelude toggle: skipped (this release predates the compile_with export)");
}
// 7: the formatter's decline, as the page's Format note reads it.
if (typeof glue.format_checked === "function") {
	const broken = glue.format_checked("fun main( {\n");
	const clean = glue.format_checked(readFileSync(`${root}playground/examples/counter.vl`, "utf8"));
	const declined = broken.declined ?? null;
	if (typeof declined !== "string" || declined.length === 0 || broken.text !== "fun main( {\n") {
		failed = true;
		console.error(`format declines: FAILED - an unparseable buffer came back ${JSON.stringify({ text: broken.text, declined })}`);
	} else if (clean.declined != null) {
		failed = true;
		console.error(`format declines: FAILED - the counter example was declined: ${clean.declined}`);
	} else {
		console.log(`format declines: ok ("${declined}")`);
	}
} else {
	console.log("format declines: skipped (this release predates the format_checked export)");
}
process.exit(failed ? 1 : 0);
