// The site's test harness: build the package, then drive each built bundle
// under a node DOM stub and assert on what it does.
//
// Why this exists at all. This repo had no test harness of any kind — no
// Cargo.toml, no package.json, no test directory, and CI that only deployed —
// so a behavioural defect in the site's own vilan code had nowhere to be
// pinned, and the toolchain repo could not honestly hold the pin either (the
// code is not there). Tracker K18 is the item that named that gap; this is the
// smallest thing that closes it rather than a framework nobody asked for.
//
// The shape is the toolchain repo's `crates/vilan-cli/tests/hmr.rs`: stub the
// HOST — `document`, `window`, the vendored `playground/editor.js` — and run
// the REAL built bundle against it, unmodified, the same bytes the deploy
// copies to vilan-lang.org. Nothing here mocks the code under test.
//
//   node scripts/test.mjs              build, then run every tests/*.test.mjs
//   node scripts/test.mjs --no-build   run against the dist/ already on disk
//
// Each test file runs in its OWN node process: booting a bundle installs
// globals and mounts a page, and two of those in one process would share a
// document. The verdict is the child's exit code, and its output is streamed
// through so a CI log reads top to bottom.

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const build = !process.argv.includes("--no-build");

if (build) {
	// The bundles under test are build output, so a stale dist/ would test the
	// last change rather than this one.
	const built = spawnSync("vilan", ["build", "."], { cwd: root, stdio: "inherit" });
	if (built.status !== 0) {
		console.error(`vilan build . failed (${built.status ?? built.signal})`);
		process.exit(1);
	}
}

const tests = readdirSync(`${root}tests`)
	.filter((name) => name.endsWith(".test.mjs"))
	.sort();
if (tests.length === 0) {
	console.error("no tests found in tests/");
	process.exit(1);
}

let failed = 0;
for (const name of tests) {
	console.log(`--- ${name}`);
	const run = spawnSync(process.execPath, [`${root}tests/${name}`], { cwd: root, stdio: "inherit" });
	if (run.status !== 0) {
		failed += 1;
		console.error(`${name}: exited ${run.status ?? run.signal}`);
	}
}

console.log(
	failed === 0
		? `harness verdict: PASS (${tests.length} files)`
		: `harness verdict: FAIL (${failed} of ${tests.length} files)`,
);
process.exit(failed === 0 ? 0 : 1);
