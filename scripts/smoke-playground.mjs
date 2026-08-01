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
//      browser).
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { generate } from "./gen-examples.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

// 3: the compiler loads. (--target web glue: init takes the raw bytes, so no
// fetch or DecompressionStream is needed under node.)
const glue = await import(`${root}playground/wasm/vilan_wasm.js`);
const wasm = gunzipSync(readFileSync(`${root}playground/wasm/vilan_wasm_bg.wasm.gz`));
await glue.default({ module_or_path: wasm });
console.log(`playground compiler: vilan ${glue.version()}`);

// 2: examples.js is current.
const committed = readFileSync(`${root}playground/examples.js`, "utf8");
if (committed !== generate()) {
	console.error("playground/examples.js is stale; run: node scripts/gen-examples.mjs");
	process.exit(1);
}

// 1: every example compiles clean.
let failed = false;
for (const name of readdirSync(`${root}playground/examples`).filter((f) => f.endsWith(".vl")).sort()) {
	const source = readFileSync(`${root}playground/examples/${name}`, "utf8");
	const result = glue.compile(source);
	const errors = result.diagnostics.filter((d) => d.severity === "error");
	if (!result.js || errors.length > 0) {
		failed = true;
		console.error(`${name}: FAILED`);
		for (const diagnostic of errors) {
			console.error(`  ${diagnostic.file}:${diagnostic.line + 1}:${diagnostic.column + 1} ${diagnostic.message}`);
		}
	} else {
		const css = result.css ? `, ${result.css.length} B css` : "";
		console.log(`${name}: ok (${result.js.length} B js${css})`);
	}
}
process.exit(failed ? 1 : 0);
