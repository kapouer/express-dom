module.exports = function (trackerOpts) {
	class CustomTracker {
		#resolve;

		constructor(opts) {
			const contexts = [window];
			const promise = new Promise(ok => {
				this.#resolve = ok;
			});

			for (const context of contexts) {
				if (context != context.top) continue;
				Object.defineProperty(context, `signal_${opts.id}`, {
					enumerable: false,
					configurable: false,
					writable: false,
					value: promise
				});
				const trackFn = context[`track_${opts.id}`];
				if (typeof trackFn == "function") {
					context.document.addEventListener('DOMContentLoaded', async () => {
						try {
							await trackFn(context);
						} finally {
							this.#resolve("idle");
						}
					});
				} else {
					console.error("Option track is expected to be a function or a boolean");
					this.#resolve("timeout");
				}
			}
		}
	}

	new CustomTracker(trackerOpts);
};
