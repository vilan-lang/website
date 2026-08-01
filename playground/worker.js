// The compile worker: load the wasm compiler once, then answer each posted
// request. The wasm instance leaks per compile by design (see the D11
// proposal §6) and a compiler panic can poison its memory, so the page-side
// bundle recycles this whole worker rather than trusting it to run forever —
// the worker itself stays a thin adapter.
//
// The glue is imported as a NAMESPACE and probed: `format` arrived after
// v0.18.2, and a static named import of an export the loaded release does not
// have would fail the whole module. Capability rides the ready message.
//
// Messages in:  { action: "compile" | "format", source }
// Messages out:
//   { kind: "ready",     version, canFormat }         — the compiler is live
//   { kind: "result",    ok, js, css, version, diagnostics: [...] }
//   { kind: "formatted", text, changed }              — format's answer
//   { kind: "crash",     error }                      — recycle me
import * as glue from "./vilan_wasm.js";

const wasm = await (async () => {
	const response = await fetch(new URL("./vilan_wasm_bg.wasm.gz", import.meta.url));
	if (!response.ok) {
		throw new Error(`fetching the compiler failed: HTTP ${response.status}`);
	}
	const inflated = response.body.pipeThrough(new DecompressionStream("gzip"));
	return new Response(inflated).arrayBuffer();
})();
await glue.default({ module_or_path: wasm });

const canFormat = typeof glue.format === "function";
postMessage({ kind: "ready", version: glue.version(), canFormat });

onmessage = (event) => {
	const { action, source } = event.data;
	try {
		if (action === "format") {
			const text = canFormat ? glue.format(String(source)) : String(source);
			postMessage({ kind: "formatted", text, changed: text !== String(source) });
			return;
		}
		const result = glue.compile(String(source));
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
			version: glue.version(),
			diagnostics,
		});
	} catch (error) {
		// A wasm trap (panic past the fence, stack overflow) lands here; the
		// instance's memory is suspect from now on.
		postMessage({ kind: "crash", error: String(error) });
	}
};
