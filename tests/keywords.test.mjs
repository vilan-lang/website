// The playground editor's keywords are the COMPILER's (K27).
//
// The editor kept a hand list, and it drifted from the language: no `css`, no
// `then` (B459's infix conditional), `with`/`own`/`jump`/`borrows` painted
// everywhere after the lexer demoted them to contextual words, and
// `resource` still a keyword after it became the `[resource]` attribute. The
// list is now generated (scripts/gen-keywords.mjs → playground/keywords.js)
// and this file holds it, and the tokenizer that paints with it, to the
// installed `vilan` — the released toolchain in CI — in three ways:
//
//   1. the committed list is what `vilan --print-keywords` prints today (the
//      compiler's lexing::KEYWORDS + CONTEXTUAL_KEYWORDS);
//   2. the compiler's behaviour agrees with that split: every word is probed
//      as a binder name (`let WORD = 1;`), and the words it refuses are
//      exactly the ones the tokenizer paints as an operand (`x + WORD`);
//   3. the COMMITTED bundle (src/playground/editor.js, so an unrebuilt bundle
//      fails) paints every reserved word, paints each contextual word in its
//      keyword position and nowhere else, and reads attributes as attributes.
//
// Blind spots, said plainly: the in-position probes below are hand-written
// from the compiler's own position sentences (CONTEXTUAL_KEYWORDS), so a new
// contextual word fails here until someone writes its rule AND its probes,
// but a contextual word whose POSITION grows (a new place the keyword reads)
// is not seen by any oracle the released toolchain exposes; and `self`/`Self`
// are painted as fixed names everywhere (both toolchain grammars do the
// same), although the compiler accepts them as binder names.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installDom } from "./support/dom.mjs";
import { check, verdict } from "./support/check.mjs";
import { compilerTable, generate } from "../scripts/gen-keywords.mjs";

const root = new URL("..", import.meta.url);

// --- 1. the list is the compiler's ------------------------------------------

const table = compilerTable();
const contextual = table.contextual;
const reserved = table.keywords.filter((word) => !contextual.includes(word));
check(reserved.length > 0 && contextual.length > 0, `vilan --print-keywords: ${reserved.length} reserved, ${contextual.length} contextual`);
check(
	readFileSync(new URL("playground/keywords.js", root), "utf8") === generate(table),
	"playground/keywords.js is the installed compiler's table (node scripts/gen-keywords.mjs, then rebuild the editor bundle)",
);

// --- the committed bundle's tokenizer ----------------------------------------

installDom(["runner"], { vendored: true });
await import(new URL("src/playground/editor.js", root).href);
const tokens = globalThis.VilanPlayground?.tokens;
check(typeof tokens === "function", "the bundle exports its tokenizer");
const PAINTED = new Set(["keyword", "atom"]);

/// The style of the first token spelled `word` in `text`.
function styleOf(text, word) {
	const found = tokens(text).find(([token]) => token === word);
	return found ? found[1] : undefined;
}

// --- 2. the compiler's behaviour agrees with the split -----------------------

// The fixed NAMES among the contextual words: painted like the literals
// wherever they stand (the book's highlighter does the same), so they are
// the one place the tokenizer and a binder probe may disagree.
const FIXED_NAMES = ["self", "Self", "void"];

const scratch = mkdtempSync(join(tmpdir(), "site-keywords-"));
try {
	writeFileSync(join(scratch, "probe.vl"), "");
	for (const word of table.keywords) {
		const source = `fun main() {\n\tlet ${word} = 1;\n}\n`;
		writeFileSync(join(scratch, "probe.vl"), source);
		const run = spawnSync("vilan", ["check", "probe.vl", "--platform", "browser"], {
			cwd: scratch,
			encoding: "utf8",
			env: { ...process.env, NO_COLOR: "1" },
		});
		const refused = run.status !== 0;
		// The editor's reading of the word as an OPERAND — the one position no
		// contextual reading occupies. (Not the probe's own `let ${word} =`,
		// which both toolchain grammars and this tokenizer read as a field
		// name's position — `type = …` in a literal — and so leave plain.)
		const painted = PAINTED.has(styleOf(`let y = x + ${word};`, word));
		if (FIXED_NAMES.includes(word)) {
			check(painted, `${word}: painted as a fixed name (the compiler ${refused ? "refuses" : "accepts"} it as a binder)`);
		} else {
			check(
				refused === painted,
				`${word}: the compiler ${refused ? "refuses" : "accepts"} it as a name (\`let ${word} = 1;\`) and the editor ${painted ? "paints" : "does not paint"} it as an operand`,
			);
		}
		if (reserved.includes(word)) check(refused, `${word}: reserved, and the compiler refuses it as a name`);
	}
} finally {
	rmSync(scratch, { recursive: true, force: true });
}

