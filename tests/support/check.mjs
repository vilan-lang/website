// The verdict protocol, copied from the toolchain repo's node harnesses
// (`crates/vilan-cli/tests/hmr.rs`): every claim prints its own line, and the
// PASS/FAIL word travels on stdout as well as in the exit code, so a run whose
// process dies after the last assertion cannot be read as a pass.

let failures = 0;
let checks = 0;

export function check(condition, message) {
	checks += 1;
	if (condition) {
		console.log(`ok   - ${message}`);
	} else {
		failures += 1;
		console.error(`FAIL - ${message}`);
	}
}

export function verdict(name) {
	console.log(
		failures === 0
			? `${name} verdict: PASS (${checks} checks)`
			: `${name} verdict: FAIL (${failures} of ${checks} checks)`,
	);
	process.exit(failures === 0 ? 0 : 1);
}
