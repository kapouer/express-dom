module.exports = class Deferred extends Promise {
	constructor(final) {
		let pass, fail;
		super((resolve, reject) => {
			pass = resolve;
			fail = reject;
		});
		this.resolve = () => {
			if (final) final();
			pass();
		};
		this.reject = () => {
			if (final) final();
			fail();
		};
	}
	static get [Symbol.species]() {
		return Promise;
	}
	get [Symbol.toStringTag]() {
		return 'Deferred';
	}
};
