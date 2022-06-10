module.exports = function (trackerOpts) {
	const { debug } = trackerOpts;

	class Track {
		native = {};
		context;
		constructor(context) {
			this.context = context;
		}
	}

	class AsyncTracker {
		#tracks = [];
		#sources = new Set();
		#count = 0;
		#resolve;

		constructor(contexts = [window]) {
			this.promise = new Promise(ok => {
				this.#resolve = ok;
			});

			for (const context of contexts) {
				const track = new Track(context);
				this.#tracks.push(track);

				this.#handleMicrotask(track);
				this.#handleRequestAnimationFrame(track);
				this.#handleTimeout(track);
				this.#handleReady(track);
				this.#handleFetch(track);
				this.#handleXHR(track);
				this.#handleNodes(track);
				this.#handlePromises(track);
			}
		}

		#handlePromises({ native, context }) {
			const it = this;
			native.Promise = context.Promise;
			context.Promise = class Promise extends native.Promise {
				static get [Symbol.species]() {
					return this;
				}
				#wrap(fn) {
					if (typeof fn != "function") return fn;
					return (...args) => {
						const id = it.creates('p');
						try {
							return fn(...args);
						} finally {
							it.completes(id);
						}
					};
				}
				then(res, rej) {
					return super.then(this.#wrap(res), this.#wrap(rej));
				}
			};
		}

		#handleNode(node) {
			const id = this.waits(node.nodeName + ' ' + (node.src ?? node.href));
			const itc = () => {
				node.removeEventListener('load', itc);
				node.removeEventListener('error', itc);
				this.completes(id);
			};
			node.addEventListener('load', itc);
			node.addEventListener('error', itc);
		}

		#unhandleNode(node) {
			this.completes(node.nodeName + ' ' + (node.src ?? node.href));
		}

		#handleNodes({ context }) {
			function check(node) {
				if (node.nodeType != Node.ELEMENT_NODE) return;
				const tag = node.nodeName;
				if (tag == "SCRIPT") {
					return node.src && (!node.type || node.type == "text/javascript" || node.type == "module");
				} else if (tag == "LINK") {
					return node.href && node.rel == "stylesheet";
				}
			}
			const observer = new MutationObserver(mutations => {
				for (const { addedNodes, removedNodes } of mutations) {
					if (addedNodes) for (const node of addedNodes) {
						if (check(node)) this.#handleNode(node);
					}
					if (removedNodes) for (const node of removedNodes) {
						if (check(node)) this.#unhandleNode(node);
					}
				}
			});
			observer.observe(context.document, {
				childList: true,
				subtree: true
			});
		}

		#handleXHR({ native, context }) {
			const it = this;
			const events = ["abort", "error", "load"];
			native.XMLHttpRequest = context.XMLHttpRequest;
			context.XMLHttpRequest = class XMLHttpRequest extends native.XMLHttpRequest {
				#id;
				#done;
				constructor() {
					super();
					this.#done = () => {
						for (const ev of events) {
							this.removeEventListener(ev, this.#done);
						}
						it.completes(this.#id);
					};
				}
				static get [Symbol.species]() {
					return XMLHttpRequest;
				}
				get [Symbol.toStringTag]() {
					return 'XMLHttpRequest';
				}
				send(...args) {
					for (const ev of events) {
						this.addEventListener(ev, this.#done);
					}
					this.#id = it.creates('xhr');
					try {
						return super.send(...args);
					} catch (err) {
						it.completes(this.#id);
						throw err;
					}
				}
			};
		}

		#handleFetch({ native, context }) {
			const it = this;
			native.fetch = context.fetch;
			context.fetch = function fetch(...args) {
				const id = it.creates('fetch');
				try {
					const r = native.fetch.apply(context, args);
					r.finally(() => it.completes(id));
					return r;
				} catch (err) {
					it.completes(id);
				}
			};
		}

		#handleReady({ native, context }) {
			const it = this;
			const { document: doc } = context;
			native.removeEventListener = doc.removeEventListener;
			native.addEventListener = doc.addEventListener;
			native.bubbles = new Map();
			native.captures = new Map();
			class EventWatch {
				constructor(name, fn) {
					this.id = it.creates(doc.readyState == "loading" ? name : null);
					this.fn = fn;
				}
				async handleEvent(e) {
					try {
						if (this.fn.handleEvent) await this.fn.handleEvent(e);
						else if (typeof this.fn == "function") await this.fn(e);
					} finally {
						it.completes(this.id);
						this.id = null;
					}
				}
			}
			doc.addEventListener = function (name, fn, cap) {
				const ft = typeof fn;
				if (name != "DOMContentLoaded" || !fn || !["object", "function"].includes(ft)) {
					return native.addEventListener.call(doc, name, fn, cap);
				}
				const eMap = cap ? native.captures : native.bubbles;
				if (eMap.has(fn)) return;
				const watch = new EventWatch(name, fn);
				eMap.set(fn, watch);
				return native.addEventListener.call(doc, name, watch, cap);
			};
			doc.removeEventListener = function (name, fn, cap) {
				const ft = typeof fn;
				if (name != "DOMContentLoaded" || !fn || !["object", "function"].includes(ft)) {
					return native.removeEventListener.call(doc, name, fn, cap);
				}
				const eMap = cap ? native.captures : native.bubbles;
				const watch = eMap.get(fn);
				if (!watch) return;
				it.completes(watch.id);
				return native.removeEventListener.call(doc, name, watch, cap);
			};
		}

		#handleMicrotask({ native, context }) {
			const it = this;
			native.queueMicrotask = context.queueMicrotask;
			context.queueMicrotask = function (fn) {
				if (typeof fn != "function") {
					return native.queueMicrotask.call(context, fn);
				}
				const id = it.creates('task');
				native.queueMicrotask.call(context, () => {
					try {
						fn.call(this);
					} finally {
						it.completes(id);
					}
				});
			};
		}

		#handleTimeout({ native, context }) {
			const it = this;
			native.setTimeout = context.setTimeout;
			context.setTimeout = function (fn, to) {
				if (typeof fn != "function") {
					return native.setTimeout.call(context, fn, to);
				}
				const id = 'to' + native.setTimeout.call(context, () => {
					try {
						fn.call(this);
					} finally {
						it.completes(id);
					}
				}, to);
				it.waits(id);
			};

			native.clearTimeout = context.clearTimeout;
			context.clearTimeout = function (id) {
				const rid = native.clearTimeout.call(context, id);
				it.completes('to' + id);
				return rid;
			};
		}

		#handleRequestAnimationFrame({ native, context }) {
			const it = this;
			native.requestAnimationFrame = context.requestAnimationFrame;
			context.requestAnimationFrame = function (fn) {
				if (typeof fn != "function") {
					return native.requestAnimationFrame.call(context, fn);
				}
				const id = 'raf' + native.requestAnimationFrame.call(context, () => {
					try {
						fn.call(this);
					} finally {
						it.completes(id);
					}
				});
				it.waits(id);
				return id;
			};

			native.cancelAnimationFrame = context.cancelAnimationFrame;
			context.cancelAnimationFrame = function (id) {
				const rid = native.cancelAnimationFrame.call(context, id);
				it.completes('raf' + id);
				return rid;
			};
		}

		waits(id) {
			if (id == null) return;
			this.#sources?.add(id);
			return id;
		}
		creates(prefix) {
			if (prefix == null) return;
			const id = `${prefix}${this.#count++}`;
			debug?.("creates", id);
			this.#sources?.add(id);
			return id;
		}

		completes(id) {
			if (id == null) return;
			debug?.("completes", id);
			if (this.#tracks == null) {
				debug?.("destroyed");
				return;
			}
			const { context, native } = this.#tracks[0];
			// run after all microtasks
			native.setTimeout.call(context, () => this.#done(id));
		}

		#done(id) {
			this.#sources?.delete(id);
			if (this.#sources?.size === 0) {
				this.#destroy();
				debug?.("idle");
				this.#resolve("idle");
			}
		}

		#destroy() {
			for (const { native, context } of this.#tracks) {
				for (const [name, prim] of Object.entries(native)) {
					context[name] = prim;
				}
			}
			this.#tracks = null;
			this.#sources = null;
		}
	}

	const tracker = new AsyncTracker();

	// tracker must at least wait for this
	document.addEventListener('DOMContentLoaded', () => { });

	Object.defineProperty(window, trackerOpts.id, {
		enumerable: false,
		configurable: false,
		writable: false,
		value: tracker.promise
	});
};