// --- 3. the tokenizer, word by word -------------------------------------------

for (const word of reserved) {
	check(PAINTED.has(styleOf(`${word} x`, word)), `${word}: reserved — painted`);
	check(!PAINTED.has(styleOf(`a.${word}`, word)), `${word}: a member named ${word} (\`a.${word}\`) is a name`);
	check(!PAINTED.has(styleOf(`${word}: i32`, word)), `${word}: a field named ${word} is a name`);
}

// Each contextual word in its keyword position (`in`, painted) and where a
// name stands (`out`, not painted) — the positions are the compiler's own
// sentences (lexing::CONTEXTUAL_KEYWORDS, the marker census).
const POSITIONS = {
	as: {
		in: ["import a::b as c;", "use a::{ b as c };"],
		out: ["let as = 1;", "f(as)", "x.as", "as: i32"],
	},
	borrows: {
		in: ["fun first(xs: &List<T>): &T borrows xs {"],
		out: ["let borrows = 1;", "borrows.len()", "f(borrows)"],
	},
	context: {
		in: ["fun f(): i32 context settings {", "let run: (|| void) context owner = g;"],
		out: ["let context = 1;", "context.run(f)", "context: Ctx", "f(context)"],
	},
	dyn: {
		in: ["let source: dyn Source<i32> = s;"],
		out: ["let dyn = 1;", "dyn::f()", "dyn.x", "f(dyn)"],
	},
	jump: {
		in: ["jump break;", "jump continue;"],
		out: ["let jump = 1;", "jump.height", "f(jump)"],
	},
	lazy: {
		in: ["lazy let config = load();", "fun expect(self, lazy message: str) {"],
		out: ["let lazy = 1;", "lazy.get()", "f(lazy)"],
	},
	only: {
		in: ["import a::{ b } only;", "import a::b only;", "} only;"],
		out: ["let only = 1;", "only;", "f(only);", "ret only;"],
	},
	own: {
		in: ["fun take(own list: List<i32>) {"],
		out: ["let own = 1;", "own: Owner", "own.x", "f(own)"],
	},
	sync: {
		in: ["let f: (sync || View) = g;"],
		out: ["let sync = 1;", "sync.x", "f(x, sync)"],
	},
	then: {
		in: [
			"ready then go() else wait()",
			"ready then go();",
			"x > 1 then a else b",
			"f(x) then y",
			"list[0] then a",
			"name == \"a\" then a",
			"i\"{ready then \"yes\" else \"no\"}\"",
		],
		out: [
			"let then = 1;",
			"for then in xs {}",
			"then: i32",
			"promise.then(f)",
			"fun f(then: i32) {}",
			"f(then)",
			"x = then;",
			"ret then;",
			"fun then() {}",
		],
	},
	with: {
		in: ["impl Point with Show {", "trait Eq with PartialEq {"],
		out: ["let with = 1;", "list.with(f)", "with: i32"],
	},
};

for (const word of contextual) {
	if (FIXED_NAMES.includes(word)) {
		check(styleOf(`let x = ${word};`, word) === "atom", `${word}: a fixed name, painted like a literal`);
		continue;
	}
	const probes = POSITIONS[word];
	check(probes != null, `${word}: contextual, with a rule and probes here (a new contextual word needs both)`);
	if (!probes) continue;
	for (const text of probes.in) check(styleOf(text, word) === "keyword", `${word}: painted in \`${text}\``);
	for (const text of probes.out) check(!PAINTED.has(styleOf(text, word)), `${word}: a name in \`${text}\``);
}

// A word that is no longer a keyword stays plain: `resource` is the
// `[resource]` attribute now, and attributes read as attributes.
check(!PAINTED.has(styleOf("resource x", "resource")), "resource: no longer a keyword");
for (const attribute of ["[resource]", "[derive(Debug, PartialEq)]", "[extern(\"f\")]", "[platform(\"browser\")]"]) {
	check(tokens(`${attribute}\nstruct S {}`)[0]?.[1] === "attr", `${attribute} reads as an attribute`);
}
check(styleOf("let x = a[0];", "[") !== "attr", "an index is not an attribute");

verdict("keywords");
