var WebKit = require('webkitgtk');
var Pool = require('generic-pool').Pool;
var fs = require('fs');
var queue = require('queue-async');
var escapeStringRegexp = require('escape-string-regexp');
var request = require('request');
var Path = require('path');

var Dom = module.exports = function(model, options) {
	// init pool later, allowing user to set pool settings
	if (!Dom.pool) Dom.pool = initPool(Dom.settings);
	var h = new Handler(model, options);
	return h.chainable;
};

Dom.Handler = Handler;

Dom.settings = {
	min: 2,
	max: 16,
	busyTimeout: 0,
	idleTimeoutMillis: 1000000,
	refreshIdle: false,
	display: process.env.DISPLAY || 0,
	style: fs.readFileSync(__dirname + '/index.css'),
	debug: !!process.env.DEBUG,
	console: !!process.env.DEBUG
};
Dom.plugins = require('./plugins');

Dom.authors = [];
Dom.users = [Dom.plugins.nostylesheets];

Dom.author = function(mw) {
	Dom.authors.push(mw);
	return Dom;
};

Dom.use = function(mw) {
	Dom.users.push(mw);
	return Dom;
};

function Handler(model, options) {
	this.view = {};
	if (isRemote(model)) {
		this.view.url = model;
	} else {
		this.path = model; // app.get('statics') is available in middleware
	}
	this.options = options || {};
	if (!this.options.busyTimeout) this.options.busyTimeout = Dom.settings.busyTimeout;
	this.chainable = this.middleware.bind(this);
	this.chainable.author = this.author.bind(this);
	this.chainable.use = this.use.bind(this);
	this.authors = Dom.authors.slice();
	this.users = Dom.users.slice();
	this.pages = {};
	if (this.init) this.init(); // used by raja
}

Handler.prototype.middleware = function(req, res, next) {
	var h = this;
	if (h.path !== undefined) {
		var path = h.path;
		delete h.path;
		var root = req.app.get('statics');
		if (!root) return next(new Error("Cannot find view, undefined 'statics' application setting"));
		if (!path) path = "index";
		var path = Path.resolve(root, path);
		if (path.indexOf(root) !== 0) return next(new Error("Path outside statics dir\n" + path));
		if (path.slice(-1) == "/") path += "index";
		if (Path.extname(path) != ".html") path += ".html";
		h.view.url = path;
	}
	var url = req.protocol + '://' + req.headers.host + req.url;
	if (url == h.view.url) {
		return next(new Error("The view has the same url as the requested page"));
	}
	h.instance(url, function(err, inst) {
		if (err) return next(err);
		h.build(inst, req, res, function(err) {
			if (err) return next(err);
		});
	});
};

Handler.prototype.build = function(inst, req, res, cb) {
	var h = this;
	queue(1)
	.defer(h.getView.bind(h), req)
	.defer(h.getAuthored.bind(h), inst, req, res)
	.defer(h.getUsed.bind(h), inst, req, res)
	.defer(h.finish.bind(h), inst, res)
	.defer(h.gc.bind(h))
	.awaitAll(cb);
};

Handler.prototype.instance = function(url, cb) {
	var h = this;
	var inst = h.pages[url];
	if (!inst) inst = h.pages[url] = {
		hits: 0,
		busyness: 0,
		mtime: new Date(),
		author: {url: 'author:' + h.view.url},
		user: {url: url}
	};
	inst.hits++;
	inst.atime = new Date();
	inst.lock = true;
	cb(null, inst);
};

Handler.prototype.finish = function(inst, res, cb) {
	res.type('text/html');
	res.set('Last-Modified', inst.user.mtime.toUTCString());
	res.send(inst.user.data);
	inst.lock = false;
	cb();
};

Handler.prototype.acquire = function(inst, cb) {
	if (inst.page) return cb();
	var busyTimeout = this.options.busyTimeout;
	this.gc(function() {
		Dom.pool.acquire(function(err, page) {
			if (err) return cb(err);
			if (page.acquired) return cb(new Error("acquired a page that was not released"));
			page.acquired = true;
			inst.page = page;
			if (busyTimeout) page.on('busy', function(inst) {
				inst.busyness++;
				setTimeout(function() {
					inst.busyness--;
				}, busyTimeout);
			}.bind(null, inst));
			cb();
		});
	});
};

