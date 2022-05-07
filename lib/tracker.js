module.exports = function (settings) {
	class AsyncTracker {
		#contexts = [];
		#sources = [];
		#notify;

		constructor(listener, contexts = [window]) {
			this.#notify = listener;

			for (const context of contexts) {
				const obj = {
					native: {},
					context
				};
				this.#contexts.push(obj);

				this.#handlePromise(obj);
				this.#handleTimeout(obj);
				this.#handleReady({
					native: obj.native,
					context: context.document
				});
				this.#handleFetch(obj);
				this.#handleXHR(obj);
			}
		}

		#handleXHR({ native, context }) {
			const it = this;
			native.XMLHttpRequest = context.XMLHttpRequest;
			context.XMLHttpRequest = class XMLHttpRequest extends native.XMLHttpRequest {
				#id;
				#done;
				constructor() {
					super();
					this.#done = () => {
						const id = this.#id;
						if (id == null) return;
						this.#id = null;
						native.clearTimeout.call(context, id);
						it.completes(id);
						this.removeEventListener('abort', this.#done);
						this.removeEventListener('error', this.#done);
						this.removeEventListener('load', this.#done);
					};
				}
				static get [Symbol.species]() {
					return XMLHttpRequest;
				}
				get [Symbol.toStringTag]() {
					return 'XMLHttpRequest';
				}
				send(...args) {
					const ret = super.send(...args);
					this.addEventListener('abort', this.#done);
					this.addEventListener('error', this.#done);
					this.addEventListener('load', this.#done);
					this.#id = native.setTimeout.call(context, () => {
						it.completes(this.#id);
					}, settings.stall);
					it.creates(this.#id);
					return ret;
				}
			};
		}

		#handleFetch({ native, context }) {
			const it = this;
			native.fetch = context.fetch;
			context.fetch = async function (url, ...args) {
				const id = `fetch ${url}`;
				it.creates(id);
				args.unshift(url);
				try {
					const res = await native.fetch.apply(context, args);
					return res;
				} finally {
					it.completes(id);
				}
			};
		}

		#handleReady({ native, context }) {
			const it = this;
			it.creates('loading');
			native.addEventListener = context.addEventListener;
			let count = 0;
			context.addEventListener = (name, fn, cap) => {
				const id = 'loading' + count++;
				it.creates(id);
				native.addEventListener.call(context, name, (e) => {
					try {
						if (fn.handleEvent) fn.handleEvent(e);
						else fn(e);
					} finally {
						it.completes(id);
					}
				}, cap);
			};
			if (context.readyState == 'loading') {
				context.addEventListener('DOMContentLoaded', () => {
					it.completes('loading');
				});
			} else {
				it.completes('loading');
			}
		}

		#handleTimeout({ native, context }) {
			const it = this;

			native.setTimeout = context.setTimeout;
			context.setTimeout = function (fn, to) {
				const id = native.setTimeout.call(context, () => {
					it.completes(id);
					fn.call(this);
				}, to);
				it.creates(id);
				return id;
			};

			native.clearTimeout = context.clearTimeout;
			context.clearTimeout = function (id) {
				it.completes(id);
				return native.clearTimeout.call(context, id);
			};
		}

		#handlePromise({ native, context }) {
			const it = this;
			native.Promise = context.Promise;
			context.Promise = class Promise extends native.Promise {
				static get [Symbol.species]() {
					return Promise;
				}
				get [Symbol.toStringTag]() {
					return 'Promise';
				}
				#tracks(p) {
					it.creates(p);
					const ict = () => it.completes(p);
					super.then.call(p, ict, ict);
					return p;
				}
				then(fn) {
					return this.#tracks(super.then(fn));
				}
				catch(fn) {
					return this.#tracks(super.catch(fn));
				}
				finally(fn) {
					return this.#tracks(super.finally(fn));
				}
			};
		}

		creates(p) {
			this.#sources.push(p);
		}

		completes(p) {
			window.queueMicrotask(() => {
				if (this.#sources.length > 0) {
					this.#sources = this.#sources.filter(op => p !== op);
					if (this.#sources.length === 0) {
						this.#notify();
					}
				}
			});
		}

		destroy() {
			for (const { vault, context } of this.#contexts) {
				for (const [name, prim] of Object.entries(vault)) {
					context[name] = prim;
				}
			}
			this.#contexts = [];
			this.#sources = [];
		}
	}

	Object.defineProperty(window, settings.id, {
		enumerable: false,
		configurable: false,
		writable: false,
		value: new Promise(ok => {
			new AsyncTracker(() => ok("idle"));
		})
	});
};
