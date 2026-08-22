// The compile worker: resolve which compiler version to load, load it once,
// then answer each posted request. The wasm instance leaks per compile by
// design (see the D11 proposal §6) and a compiler panic can poison its
// memory, so the page-side bundle recycles this whole worker rather than
// trusting it to run forever - the worker itself stays a thin adapter.
//
// Version resolution: `worker.js?v=<tag>` pins one (the future version
// selector's hook); otherwise manifest.json names the current release. The
// pair then loads from its VERSIONED directory - immutable URLs a browser
// may cache forever, so a release rollover can never serve a mixed
// glue/wasm pair; only the tiny always-revalidated manifest moves.
//
// The glue is imported as a NAMESPACE and probed: `format` arrived after
// v0.18.2, and a static named import of an export the loaded release does
// not have would fail the whole module. Capability rides the ready message.
//
// Messages in:  { action: "compile" | "check" | "format", source,
//                 platform: "browser" | "node" }
//               { action: "complete", id, source, line, character }
// Messages out:
//   { kind: "ready",     version, canFormat, canPlatform, canComplete }
//                                                      - compiler live
//   { kind: "result",    ok, js, css, version, diagnostics: [...] }
//   { kind: "checked",   ok, version, diagnostics: [...] }  - live check;
//                        same compile, but no emitted program rides back
//   { kind: "formatted", text, changed }              - format's answer
//   { kind: "completed", id, items: [...] }           - completion's answer,
//                        from the analysis the last compile/check retained
//                        (no analysis runs; it leaks nothing and does not
//                        count toward the recycle budget)
//   { kind: "crash",     error }                      - recycle me

const pinned = new URL(self.location.href).searchParams.get("v");
const release = pinned
	?? (await (await fetch(new URL("./manifest.json", import.meta.url), { cache: "no-cache" })).json()).compiler;

const glue = await import(new URL(`./${release}/vilan_wasm.js`, import.meta.url).href);

const wasm = await (async () => {
	const response = await fetch(new URL(`./${release}/vilan_wasm_bg.wasm.gz`, import.meta.url));
	if (!response.ok) {
		throw new Error(`fetching the compiler failed: HTTP ${response.status}`);
	}
	const inflated = response.body.pipeThrough(new DecompressionStream("gzip"));
	return new Response(inflated).arrayBuffer();
})();
await glue.default({ module_or_path: wasm });

const canFormat = typeof glue.format === "function";
// compile_for arrived after v0.19.0; without it every request is a browser
// compile and the page hides its mode toggle.
const canPlatform = typeof glue.compile_for === "function";
// complete arrived after v0.35.0 (K9); without it the editor registers no
// completion source at all.
const canComplete = typeof glue.complete === "function";
postMessage({ kind: "ready", version: glue.version(), canFormat, canPlatform, canComplete });

function compileWith(source, platform) {
	if (platform === "node" && canPlatform) {
		return glue.compile_for(String(source), "node");
	}
	return glue.compile(String(source));
}

// One completion candidate as a plain object: the glue hands back class
// instances over wasm memory, which cannot cross postMessage and would
// otherwise wait for the finalizer to release their Rust side.
function completionItem(item) {
	const plain = {
		label: item.label,
		kind: item.kind,
		detail: item.detail,
		documentation: item.documentation,
		insert: item.insert,
		isSnippet: item.is_snippet,
		boost: item.boost,
		importEdit: item.import_text == null
			? null
			: {
				line: item.import_line,
				character: item.import_character,
				endLine: item.import_end_line,
				endCharacter: item.import_end_character,
				text: item.import_text,
			},
	};
	item.free();
	return plain;
}

onmessage = (event) => {
	const { action, source, platform } = event.data;
	try {
		if (action === "format") {
			const text = canFormat ? glue.format(String(source)) : String(source);
			postMessage({ kind: "formatted", text, changed: text !== String(source) });
			return;
		}
		if (action === "complete") {
			const { id, line, character } = event.data;
			const items = canComplete
				? glue.complete(String(source), line, character).map(completionItem)
				: [];
			postMessage({ kind: "completed", id, items });
			return;
		}
		const result = compileWith(source, platform);
		const diagnostics = result.diagnostics.map((diagnostic) => ({
			severity: diagnostic.severity,
			file: diagnostic.file,
			line: diagnostic.line,
			column: diagnostic.column,
			message: diagnostic.message,
			note: diagnostic.note ?? "",
			// The E78 requirement chain (E80), entry → read; absent on a
			// release older than the field, hence the default.
			trace: (diagnostic.trace ?? []).map((hop) => ({
				file: hop.file,
				line: hop.line,
				column: hop.column,
				message: hop.message,
				call: hop.call,
			})),
			start: diagnostic.start,
			end: diagnostic.end,
		}));
		if (action === "check") {
			postMessage({
				kind: "checked",
				ok: result.js != null,
				version: glue.version(),
				platform: platform ?? "browser",
				diagnostics,
			});
			return;
		}
		postMessage({
			kind: "result",
			ok: result.js != null,
			js: result.js ?? "",
			css: result.css ?? "",
			version: glue.version(),
			platform: platform ?? "browser",
			diagnostics,
		});
	} catch (error) {
		// A wasm trap (panic past the fence, stack overflow) lands here; the
		// instance's memory is suspect from now on.
		postMessage({ kind: "crash", error: String(error) });
	}
};
