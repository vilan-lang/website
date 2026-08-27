// The playground console's admission rule, end to end through the real bundle.
//
// The defect (tracker K18): `window.addEventListener("message", …)` hears from
// every document that holds a handle on this window — the page that embedded
// the playground in an iframe, the page that opened it, a sibling frame — and
// the page wrote whatever arrived straight into the console it presents as the
// visitor's own program output.
//
// The check is a per-Run secret, not an origin test, and the difference is the
// whole point: the runner iframe is `sandbox="allow-scripts"` with no
// `allow-same-origin`, so its messages arrive with `origin` exactly `"null"` —
// which is not an identity but the value EVERY opaque-origin document
// presents, a hostile page's own sandboxed frame included. `origin_is_not_an
// _identity` below is that case, and it is the one an origin check would let
// through.

import { bootPlayground, bootCompiler, compileSucceeded } from "./support/playground.mjs";
import { check, verdict } from "./support/check.mjs";

const bundle = new URL("../dist/playground.js", import.meta.url).href;
const page = await bootPlayground({ bundle });

// --- the page is up, and it is listening ---

check(page.messageListeners() === 1, "the page registers exactly one window `message` listener");
check(page.shows("Loading the compiler…"), "the page mounted and rendered its status line");

// --- before any Run there is no frame, so nothing may write the console ---

const beforeRun = "sentinel-before-any-run";
page.postMessage({ data: { kind: "log", text: beforeRun }, origin: "https://vilan-lang.org" });
check(!page.shows(beforeRun), "a message arriving before the first Run is dropped");
// The empty-token edge: the page holds "" when no program is mounted, and a
// sender that supplies "" must not match it.
const emptyToken = "sentinel-empty-token";
page.postMessage({ data: { kind: "log", text: emptyToken, token: "" }, origin: "null" });
check(!page.shows(emptyToken), 'a message quoting the empty token is dropped (`"" == ""` must not admit)');

// --- the first Run mints a token and hands it to the bundle ---

bootCompiler(page);
check(page.calls.compile.length === 1, "the page auto-ran once the compiler and the document were both ready");
compileSucceeded(page);
check(page.calls.runProgram.length === 1, "a clean browser result mounts a program");

const [, , tokenA] = page.calls.runProgram[0];
check(typeof tokenA === "string" && tokenA.length >= 16, `the page hands runProgram a Run token (${tokenA})`);
check(/^[0-9a-f-]+$/.test(tokenA ?? ""), "the Run token is hex-and-hyphens, so it cannot close the <script> it is spliced into");

// --- the real frame's output lands ---

const fromFrame = "sentinel-from-the-runner";
page.postMessage({ data: { kind: "log", text: fromFrame, token: tokenA }, origin: "null" });
check(page.shows(fromFrame), "a message quoting this Run's token reaches the console");

const errorFromFrame = "sentinel-runner-error";
page.postMessage({ data: { kind: "error", text: errorFromFrame, token: tokenA }, origin: "null" });
check(page.shows(errorFromFrame), "an `error` line from this Run's frame reaches the console too");

// --- nobody else's does ---

const embedder = "sentinel-embedding-page";
page.postMessage({ data: { kind: "log", text: embedder }, origin: "https://embedder.example" });
check(!page.shows(embedder), "a message from an embedding page, carrying no token, is dropped");

const guessed = "sentinel-guessed-token";
page.postMessage({
	data: { kind: "log", text: guessed, token: "00000000-0000-4000-8000-000000000000" },
	origin: "https://embedder.example",
});
check(!page.shows(guessed), "a message quoting a wrong token is dropped");

// The case an origin check would admit: a hostile page posting from inside a
// sandboxed frame of its own presents the same `"null"` the runner does.
const opaque = "sentinel-opaque-origin";
page.postMessage({ data: { kind: "log", text: opaque }, origin: "null" });
check(!page.shows(opaque), "origin is not an identity: an opaque-origin sender without the token is dropped");

// A page can also lie about the field outright.
const spoofed = "sentinel-spoofed-origin";
page.postMessage({ data: { kind: "log", text: spoofed, token: `${tokenA}x` }, origin: "null" });
check(!page.shows(spoofed), "a near-miss token (the real one with a character appended) is dropped");

// --- a second Run rotates the token, and the old one dies with its frame ---

compileSucceeded(page, { js: "// second program\n" });
check(page.calls.runProgram.length === 2, "a second clean result mounts a second program");
const [, , tokenB] = page.calls.runProgram[1];
check(tokenB !== tokenA, "each Run gets its own token");

const replayed = "sentinel-replayed-token";
page.postMessage({ data: { kind: "log", text: replayed, token: tokenA }, origin: "null" });
check(!page.shows(replayed), "the previous Run's token no longer admits anything");

const currentRun = "sentinel-second-run";
page.postMessage({ data: { kind: "log", text: currentRun, token: tokenB }, origin: "null" });
check(page.shows(currentRun), "the current Run's token still admits its own frame");

// --- a failed build tears the frame down, and the token with it ---

page.compilerEvent({
	kind: "result",
	version: "0.0.0-test",
	ok: false,
	platform: "browser",
	js: "",
	css: "",
	diagnostics: [],
});
check(page.calls.clearProgram === 1, "a failed build clears the runner");
const afterFailure = "sentinel-after-a-failed-build";
page.postMessage({ data: { kind: "log", text: afterFailure, token: tokenB }, origin: "null" });
check(!page.shows(afterFailure), "no token admits anything once the runner has been cleared");

verdict("playground console");
