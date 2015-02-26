var WebKit = require('webkitgtk');
var Pool = require('generic-pool').Pool;
var fs = require('fs');
var queue = require('queue-async');
var escapeStringRegexp = require('escape-string-regexp');
var request = require('request');
var Path = require('path');
var Cache = require('adaptative-replacement-cache');

var Dom = module.exports = function(model, opts) {
	// init cache on demand, allow user settings
	if (!Dom.pool) {
		Dom.pool = initPool(Dom.settings);
		Dom.cache = new Cache(Dom.settings.max - 1);
		Dom.cache.on('eviction', function(key, page) {
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
	refreshIdle: false,
	display: process.env.DISPLAY || 0,
	style: fs.readFileSync(__dirname + '/index.css'),
	debug: !!process.env.DEBUG,
	console: !!process.env.DEBUG
};

Dom.plugins = require('./plugins');

Dom.authors = {
	before: [],
	current: [],
	after: []
};

Dom.users = {
	before: [Dom.plugins.nostylesheets],
	current: [],
	after: []
};

Dom.author = function(mw, position) {
	var list = Dom.authors;
	if (!position) position = 'current';
	if (!list[position]) throw new Error("Unknown position for express-dom author middleware", position);
	list[position].push(mw);
	return Dom;
};

Dom.use = function(mw, position) {
	var list = Dom.users;
	if (!position) position = 'current';
	if (!list[position]) throw new Error("Unknown position for express-dom user middleware", position);
	list[position].push(mw);
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
	this.authors = {
		before: Dom.authors.before.slice(),
		current: Dom.authors.current.slice(),
		after: Dom.authors.after.slice()
	};
	this.users = {
		before: Dom.users.before.slice(),
		current: Dom.users.current.slice(),
		after: Dom.users.after.slice()
	};
	this.pages = {};
	if (this.init) this.init(); // used by raja
}

Handler.prototype.author = function(mw, position) {
	var list = this.authors;
	if (!position) position = 'current';
	if (!list[position]) throw new Error("Unknown position for express-dom author middleware", position);
	list[position].push(mw);
	return this.chainable;
};

Handler.prototype.use = function(mw, position) {
	var list = this.users;
	if (!position) position = 'current';
	if (!list[position]) throw new Error("Unknown position for express-dom user middleware", position);
	list[position].push(mw);
	return this.chainable;
};

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
		user: {url: url},
		output: function(cb) {
			this.page.html(cb);
		}
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
	if (h.authors.before.length || h.authors.current.length || h.authors.after.length) {
		acquire(inst.author.url, function(err, page) {
			if (err) return cb(err);
			inst.page = page;
			inst.locked = true;
			page.parentInstance = inst;
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
				inst.locked = false;
				Dom.cache.del(inst.author.url);
				release(inst.page, function(err) {
					cb(err);
				});
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
		inst.locked = true;
		page.parentInstance = inst;
		inst.page.load(inst.user.url, opts);
		h.processMw(inst, h.users, req, res);
		inst.page.wait('idle', function(err) {
			if (err) return cb(err);
			inst.user.mtime = new Date();
			inst.output.call(inst, next);
			function next(err, str) {
				if (err) return cb(err);
				inst.user.data = str;
				inst.user.valid = true;
				// released by cache
				checkRelease(inst);
				cb();
			}
		});
	});
};

function acquire(url, cb) {
	var page = Dom.cache.get(url);
	if (page) return cb(null, page);
	Dom.pool.acquire(function(err, page) {
		if (err) return cb(err);
		Dom.cache.set(url, page);
		page.on('busy', function() {
			// busy page has bonus
			Dom.cache.get(url);
		});
		cb(null, page);
	});
}

function release(page, cb) {
	var inst = page.parentInstance;
	if (inst) {
		if (inst.locked) {
			inst.evict = true;
			return;
		}
		inst.evict = false;
		delete inst.page;
		delete page.parentInstance;
	}
	page.unload(function(err) {
		page.removeAllListeners();
		if (err) console.error(err);
		Dom.pool.release(page);
		cb(err);
	});
}

function checkRelease(inst) {
	inst.locked = false;
	if (inst.evict) {
		inst.evict = false;
		if (inst.page) release(inst.page, function(err) {
			if (err) console.error(err);
		});
	}
}

Handler.prototype.processMw = function(inst, mwObj, req, res) {
	var list = mwObj.before.concat(mwObj.current).concat(mwObj.after);
	for (var i=0; i < list.length; i++) {
		list[i](inst, req, res);
	}
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

