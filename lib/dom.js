var fs = require('fs');
var Path = require('path');
var debug = require('debug')('express-dom');
var Pool = require('./pool');
var URL = require('url');
var BufferList = require('bl');
var pify = require('pify');
var clone = require('clone');

var pool;
var dom = module.exports = function() {
	if (!pool) {
		pool = new Pool(dom.pool, dom); // do not use instance options
		dom.acquire = pool.acquire.bind(pool);
		dom.release = pool.release.bind(pool);
	}
	var h = new Handler(Array.from(arguments));
	return h.chainable;
};

dom.plugins = require('./plugins');
dom.helpers = require('./helpers');

dom.pool = {
	max: 8,
	destroyTimeout: 600000,
	idleTimeout: 180000
};

dom.settings = {
	helpers: [
		dom.helpers.view
	],
	prepare: {
		plugins: [
			dom.plugins.hide,
			dom.plugins.noreq,
			dom.plugins.html
		]
	},
	load: {
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
	develop: !!process.env.DEVELOP
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
	h.chainable.prepare = function(opts) {
		initOpts(h.settings.prepare, opts, Array.from(arguments));
		return h.chainable;
	};
	h.chainable.load = function(opts) {
		if (dom.settings.develop) {
			console.warn("develop mode is ON");
			var args = Array.from(arguments);
			if (typeof args[0] != "function") args.shift();
			console.info("Rewiring", args.length, "appended load plugins");
			h.chainable.prepare.apply(this, args);
		} else {
			initOpts(h.settings.load, opts, Array.from(arguments));
		}
		return h.chainable;
	};
}

function initOpts(settings, opts, args) {
	if (typeof opts == "function") opts = null;
	else args.shift();
	Object.assign(settings, opts);
	var plugins = settings.plugins;
	if (typeof plugins == "function") plugins = [plugins];
	settings.plugins = args.concat(plugins);
}

Handler.prototype.middleware = function(req, res, next) {
	var h = this;
	// per request settings
	var loc = URL.parse(
		(req.get('X-Forwarded-Proto') || req.protocol) + '://' + req.headers.host
	);
	var settings = clone(h.settings);
	settings.location = {
		protocol: loc.protocol,
		hostname: loc.hostname,
		port: loc.port,
		pathname: req.path,
		query: req.query
	};
	settings.view = h.view;

	var p = Promise.resolve();
	// ensure helpers can call prepare/load that won't affect h.settings
	var rh = {
		settings: settings,
		load: h.chainable.load.bind(rh),
		prepare: h.chainable.prepare.bind(rh)
	};
	settings.helpers.forEach(function(helper) {
		p = p.then(function() {
			return helper(rh, settings, req, res);
		}).then(function() {
			if (res.statusCode != 200) return Promise.reject(res.statusCode);
		});
	});
	p.then(function() {
		debug('view loaded for', settings.location.pathname);
		if (settings.prepare.plugins.length == 0) return;
		return h.runMethod('prepare', settings, req, res);
	}).then(function() {
		if (settings.load.plugins.length == 0) return;
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
		var mSettings = settings[method];
		var plugins = mSettings.plugins;
		var p = Promise.resolve();
		plugins.forEach(function(plugin) {
			p = p.then(function() {
				return plugin(page, mSettings, request, response);
			}).then(function() {
				if (response.statusCode != 200) return Promise.reject(response.statusCode);
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
						if (err) console.error("dom.release", err);
					}); // no need to wait for the release
					cb();
				});
			})();
			settings.location = mSettings.location;
			settings.input = mSettings.input;
			var url = URL.format(settings.location);
			debug(method, url);
			page[method](url, Objet.assign({content: settings.input}, mSettings);
			return ip;
		}).then(function() {
			if (mSettings.output) settings.input = mSettings.output;
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
