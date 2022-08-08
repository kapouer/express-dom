const Handler = require('./lib/handler');

module.exports = new Proxy(Handler, {
	apply: (target, thisArg, args) => {
		const h = new Handler(...args);
		h.chain.route = fn => h.route(fn);
		return h.chain;
	},
	get(...args) {
		return Reflect.get(...args);
	},
	set(...args) {
		return Reflect.set(...args);
	}
});
