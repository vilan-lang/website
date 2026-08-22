// The playground gate: prove the shipped pieces agree before a deploy ships
// them. Three claims, each of which has silently broken a playground before
// it ever reached a visitor somewhere:
//
//   1. every seeded example compiles clean against the shipped wasm compiler
//      (a language change can rot an example; the deploy must notice, exactly
//      like the toolchain repo's examples gate);
//   2. examples.js matches the example files byte for byte (it is generated —
//      a stale copy ships the OLD example while the smoke test checks the new
//      one, so the mismatch itself is the failure);
//   3. the wasm pair actually loads and reports a version (a truncated
//      download or a glue/wasm version skew fails here, not in a visitor's
//      browser);
//   4. when the compiler exports `complete` (K9), a `.` after the counter
//      example's signal offers its members — the one place this repo can
//      hold the completion contract the editor is wired to. Skipped, and
//      said so, on a release that predates the export.
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { generate } from "./gen-examples.mjs";

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
const committed = readFileSync(`${root}playground/examples.js`, "utf8");
if (committed !== generate()) {
	console.error("playground/examples.js is stale; run: node scripts/gen-examples.mjs");
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
	const errors = result.diagnostics.filter((d) => d.severity === "error");
	if (!result.js || errors.length > 0) {
		failed = true;
		console.error(`${name}: FAILED`);
		for (const diagnostic of errors) {
			console.error(`  ${diagnostic.file}:${diagnostic.line + 1}:${diagnostic.column + 1} ${diagnostic.message}`);
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
process.exit(failed ? 1 : 0);
