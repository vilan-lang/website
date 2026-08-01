// The compile worker: load the wasm compiler once, then answer each posted
// source with a normalized result. The wasm instance leaks per compile by
// design (see the D11 proposal §6) and a compiler panic can poison its
// memory, so the page-side bundle recycles this whole worker rather than
// trusting it to run forever — the worker itself stays a thin adapter.
//
// Messages out:
//   { kind: "ready",  version }                       — the compiler is live
//   { kind: "result", ok, js, css, version, diagnostics: [...] }
//   { kind: "crash",  error }                         — recycle me
import init, { compile, version } from "./vilan_wasm.js";

const wasm = await (async () => {
	const response = await fetch(new URL("./vilan_wasm_bg.wasm.gz", import.meta.url));
	if (!response.ok) {
		throw new Error(`fetching the compiler failed: HTTP ${response.status}`);
	}
	const inflated = response.body.pipeThrough(new DecompressionStream("gzip"));
	return new Response(inflated).arrayBuffer();
})();
await init({ module_or_path: wasm });

postMessage({ kind: "ready", version: version() });

onmessage = (event) => {
	try {
		const result = compile(String(event.data));
		const diagnostics = result.diagnostics.map((diagnostic) => ({
			severity: diagnostic.severity,
			file: diagnostic.file,
			line: diagnostic.line,
			column: diagnostic.column,
			message: diagnostic.message,
			note: diagnostic.note ?? "",
			start: diagnostic.start,
			end: diagnostic.end,
		}));
		postMessage({
			kind: "result",
			ok: result.js != null,
			js: result.js ?? "",
			css: result.css ?? "",
			version: version(),
			diagnostics,
		});
	} catch (error) {
		// A wasm trap (panic past the fence, stack overflow) lands here; the
		// instance's memory is suspect from now on.
		postMessage({ kind: "crash", error: String(error) });
	}
};