Handler.prototype.gc = function(cb) {
	// TODO couple Dom.pool with LFU
	if (Dom.pool.getPoolSize() < Dom.settings.max || Dom.pool.availableObjectsCount() > 0) return cb();
	var minScore = +Infinity;
	var minInst;
	var busyPages = 0;
	for (var url in this.pages) {
		var inst = this.pages[url];
		if (inst.lock || !inst.page) {
			continue;
		}
		if (inst.busyness > 0) {
			busyPages++;
		}
		var score = 0;
		if (inst.score !== undefined) {
			// allow a score to be set by application
			score = inst.score;
		} else {
			// or use our default scoring
			score = (inst.weight || 1) * 60000 * inst.hits / (Date.now() - inst.atime.getTime());
		}
		if (score < minScore) {
			minScore = score;
			minInst = inst;
		}
	}
	if (minInst) {
		this.release(minInst.page, cb);
		delete minInst.page;
	} else {
		if (busyPages == Dom.settings.max) {
			console.warn("Too many busy instances - lower busyTimeout of raise Dom.settings.max")
		}
		cb();
	}
};

Handler.prototype.getView = function(req, cb) {
	var h = this;
	if (h.view.valid) return cb();
	var loader = isRemote(h.view.url) ? h.loadRemote : h.loadLocal;
	loader.call(h, h.view.url, function(err, body) {
		if (!err || body) {
			h.view.data = body;
			h.view.valid = true;
			h.view.mtime = new Date();
		}	else {
			if (!err) err = new Error("Empty initial html in " + h.view.url);
			if (!err.code || err.code == 'ENOENT') err.code = 404;
			else err.code = 500;
		}
		cb(err);
	});
};

Handler.prototype.loadLocal = fs.readFile;
Handler.prototype.loadRemote = function(url, cb) {
	request(url, function(err, res, body) {
		cb(err, body);
	});
};

Handler.prototype.getAuthored = function(inst, req, res, cb) {
	var h = this;
	if (inst.author.valid) return cb();
	if (h.authors.length) {
		h.acquire(inst, function(err) {
			if (err) return cb(err);
			var obj = {
				content: h.view.data,
				console: true
			};
			if (!Dom.settings.debug) obj.style = Dom.settings.style;
			inst.page.preload(inst.user.url, obj);
			h.processMw(inst, h.authors, req, res);
			inst.page.wait('idle').html(function(err, html) {
				if (err) return cb(err);
				inst.author.data = html;
				inst.author.valid = true;
				inst.author.mtime = new Date();
				// release because we are done authoring
				h.release(inst.page, cb);
				delete inst.page;
			});
		});
	} else {
		inst.author.data = h.view.data;
		inst.author.valid = true;
		inst.author.mtime = new Date();
		cb();
	}
};

Handler.prototype.getUsed = function(inst, req, res, cb) {
	var h = this;
	if (inst.user.valid) return cb();
	var opts = {};
	for (var key in h.options) {
		opts[key] = h.options[key];
	}
	if (!opts.content) opts.content = inst.author.data;
	if (!opts.cookie) opts.cookie = req.get('Cookie');
	if (opts.console === undefined) opts.console = true;
	if (opts.images === undefined) opts.images = false;
	if (opts.style === undefined && !Dom.settings.debug) opts.style = Dom.settings.style;
	h.acquire(inst, function(err) {
		if (err) return cb(err);
		inst.page.load(inst.user.url, opts);
		h.processMw(inst, h.users, req, res);
		inst.page.wait('idle').html(function(err, html) {
			if (err) return cb(err);
			inst.user.mtime = new Date();
			inst.user.data = html;
			inst.user.valid = true;
			// do not release, gc will
			cb();
		});
	});
};

Handler.prototype.release = function(page, cb) {
	if (!page) return cb();
	page.acquired = false;
	page.removeAllListeners();
	page.unload(function(err) {
		Dom.pool.release(page);
		cb(err);
	});
};

Handler.prototype.processMw = function(inst, list, req, res) {
	if (!list || !list.length) return;
	for (var i=0; i < list.length; i++) {
		list[i](inst, req, res);
	}
};

Handler.prototype.use = function(mw) {
	this.users.push(mw);
	return this.chainable;
};
Handler.prototype.author = function(mw) {
	this.authors.push(mw);
	return this.chainable;
};


function initPool(settings) {
	var opts = {};
	for (var prop in settings) opts[prop] = settings[prop];
	if (opts.debug) {
		if (opts.display != 0) {
			opts.display = 0;
			console.info("debug is on - using default display 0");
		}
		opts.max = 1;
	}
	if (!opts.name) opts.name = "webkitPool";
	if (!opts.create) opts.create = function(cb) {
		cb(null, WebKit(opts));
	};
	if (!opts.destroy) opts.destroy = function(client) {
		client.destroy();
		if (global.gc) {
			global.gc();
		}
	};
	if (!opts.max) opts.max = 1;
	var pool = Pool(opts);
	process.on('exit', function() {
		pool.drain(function() {
			pool.destroyAllNow();
		});
	});
	return pool;
}

function isRemote(url) {
	return /^https?:\/\//.test(url);
}

