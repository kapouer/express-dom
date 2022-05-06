const Handler = require('./lib/handler');

module.exports = new Proxy(Handler, {
	apply: (target, thisArg, args) => {
		const h = new Handler(...args);
		return h.chain;
	}
});
