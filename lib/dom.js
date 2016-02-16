var fs = require('fs');
var Path = require('path');
var debug = require('debug')('express-dom');
var Pool = require('./pool');
var URL = require('url');


var dom = module.exports = function(model, opts) {
	if (!dom.pool) {
		dom.pool = new Pool(dom.settings.pool, dom); // do not use instance options
		dom.acquire = dom.pool.acquire.bind(dom.pool);
		dom.release = dom.pool.release.bind(dom.pool);
	}
	var h = new Handler(model, opts);
	return h.chainable;
};

dom.plugins = require('./plugins');

dom.settings = {
	plugins: [dom.plugins.nocss, dom.plugins.redirect, dom.plugins.html],
	display: process.env.DISPLAY || 0,
	pool: {
		max: 16,
		destroyTimeout: 600000,
		idleTimeout: 180000
	},
	style: `/* disable viewport repaints */
		html {
			display:none !important;
		}
		/* do not animate as far as possible */
		* {
			-webkit-transition:none !important;
			transition:none !important;
			-webkit-transition-property: none !important;
			transition-property: none !important;
			-webkit-transform: none !important;
			transform: none !important;
			-webkit-animation: none !important;
			animation: none !important;
		}`,
	console: !!process.env.DEBUG,
	'auto-load-images': false,
	stall: 15000,
	allow: "same-origin",
	navigation: false,
	develop: !!process.env.DEVELOP
};

function Handler(model) {
	debug("new handler", model);
	var h = this;
	h.model = model;
	h.settings = {};

	h.chainable = h.middleware.bind(h);
	h.chainable.prepare = function(opts) {
		h.settings.prepare = initOpts(opts, Array.from(arguments));
		return h.chainable;
	};
	h.chainable.load = function(opts) {
		h.settings.load = initOpts(opts, Array.from(arguments));
		return h.chainable;
	};
}

function initOpts(opts, args) {
	if (typeof opts == "function") opts = null;
	else args.shift();

	opts = Object.assign({filters: []}, dom.settings, opts);
	var plugins = opts.plugins;
	if (typeof plugins == "function") plugins = [plugins];
	opts.plugins = args.concat(plugins || dom.settings.plugins);

	return opts;
}

Handler.prototype.middleware = function(req, res, next) {
	var h = this;
	if (!h.model) h.model = req.path;

	h.getView(req.app.get('statics'), function(err, data) {
		if (err) return next(err);
		var state = {
			location: {
				protocol: req.protocol,
				host: req.headers.host,
				pathname: req.path,
				query: req.query
			},
			data: data,
			headers: {},
			status: null
		};
		debug('view loaded', state.location);
		if (h.settings.prepare) {
			h.runMethod('prepare', state, h.settings.prepare, between);
		} else {
			between();
		}
		function between(err) {
			if (err) return next(err);
			if (h.settings.load) {
				if (h.settings.load.develop) {
					console.warn("develop mode is ON");
				} else {
					return h.runMethod('load', state, h.settings.load, finalize);
				}
			}
			finalize();
		}
		function finalize(err) {
			if (err) return next(err);
			for (var header in state.headers) {
				res.setHeader(header, state.headers[header]);
			}
			var data = state.data;
			var status = state.status;
			if (data) {
				var isPath = true;
				if (Buffer.isBuffer(data)) {
					isPath = false;
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
					res.send(data);
				}
			} else if (status) {
				res.sendStatus(status);
			}
		}
	});
};

Handler.prototype.getView = function(root, cb) {
	var model = this.model;
	delete this.model; // free mem
	if (Buffer.isBuffer(model)) return cb(null, model);
	if (typeof model != "string") return cb(new Error("unknown model type"));
	if (model.startsWith('<')) return cb(null, model); // html string
	if (!root) return cb(new Error("Please app.set('statics', rootDir)"));
	var path = Path.join(root, model);
	if (path.indexOf(root) !== 0) return cb(new Error("Path outside statics dir\n" + path));
	if (Path.extname(path) != ".html") path += ".html";
	fs.readFile(path, cb);
};

Handler.prototype.runMethod = function(method, state, settings, cb) {
	var h = this;
	dom.pool.acquire(function(err, page) {
		if (err) return next(err);
		processMw(page, state, settings);
		page.when('idle', function(wcb) {
			debug("release idle page", page.uri);
			page.pingTime = Date.now();
			wcb();
			dom.pool.release(page);
			cb();
		});
		settings.content = state.data;
		page[method](URL.format(state.location), settings);
		delete settings.content;
	});
};

function processMw(page, state, settings) {
	var list = settings.plugins;
	for (var i=0; i < list.length; i++) {
		list[i](page, state, settings);
	}
}

