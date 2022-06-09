const { Deferred } = require('class-deferred');

module.exports = class RequestTracker extends Deferred {
	#requests = 0;

	constructor(page) {
		super();
		page.on('request', () => this.#creates());
		page.on('requestfinished', () => this.#completes());
		page.on('requestfailed', () => this.#completes());
	}
	#creates() {
		this.#requests++;
	}
	#completes() {
		this.#requests--;
		if (this.#requests == 0) {
			setImmediate(this.resolve);
		}
	}
};
