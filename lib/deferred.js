module.exports = class Deferred extends Promise {
	constructor() {
		let pass, fail;
		super((resolve, reject) => {
			pass = resolve;
			fail = reject;
		});
		this.resolve = obj => pass(obj);
		this.reject = err => fail(err);
	}
	static get [Symbol.species]() {
		return Promise;
	}
	get [Symbol.toStringTag]() {
		return 'Deferred';
	}
};
