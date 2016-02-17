var fs = require('fs');
var Path = require('path');
var debug = require('debug')('express-dom');
var Pool = require('./pool');
var URL = require('url');
var BufferList = require('bl');


var dom = module.exports = function(input, opts) {
	if (!dom.pool) {
		dom.pool = new Pool(dom.settings.pool, dom); // do not use instance options
		dom.acquire = dom.pool.acquire.bind(dom.pool);
		dom.release = dom.pool.release.bind(dom.pool);
	}
	var h = new Handler(input, opts);
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

function Handler(input) {
	debug("new handler", input);
	var h = this;
	h.input = input;
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
	if (!h.input) h.input = req.path;
	var statics = req.app.get('statics');

	h.getView(statics, function(err, data) {
		if (err) return next(err);
		var request = {
			location: {
				protocol: req.protocol,
				host: req.headers.host,
				pathname: req.path,
				query: req.query
			},
			input: data,
			statics: statics,
			headers: req.headers
		};
		var response = {
			output: null,
			headers: {},
			status: null
		};
		debug('view loaded', request.location.pathname);
		if (h.settings.prepare) {
			h.runMethod('prepare', h.settings.prepare, request, response, function(err) {
				if (err) return next(err);
				between();
			});
		} else {
			between();
		}
		function between() {
			if (h.settings.load) {
				if (h.settings.load.develop) {
					console.warn("develop mode is ON");
				} else {
					if (response.output) {
						request.input = response.output;
						response.output = null;
					}
					return h.runMethod('load', h.settings.load, request, response, function(err) {
						if (err) return next(err);
						finalize();
					});
				}
			}
			finalize();
		}
		function finalize() {
			var data = response.output || request.input;
			if (!response.headers['Content-Type']) {
				response.headers['Content-Type'] = "text/html";
			}
			for (var header in response.headers) {
				res.setHeader(header, response.headers[header]);
			}
			// hopefully free faster that memory
			delete request.input;
			delete response.output;
			var status = response.status;
			if (data) {
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
			} else {
				res.sendStatus(status || 400);
			}
		}
	});
};

Handler.prototype.getView = function(root, cb) {
	var input = this.input;
	if (Buffer.isBuffer(input)) return cb(null, input);
	if (typeof input.pipe == "function") return input.pipe(BufferList(cb));
	if (typeof input != "string") return cb(new Error("unknown input type"));
	if (input.startsWith('<')) return cb(null, input); // html string
	if (!root) return cb(new Error("Please app.set('statics', rootDir)"));
	var path = Path.join(root, input);
	if (path.indexOf(root) !== 0) return cb(new Error("Path outside statics dir\n" + path));
	if (Path.extname(path) != ".html") path += ".html";
	fs.readFile(path, cb);
};

Handler.prototype.runMethod = function(method, settings, request, response, cb) {
	var h = this;
	dom.pool.acquire(function(err, page) {
		if (err) return next(err);
		processMw(page, settings, request, response);
		page.when('idle', function(wcb) {
			debug("release idle page", page.uri);
			page.pingTime = Date.now();
			wcb();
			dom.pool.release(page);
			cb();
		});
		settings.content = request.input;
		page[method](URL.format(request.location), settings);
		delete settings.content;
	});
};

function processMw(page, settings, request, response) {
	var list = settings.plugins;
	for (var i=0; i < list.length; i++) {
		list[i](page, settings, request, response);
	}
}

