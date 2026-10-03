// The Format button's status note, end to end through the real page bundle
// (K15).
//
// The defect: the deployed glue called the String-shaped `format`, which hands
// back the ORIGINAL bytes whenever the formatter declines (the buffer does not
// parse, or the printer has no rule for a construct in it). The page could not
// tell that from a buffer that was already canonical, so pressing Format on a
// broken program said "Format made no changes." - true of the bytes, false of
// the formatter. The worker now calls `format_checked` where the loaded release
// exports it and carries the decline's sentence on the "formatted" event; the
// page shows it. scripts/smoke-playground.mjs holds the other half: the shipped
// wasm really declines, with a sentence, on a buffer it cannot reprint.

import { bootPlayground, bootCompiler } from "./support/playground.mjs";
import { check, verdict } from "./support/check.mjs";

const bundle = new URL("../dist/playground.js", import.meta.url).href;
const page = await bootPlayground({ bundle });
bootCompiler(page);

const sentence = "it does not parse";
page.compilerEvent({ kind: "formatted", text: "fun main( {", changed: false, declined: sentence });
check(
	page.shows(`Format left the buffer unchanged — ${sentence}`),
	"a declined format says so, in the formatter's own words",
);
check(!page.shows("Format made no changes."), "a declined format does not claim the buffer was already canonical");

page.compilerEvent({ kind: "formatted", text: "fun main() {}\n", changed: true, declined: "" });
check(page.shows("Formatted."), "a reprint that changed the buffer says Formatted.");

page.compilerEvent({ kind: "formatted", text: "fun main() {}\n", changed: false, declined: "" });
check(page.shows("Format made no changes."), "a canonical buffer says the format made no changes");

verdict("playground format");
