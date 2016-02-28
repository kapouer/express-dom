var fs = require('fs');
var Path = require('path');
var debug = require('debug')('express-dom');
var Pool = require('./pool');
var URL = require('url');
var BufferList = require('bl');
var pify = require('pify');

var dom = module.exports = function() {
	if (!dom.pool) {
		dom.pool = new Pool(dom.settings.pool, dom); // do not use instance options
		dom.acquire = dom.pool.acquire.bind(dom.pool);
		dom.release = dom.pool.release.bind(dom.pool);
	}
	var h = new Handler(Array.from(arguments));
	return h.chainable;
};

dom.plugins = require('./plugins');
dom.helpers = require('./helpers');

dom.settings = {
	prepare: {
		plugins: [
			dom.plugins.noreq,
			dom.plugins.html
		]
	},
	load: {
		plugins: [
			dom.plugins.nomedia,
			dom.plugins.redirect,
			dom.plugins.html
		]
	},
	display: process.env.DISPLAY || 0,
	pool: {
		max: 16,
		destroyTimeout: 600000,
		idleTimeout: 180000
	},
	style: fs.readFileSync(Path.join(__dirname, 'default.css')),
	console: process.env.NODE_ENV != "production",
	stall: 15000,
	allow: "same-origin",
	navigation: false,
	develop: !!process.env.DEVELOP
};

function Handler(args) {
	var h = this;
	var view = args[0];
	if (typeof view != "function") args.shift();
	else view = null;
	h.view = view;
	args.push(dom.helpers.view);
	h.helpers = args;
	debug("new handler", view);
	h.settings = {};

	h.chainable = h.middleware.bind(h);
	h.chainable.prepare = function(opts) {
		h.settings.prepare = initOpts(opts, dom.settings.prepare, Array.from(arguments));
		return h.chainable;
	};
	h.chainable.load = function(opts) {
		if (dom.settings.develop) {
			console.warn("develop mode is ON");
			var args = Array.from(arguments);
			if (typeof args[0] != "function") args.shift();
			console.info("Rewiring", args.length, "appended load plugins");
			if (args.length) {
				if (!h.settings.prepare) h.chainable.prepare({});
				while (args.length) h.settings.prepare.plugins.unshift(args.pop());
			}
		} else {
			h.settings.load = initOpts(opts, dom.settings.load, Array.from(arguments));
		}
		return h.chainable;
	};
}

function initOpts(opts, defaults, args) {
	if (typeof opts == "function") opts = null;
	else args.shift();

	opts = Object.assign({filters: [], plugins: []}, dom.settings, defaults, opts);
	var plugins = opts.plugins;
	if (typeof plugins == "function") plugins = [plugins];
	opts.plugins = args.concat(plugins || defaults.plugins);

	return opts;
}

Handler.prototype.middleware = function(req, res, next) {
	var h = this;
	// per request settings
	var settings = {
		location: {
			protocol: req.protocol,
			host: req.headers.host,
			pathname: req.path,
			query: req.query
		},
		view: h.view
	};

	var p = Promise.resolve();
	h.helpers.forEach(function(helper) {
		p = p.then(function() {
			return helper(settings, req, res);
		});
	});
	p.then(function() {
		debug('view loaded for', settings.location.pathname);
		if (!h.settings.prepare) return;
		return h.runMethod('prepare', settings, req, res);
	}).then(function() {
		if (!h.settings.load) return;
		return h.runMethod('load', settings, req, res);
	}).then(function() {
		var data = settings.input;
		// hopefully free faster that memory
		delete settings.input;
		if (!res.get('Content-Type')) {
			res.set('Content-Type', "text/html");
		}
		var status = res.statusCode;
		if (data === false) {
			debug("data handled by plugin");
			return;
		}
		var isPath = true, isStream = false;
		if (Buffer.isBuffer(data)) {
			isPath = false;
		} else if (typeof data.pipe == "function") {
			isPath = false;
			isStream = true;
		} else if (typeof data != "string") {
			data = data.toString();
		}
		if (isPath && data.startsWith('<')) {
			isPath = false;
		}
		if (isPath) {
			res.sendFile(data);
		} else {
			if (status) res.status(status);
			if (isStream) {
				data.pipe(res);
			} else {
				res.send(data);
			}
		}
	}).catch(next);
};

Handler.prototype.runMethod = function(method, settings, request, response) {
	var h = this;
	return pify(dom.acquire)().then(function(page) {
		var hsings = h.settings[method];
		var plugins = hsings.plugins;
		var psings = Object.assign({}, hsings, settings);
		delete psings.plugins;
		var p = Promise.resolve();
		plugins.forEach(function(plugin) {
			p = p.then(function() {
				return plugin(page, psings, request, response);
			});
		});
		return p.then(function() {
			var ip = pify(function(cb) {
				// it would be nice if page.when was returning a promise,
				// but it returns page for listener chainability
				page.when('idle', function(wcb) {
					debug("release idle page", method, page.uri);
					page.pingTime = Date.now();
					wcb();
					dom.release(page, function(err) {
						if (err) console.error(err);
					}); // no need to wait for the release
					cb();
				});
			})();
			settings.location = psings.location;
			settings.input = psings.input;
			var url = URL.format(settings.location);
			debug(method, url);
			psings.content = settings.input;
			page[method](url, psings);
			return ip;
		}).then(function() {
			if (psings.output) settings.input = psings.output;
		});
	});
};

