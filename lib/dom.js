var debug = require('debug')('express-dom');
var Pool = require('./pool');
var URL = require('url');
var pify = require('pify');
var clone = require('clone');

var pool;
var dom = module.exports = function() {
	if (!pool) {
		dom.pool.instance = pool = new Pool(dom.pool, dom); // do not use instance options
		dom.acquire = pool.acquire.bind(pool);
		dom.release = pool.release.bind(pool);
	}
	var h = new Handler(Array.from(arguments));
	return h.chainable;
};

var pAcquire;

dom.plugins = require('./plugins');
dom.helpers = require('./helpers');

dom.pool = {
	max: 8,
	destroyTimeout: 600000,
	idleTimeout: 180000
};

dom.settings = {
	helpers: [
		dom.helpers.view,
		dom.helpers.prioritize
	],
	prepare: {
		plugins: [
			dom.plugins.hide,
			dom.plugins.noreq,
			dom.plugins.html
		]
	},
	load: {
		disable: !!process.env.DEVELOP,
		plugins: [
			dom.plugins.hide,
			dom.plugins.nomedia,
			dom.plugins.prerender,
			dom.plugins.redirect,
			dom.plugins.referrer,
			dom.plugins.html
		]
	},
	console: process.env.NODE_ENV != "production",
	stall: 15000,
	allow: "same-origin",
	navigation: false,
	verbose: true,
	cacheModel: process.env.DEVELOP ? "none" : "browser"
};

var requestClearCache = false;

dom.clear = function() {
	requestClearCache = true;
};

function Handler(args) {
	var h = this;
	var view = args[0];
	if (typeof view != "function") args.shift();
	else view = null;
	h.view = view;
	debug("new handler", view);
	h.settings = emptySettings(dom.settings);
	h.settings.helpers = args.concat(dom.settings.helpers);
	h.settings.prepare = emptySettings(dom.settings, true);
	h.settings.load = emptySettings(dom.settings, true);

	h.chainable = h.middleware.bind(h);
	h.chainable.prepare = h.prepare.bind(h);
	h.chainable.load = h.load.bind(h);
}

Handler.prototype.prepare = function(opts) {
	initOpts(this.settings.prepare, dom.settings.prepare, opts, Array.from(arguments));
	return this.chainable;
};

Handler.prototype.load = function(opts) {
	initOpts(this.settings.load, dom.settings.load, opts, Array.from(arguments));
	return this.chainable;
};

function initOpts(settings, defaults, opts, args) {
	if (typeof opts == "function") opts = null;
	else args.shift();
	var plugins = settings.plugins;
	Object.assign(settings, defaults, opts);
	if ((!opts || !opts.plugins) && plugins.length) settings.plugins = plugins;
	else plugins = settings.plugins;
	if (typeof plugins == "function") plugins = [plugins];
	settings.plugins = args.concat(plugins);
}

Handler.prototype.middleware = function(req, res, next) {
	var h = this;
	var manual = false;
	var href, loc;
	if (typeof req == "string") {
		debug("Called in manual mode");
		manual = {};
		href = req;
		loc = URL.parse(href);
		req = {
			headers: {},
			path: loc.pathname,
			query: loc.query
		};
		req.get = function(key) {
			return this.headers[key];
		}.bind(req);
		res = {statusCode: 200};
		res.sendStatus = function(status) {
			res.statusCode = manual.status = status;
		};
		res.send = function(str) {
			manual.body = str;
		};
		res.status = res.sendStatus;
		req.res = res;
		next = function(err) { throw err; };
	} else {
		href = (req.get('X-Forwarded-Proto') || req.protocol) + '://' + req.headers.host;
		loc = URL.parse(href);
	}
	// per request settings
	var settings = clone(h.settings);
	settings.location = {
		protocol: loc.protocol,
		hostname: loc.hostname,
		port: loc.port,
		pathname: req.path,
		query: req.query
	};
	if (req.headers.cookie) settings.location.headers = {
		cookie: req.headers.cookie
	};
	settings.view = h.view;

	var p = Promise.resolve();
	// ensure helpers can call prepare/load that won't affect h.settings
	var rh = {
		settings: settings
	};
	rh.load = h.load.bind(rh);
	rh.prepare = h.prepare.bind(rh);

	settings.helpers.forEach(function(helper) {
		p = p.then(function() {
			return helper(rh, settings, req, res);
		});
	});
	p = p.then(function() {
		debug('view loaded for', settings.location.pathname, "with", settings.prepare.plugins.length, "prepare plugins, and", settings.load.plugins.length, "load plugins");

		if (settings.prepare.disable || settings.prepare.plugins.length == 0) return;
		return h.runMethod('prepare', settings, req, res);
	}).then(function() {
		if (settings.load.disable || settings.load.plugins.length == 0) return;
		return h.runMethod('load', settings, req, res);
	}).then(function() {
		var data = settings.input;
		// hopefully free faster that memory
		delete settings.input;
		if (res.get && !res.get('Content-Type')) {
			res.set('Content-Type', "text/html");
		}
		var status = res.statusCode;
		if (data === false) {
			debug("data handled by plugin");
			return;
		}
		if (!data) {
			if (!settings.prepare && !settings.load) {
				return res.sendStatus(501);
			} else {
				return res.sendStatus(404);
			}
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
			try {
				res.sendFile(data);
			} catch (ex) {
				// eslint-disable-next-line no-console
				console.error("express-dom thought input was a file path", data);
				status = 500;
				isPath = false;
			}
		}
		if (!isPath) {
			if (status) res.status(status);
			if (isStream) {
				data.once('error', function(err) {
					res.emit('error', err);
					data.unpipe(res);
				});
				data.pipe(res);
			} else {
				res.send(data);
			}
		}
	});
	if (manual) {
		return p.then(function() {
			return manual;
		});
	} else {
		p.catch(next);
	}
};

Handler.prototype.runMethod = function(method, settings, request, response) {
	if (!pAcquire) pAcquire = pify(dom.acquire);
	return pAcquire(settings.priority).then(function(page) {
		if (requestClearCache && page.clearCache) {
			requestClearCache = false;
			page.clearCache();
		}
		var mSettings = Object.assign({}, settings, settings[method]);
		mSettings.location = settings.location;
		var plugins = mSettings.plugins;
		delete mSettings.plugins;
		var p = Promise.resolve();
		plugins.forEach(function(plugin) {
			p = p.then(function() {
				return plugin(page, mSettings, request, response);
			});
		});
		return p.then(function() {
			var ps = page.when('idle', function() {
				debug("release idle page", method, page.uri);
				page.pingTime = Date.now();
				dom.release(page);
			});
			settings.location = mSettings.location;
			settings.input = mSettings.input;
			delete mSettings.location;
			delete mSettings.input;
			var url = URL.format(settings.location);
			debug(method, url);
			page[method](url, Object.assign({content: settings.input}, mSettings));
			return ps;
		}).then(function() {
			if (mSettings.output !== undefined) {
				settings.input = mSettings.output;
			}
		}).catch(function(err) {
			dom.release(page);
			throw err;
		});
	});
};

function emptySettings(defaults, withArrays) {
	// use defaults but not .load, .prepare sub global settings
	var obj = Object.assign({}, defaults);
	delete obj.load;
	delete obj.prepare;
	obj = clone(obj);
	if (withArrays) {
		if (!obj.filters) obj.filters = [];
		if (!obj.plugins) obj.plugins = [];
		if (!obj.scripts) obj.scripts = [];
	}
	return obj;
}
