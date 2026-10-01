// A program text's fingerprint: 53 bits of cyrb53, as 14 hex digits.
//
// ONE home, two readers: scripts/gen-examples.mjs fingerprints every example
// text the playground has ever shipped and retired (into the generated
// examples.js), and the editor bundle (editor-src/editor.mjs, which esbuild
// inlines this into) fingerprints the buffer it restores from localStorage. A
// restored buffer that is verbatim a RETIRED example is not the visitor's
// program - it is a stale copy of ours, seeded before a language change
// rotted it (K25: the old counter's `.map`, restored on every return visit
// after v0.42.0 renamed it) - so the editor swaps in the current example.
//
// Not a security boundary: a collision would only mean a buffer that happens
// to hash like an old example gets the current example instead, and 53 bits
// against a handful of retired texts makes that a non-event.
export function fingerprint(text) {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < text.length; i++) {
		const ch = text.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
	h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
	h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}
