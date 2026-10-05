// Every program the site SHIPS compiles clean on the installed toolchain, and
// still does what its text says (K25).
//
// Why this exists: v0.42.0 renamed a source's `.map` to `.derive`, and the
// site carries vilan programs in two places a `vilan build .` of the site
// never compiles — the playground's seeded examples (playground/examples/,
// shipped as text in examples.js) and the landing page's code panels (token
// spans in src/page.vl, rendered as text). The migration fixed the first and
// missed the second: the reactive panel kept `count.map(...)` under a caption
// promising "the snippet is the whole program, and it runs". A program the
// site shows is only checked if something compiles it, so this does — every
// one, on every push (ci.yml) and before every deploy (deploy.yml).
//
// The compiler here is the NATIVE `vilan` on PATH (CI installs the latest
// release, the same release the deploy's playground wasm comes from).
// scripts/smoke-playground.mjs repeats the example and panel compiles with
// that wasm itself on the deploy; this file is the half that runs everywhere
// the harness does, needs no download, and also RUNS the programs.
//
// A diagnostic of any severity fails: a warning on a seeded example is the
// first thing a visitor's editor shows them.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { check, verdict } from "./support/check.mjs";
import { installDom } from "./support/dom.mjs";
import { bootHome, programOf, walk } from "./support/home.mjs";
import { examples, generate, retired } from "../scripts/gen-examples.mjs";
import { fingerprint } from "../playground/fingerprint.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "site-examples-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

