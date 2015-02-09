var WebKit = require('webkitgtk');
var Pool = require('generic-pool').Pool;
var fs = require('fs');
var queue = require('queue-async');
var escapeStringRegexp = require('escape-string-regexp');
var request = require('request');
var Path = require('path');
var LFU = require('lfu-cache');

var Dom = module.exports = function(model, opts) {
	// init cache on demand, allow user settings
	if (!Dom.pool) {
		Dom.pool = initPool(Dom.settings);
		Dom.cache = new LFU(Dom.settings.max - 1, Dom.settings.cacheDecay);
		Dom.cache.on('eviction', function(key, inst) {
			release(page, function(err) {
				if (err) console.error(err);
			})
		});
	}
	var h = new Handler(model, opts);
	return h.chainable;
};

Dom.Handler = Handler;

Dom.settings = {
	min: 1,
	max: 32,
	cacheDecay: 60000,
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

function Handler(model, opts) {
	this.view = {};
	if (isRemote(model)) {
		this.view.url = model;
	} else {
		this.path = model; // app.get('statics') is available in middleware
	}
	this.opts = opts || {};
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
	.awaitAll(cb);
};

Handler.prototype.instance = function(url, cb) {
	var h = this;
	var inst = h.pages[url];
	if (!inst) inst = h.pages[url] = {
		author: {url: 'author:' + h.view.url},
		user: {url: url}
	};
	cb(null, inst);
};

Handler.prototype.finish = function(inst, res, cb) {
	res.type('text/html');
	res.set('Last-Modified', inst.user.mtime.toUTCString());
	res.send(inst.user.data);
	cb();
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
		acquire(inst.author.url, function(err, page) {
			if (err) return cb(err);
			var obj = {
				content: h.view.data,
				console: true
			};
			inst.page = page;
			page.parentInstance = inst;
			if (!Dom.settings.debug) obj.style = Dom.settings.style;
			inst.page.preload(inst.user.url, obj);
			h.processMw(inst, h.authors, req, res);
			inst.page.wait('idle').html(function(err, html) {
				if (err) return cb(err);
				inst.author.data = html;
				inst.author.valid = true;
				inst.author.mtime = new Date();
				// release because we are done authoring
				release(inst.page, cb);
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
	for (var key in h.opts) {
		opts[key] = h.opts[key];
	}
	if (!opts.content) opts.content = inst.author.data;
	if (!opts.cookie) opts.cookie = req.get('Cookie');
	if (opts.console === undefined) opts.console = true;
	if (opts.images === undefined) opts.images = false;
	if (opts.style === undefined && !Dom.settings.debug) opts.style = Dom.settings.style;
	acquire(inst.user.url, function(err, page) {
		if (err) return cb(err);
		inst.page = page;
		page.parentInstance = inst;
		inst.page.load(inst.user.url, opts);
		h.processMw(inst, h.users, req, res);
		inst.page.wait('idle').html(function(err, html) {
			if (err) return cb(err);
			inst.user.mtime = new Date();
			inst.user.data = html;
			inst.user.valid = true;
			// released by LFU
			cb();
		});
	});
};

function acquire(url, cb) {
	var page = Dom.cache.get(url);
	if (page) return cb(null, page);
	Dom.pool.acquire(function(err, page) {
		if (err) return cb(err);
		page.on('busy', function() {
			// busy page has bonus
			Dom.cache.get(url);
		});
		cb(null, page);
	});
}

function release(url, cb) {
	var page = Dom.cache.remove(url);
	if (!page) return cb();
	if (page.parentInstance) {
		delete page.parentInstance.page;
		delete page.parentInstance;
	}
	page.removeAllListeners();
	page.unload(function(err) {
		Dom.pool.release(page);
		cb(err);
	});
}

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

