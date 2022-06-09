const assert = require('node:assert');

module.exports = function asyncEmitter(emitter, event, ...args) {
	// breaks synchronous contract of emit()
	// returns a promise or false
	assert.equal(
		typeof emitter.emit, "function", "wrong type for emit()"
	);
	assert.equal(
		typeof emitter.listeners, "function", "wrong type for listeners()"
	);

	const list = emitter.listeners(event);
	if (list.length == 0) return false;
	args.unshift(event);
	let ret = Promise.resolve();
	for (const fn of list) {
		ret = ret.then(() => fn.apply(emitter, args));
	}
	return ret;
};