/// `vilan <args>` in `cwd`, colour off; stdout and stderr together, as a
/// reader of the CI log would see them.
function vilan(cwd, ...args) {
	const run = spawnSync("vilan", args, { cwd, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
	if (run.error) throw run.error;
	return { status: run.status, output: `${run.stdout}${run.stderr}`.trim() };
}

/// A scratch directory that means what a playground buffer means (K14): the
/// playground compiles a pasted buffer under its MODE's recommended prelude
/// (vilan-wasm's `PlaygroundPrelude::recommended_for` - the web set in the
/// browser mode, the base set in the server check mode), and a native
/// `vilan check` of a manifest-less file gets the base set whatever the
/// platform. A one-line package manifest naming the mode's set makes the two
/// compilers read the buffer under the same ambient scope.
function playgroundDir(prefix, platform) {
	const dir = mkdtempSync(join(scratch, prefix));
	const prelude = platform === "browser" ? "std::web::prelude" : "std::prelude";
	writeFileSync(join(dir, "vilan.toml"), `[package]\nname = "playground"\nprelude = "${prelude}"\n`);
	return dir;
}

/// Check `source` as `<name>.vl` on `platform`. Clean means exactly the
/// compiler's all-clear line and nothing else — a warning block fails it.
function checkClean(name, source, platform) {
	const dir = playgroundDir(`${name}-`, platform);
	writeFileSync(join(dir, `${name}.vl`), source);
	const result = vilan(dir, "check", `${name}.vl`, "--platform", platform);
	const clean = result.status === 0 && result.output === `${name}.vl: no errors`;
	if (!clean) console.error(result.output.replace(/^/gm, "      "));
	return { ...result, clean, dir };
}

/// Build `source` for the browser and run it under the DOM stub; returns the
/// mount, the printed lines, and the emitted stylesheet.
async function run(name, source) {
	const dir = playgroundDir(`${name}-run-`, "browser");
	writeFileSync(join(dir, `${name}.vl`), source);
	const built = vilan(dir, "build", `${name}.vl`, "--platform", "browser");
	if (built.status !== 0) {
		console.error(built.output.replace(/^/gm, "      "));
		return null;
	}
	const css = existsSync(join(dir, `${name}.css`)) ? readFileSync(join(dir, `${name}.css`), "utf8") : "";
	// .mjs: the browser loads the program as a module, so strict mode and all.
	writeFileSync(join(dir, `${name}.mjs`), readFileSync(join(dir, `${name}.js`), "utf8"));
	const dom = installDom(["app"]);
	const printed = [];
	const log = console.log;
	console.log = (...args) => printed.push(args.join(" "));
	try {
		await import(pathToFileURL(join(dir, `${name}.mjs`)).href);
	} finally {
		console.log = log;
	}
	await settle();
	return { app: dom.mount("app"), printed, css };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/// Click the button whose label is `label` somewhere under `app`.
async function click(app, label) {
	const button = walk(app).find((node) => node.tagName === "button" && node.textContent === label);
	if (!button) return false;
	for (const handler of button.listeners.click ?? []) {
		handler({ preventDefault() {}, stopPropagation() {}, target: button, currentTarget: button });
	}
	await settle();
	return true;
}

// --- the playground's seeded examples -------------------------------------

const current = examples();
const names = Object.keys(current);
check(names.length > 0, `the playground seeds examples (${names.join(", ")})`);
check(
	readFileSync(`${root}src/playground/examples.js`, "utf8") === generate(),
	"src/playground/examples.js is generated from playground/examples/ as it stands (node scripts/gen-examples.mjs)",
);
const gone = retired();
for (const name of names) {
	check(
		!(fingerprint(current[name]) in gone),
		`${name}: the current text is not in the retired record (the editor would treat it as stale)`,
	);
}

for (const name of names) {
	// server.vl is the process example: it checks on node, and its comment
	// promises that the browser refuses it.
	const leg = name === "server" ? "node" : "browser";
	check(checkClean(name, current[name], leg).clean, `${name}.vl checks clean on ${leg}, not even a warning`);
}

if (current.server) {
	const refused = vilan(`${root}playground/examples`, "check", "server.vl", "--platform", "browser");
	check(
		refused.status !== 0 && refused.output.includes("cannot run on `browser`"),
		"server.vl: the browser refuses it, as its comment says (flip the mode to Browser to watch it refuse)",
	);
}

if (current.counter) {
	const counter = await run("counter", current.counter);
	check(counter != null, "counter.vl builds for the browser");
	if (counter) {
		check(counter.app.texts().includes("clicked 0 times"), "counter: the label starts at 0");
		check(await click(counter.app, "+1"), "counter: there is a +1 button");
		check(counter.app.texts().includes("clicked 1 times"), "counter: a click moves the label (the binding follows the signal)");
		await click(counter.app, "+1");
		check(counter.app.texts().includes("clicked 2 times"), "counter: and keeps following it");
	}
}

if (current.hello) {
	const hello = await run("hello", current.hello);
	check(hello != null, "hello.vl builds for the browser");
	if (hello) {
		check(hello.printed.includes("Hello from the vilan playground!"), "hello: prints to the console pane");
		check(hello.app.texts().includes("Hello, world"), "hello: mounts its heading");
	}
}

if (current.styles) {
	const styles = await run("styles", current.styles);
	check(styles != null, "styles.vl builds for the browser");
	if (styles) {
		check(styles.app.texts().includes("Styled at compile time"), "styles: mounts the card");
		const classes = walk(styles.app).flatMap((node) => (node.attributes.class ?? "").split(/\s+/).filter(Boolean));
		check(
			classes.length > 0 && classes.every((name) => styles.css.includes(`.${name}`)),
			`styles: every class the card wears is a rule in the compiled stylesheet (${classes.length} classes)`,
		);
	}
}

// Every example file is one of the above or has been given a gate of its own.
for (const file of readdirSync(`${root}playground/examples`).filter((f) => f.endsWith(".vl"))) {
	check(["counter.vl", "hello.vl", "server.vl", "styles.vl"].includes(file), `${file}: its behaviour is checked here`);
}

// --- the landing page's code panels ---------------------------------------

const home = await bootHome(`${root}dist/client.js`);
const pres = home.pres();
const reactive = pres.find((lines) => lines.some((line) => line.includes("clicked {n} times")));
check(reactive != null, "the landing page shows the reactive snippet");
if (reactive) {
	const source = programOf(reactive);
	check(checkClean("snippet", source, "browser").clean, "the reactive snippet (\"the whole program, and it runs\") checks clean");
	const snippet = await run("snippet", source);
	check(snippet != null, "the reactive snippet builds for the browser");
	if (snippet) {
		check(await click(snippet.app, "+1"), "the reactive snippet: there is a +1 button");
		check(snippet.app.texts().includes("clicked 1 times"), "the reactive snippet: a click moves the label");
	}
}

// The compiler showcase: "a real mistake and the real diagnostic". The panel
// is the diagnosed file and the terminal beside it is what checking it says,
// so the two are held together — a compiler that rewords or re-spans the
// message fails here, and the page is updated to the new words.
const demo = pres.find((lines) => lines.some((line) => line.startsWith("fun find_user(")));
const shown = pres.find((lines) => lines[0]?.startsWith("Error:"));
check(demo != null && shown != null, "the landing page shows the diagnostic demo and its diagnostic");
if (demo && shown) {
	const file = shown.find((line) => line.includes("╭─["))?.match(/\[ ([^:]+\.vl):/)?.[1] ?? "demo.vl";
	const dir = playgroundDir("demo-", "browser");
	writeFileSync(join(dir, file), programOf(demo));
	const said = vilan(dir, "check", file, "--platform", "browser");
	const lines = said.output.split("\n").map((line) => line.trimEnd());
	const matches = said.status !== 0 && JSON.stringify(lines) === JSON.stringify(shown);
	if (!matches) {
		console.error("      the page shows:");
		for (const line of shown) console.error(`        ${line}`);
		console.error("      the compiler says:");
		for (const line of lines) console.error(`        ${line}`);
	}
	check(matches, "the diagnostic demo: the page shows exactly what the compiler says about the panel's program");
}

// The live demo beside the reactive snippet ("Try it right here").
check(await click(home.app, "+1"), "the landing page's live counter has a +1 button");
check(home.app.texts().includes("clicked 1 times"), "the landing page's live counter follows its signal");

verdict("examples");
