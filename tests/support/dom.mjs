// The minimal browser the site's own bundles need — nothing more.
//
// The shape is `crates/vilan-cli/tests/hmr.rs`'s node DOM stub, lifted into
// this repo: stub the HOST, never the code under test. What runs here is the
// real `dist/playground.js`, byte for byte what a visitor is served; only
// `document`, `window` and the vendored `VilanPlayground` bundle are stood in
// for, because they are the boundary the browser (not this repo) owns.
//
// The surface is deliberately tiny, and it is not a guess: it is exactly what
// `std::ui` and `std::dom` emit, which is why a change to std that reaches for
// a new host call fails HERE, loudly, instead of in a visitor's browser. Run
//
//   grep -o 'document\.[a-zA-Z]*\|\.\(appendChild\|replaceChildren\|remove\|setAttribute\|textContent\|hidden\|addEventListener\)' dist/*.js | sort -u
//
// to see the whole set the built bundles actually touch.

/// A DOM element, as far as `std::ui` can tell: a tag, a class attribute, a
/// text body, an ordered child list, and listeners. `textContent = ` clears
/// children exactly as the real setter does — `std::ui`'s `text()` relies on
/// it, and a stub that kept them would report rows that a browser had
/// replaced.
export class StubElement {
	constructor(tag, namespace = null) {
		this.tagName = tag;
		this.namespace = namespace;
		this.children = [];
		this.attributes = {};
		this.listeners = {};
		this.hidden = false;
		this.parentNode = null;
		this._text = "";
	}

	set textContent(value) {
		for (const child of this.children) child.parentNode = null;
		this.children = [];
		this._text = String(value);
	}

	get textContent() {
		return this._text;
	}

	appendChild(child) {
		child.remove();
		child.parentNode = this;
		this.children.push(child);
		return child;
	}

	/// The variadic sibling of `appendChild` — what the vendored bundle uses.
	append(...nodes) {
		for (const node of nodes) this.appendChild(node);
	}

	replaceChildren() {
		for (const child of this.children) child.parentNode = null;
		this.children = [];
	}

	remove() {
		const parent = this.parentNode;
		if (!parent) return;
		parent.children = parent.children.filter((child) => child !== this);
		this.parentNode = null;
	}

	setAttribute(name, value) {
		this.attributes[name] = value;
	}

	addEventListener(event, handler) {
		(this.listeners[event] ??= []).push(handler);
	}

	/// Every text this subtree renders, in document order — the page as a
	/// reader sees it. Assertions phrase themselves against this rather than
	/// against class names, which are generated hashes and would pin the
	/// styling system instead of the behaviour.
	texts(into = []) {
		if (this._text !== "") into.push(this._text);
		for (const child of this.children) child.texts(into);
		return into;
	}
}

/// Installs the stub globals and returns the handles a test drives it by.
/// `mounts` names the ids the page will look for (`mount_root("app", …)`);
/// anything else answers null, which is what a real document does and what
/// `std::ui`'s "mount: no element with id" refusal is built on.
///
/// `vendored: true` adds the handful of members CodeMirror reads at import
/// time (`documentElement.style`, `body`, `head`, `createTextNode`, the
/// selector pair). They are off by default so that the site's own bundles are
/// held to the small surface they actually use: a test that boots only
/// `dist/*.js` should fail if std starts reaching for something new.
export function installDom(mounts = ["app"], { vendored = false } = {}) {
	const elements = new Map();
	for (const id of mounts) elements.set(id, new StubElement("div"));

	const windowListeners = {};
	globalThis.window = globalThis;
	globalThis.document = {
		getElementById: (id) => elements.get(id) ?? null,
		createElement: (tag) => new StubElement(tag),
		createElementNS: (namespace, tag) => new StubElement(tag, namespace),
	};
	globalThis.window.addEventListener = (event, handler) => {
		(windowListeners[event] ??= []).push(handler);
	};

	if (vendored) {
		const html = new StubElement("html");
		html.style = { setProperty() {}, getPropertyValue: () => "" };
		globalThis.document.documentElement = html;
		globalThis.document.body = new StubElement("body");
		globalThis.document.head = new StubElement("head");
		globalThis.document.createTextNode = (content) => {
			const node = new StubElement("#text");
			node.textContent = content;
			return node;
		};
		globalThis.document.querySelector = () => null;
		globalThis.document.querySelectorAll = () => [];
	}

	return {
		mount: (id) => elements.get(id),
		/// Dispatch a synthetic event at the window, the way a `postMessage`
		/// from another document arrives. `event` is the event object itself:
		/// a test writes `{ data, origin, source }` and controls every field
		/// an attacker would.
		dispatch(type, event) {
			const handlers = windowListeners[type] ?? [];
			if (handlers.length === 0) throw new Error(`nothing is listening for "${type}"`);
			for (const handler of handlers) handler(event);
			return handlers.length;
		},
		listenerCount: (type) => (windowListeners[type] ?? []).length,
	};
}
