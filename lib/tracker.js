module.exports = function (fnid) {

	class PromiseTracker {
		#contexts = [];
		#promises = [];
		#notify;

		constructor(listener, contexts = [window]) {
			this.#notify = listener;
			const it = this;

			for (const context of contexts) {
				const obj = {
					context
				};
				this.#contexts.push(obj);

				obj.Promise = context.Promise;
				context.Promise = class TrackingPromise extends obj.Promise {
					static get [Symbol.species]() {
						return Promise;
					}
					get [Symbol.toStringTag]() {
						return 'Promise';
					}
					constructor(fn) {
						super(fn);
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
		}

		creates(p) {
			this.#promises.push(p);
		}

		completes(p) {
			if (this.#promises.length > 0) {
				this.#promises = this.#promises.filter(op => p !== op);
				if (this.#promises.length === 0) {
					this.#notify();
				}
			}
		}

		destroy() {
			for (const obj of this.#contexts) {
				obj.context.Promise = obj.Promise;
			}
			this.#contexts = [];
			this.#promises = [];
		}
	}

	window[fnid] = new Promise(ok => {
		new PromiseTracker(() => {
			console.info("Settling promise");
			ok({ name: "settled" });
		});
	});
};
