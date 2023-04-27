const { Deferred } = require('class-deferred');

module.exports = class RequestTracker extends Deferred {
	#requests = 0;
	#tracker;

	constructor(page, tracker) {
		super();
		this.#tracker = tracker;
		page.on('request', req => this.#creates(req));
		page.on('requestfinished', req => this.#completes(req));
		page.on('requestfailed', req => this.#completes(req));
	}
	#creates(req) {
		this.#requests++;
	}
	#completes(req) {
		this.#requests--;
		if (this.#requests == 0 && this.#tracker.done) {
			this.resolve();
		}
	}
};
