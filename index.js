var WebKit = require('webkitgtk');
var fs = require('fs');
var queue = require('queue-async');
var request = require('request');
var Path = require('path');


function Pool(cacheSize) {
	this.list = [];
	this.max = cacheSize;
	this.count = 0;
	this.queue = [];
}

Pool.prototype.acquire = function(cb) {
	var page;
	if (this.count < this.max) {
		this.count++;
		page = WebKit(Dom.settings);
		page.locked = true;
		this.list.push(page);
	} else for (var i=0; i < this.list.length; i++) {
		page = this.list[i];
		if (!page.locked) {
			page.locked = true;
			if (typeof page.unlock == "function") {
				page.unlock();
				page.removeAllListeners();
				delete page.unlock;
			}
			break;
		}
		page = null;
	}
	if (page) {
		cb(null, page);
	} else {
		this.queue.push(cb);
	}
};

Pool.prototype.unlock = function(page, unlockCb) {
	page.unlock = unlockCb;
	page.locked = false;
	setImmediate(this.process.bind(this));
};

Pool.prototype.release = function(page, cb) {
	page.unload(function(err) {
		if (page.unlock) {
			console.warn(new Error("page.unlock is set in Dom.pool.release"));
			delete page.unlock;
		}
		page.removeAllListeners();
		page.locked = false;
		cb();
		setImmediate(this.process.bind(this));
	}.bind(this));
};

Pool.prototype.process = function() {
	var next = this.queue.shift();
	if (next) this.acquire(next);
};

var Dom = module.exports = function(model, opts) {
	if (!Dom.pool) {
		Dom.pool = new Pool(Dom.settings.max);
		Dom.handlers = {}; // hash to store each view <-> middleware handler
		Dom.pages = {}; // store instances by url
	}
	var h = Dom.handlers[model];
	if (h) return h.chainable;
	var h = new Handler(model, opts);
	Dom.handlers[model] = h;
	return h.chainable;
};

Dom.Handler = Handler;

Dom.settings = {
	max: 16,
	display: process.env.DISPLAY || 0,
	style: fs.readFileSync(__dirname + '/index.css'),
	debug: !!process.env.INSPECTOR,
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
			h.finish(inst, res);
		});
	});
};

Handler.prototype.build = function(inst, req, res, cb) {
	var h = this;
	queue(1)
	.defer(h.getView.bind(h), req)
	.defer(h.getAuthored.bind(h), inst, req, res)
	.defer(h.getUsed.bind(h), inst, req, res)
	.awaitAll(cb);
};

Handler.prototype.instance = function(url, cb) {
	var h = this;
	var inst = Dom.pages[url];
	if (!inst) inst = Dom.pages[url] = {
		author: {url: 'author:' + h.view.url},
		user: {url: url},
		output: function(page, cb) {
			page.html(cb);
		}
	};
	cb(null, inst);
};

Handler.prototype.finish = function(inst, res) {
	res.type('text/html');
	res.set('Last-Modified', inst.user.mtime.toUTCString());
	res.send(inst.user.data);
};

Handler.prototype.getView = function(req, cb) {
	var h = this;
	if (h.view.valid) {
		return cb();
	}
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
	if (inst.author.valid) {
		return cb();
	}
	if (h.authors.before.length || h.authors.current.length || h.authors.after.length) {
		Dom.pool.acquire(function(err, page) {
			if (err) return cb(err);
			inst.page = page;
			var obj = {
				content: h.view.data,
				console: true
			};
			if (!Dom.settings.debug) obj.style = Dom.settings.style;
			inst.page.preload(inst.user.url, obj);
			h.processMw(inst, h.authors, req, res);
			inst.page.wait('idle').html(function(err, html) {
				delete inst.page;
				Dom.pool.release(page, function(perr) {
					if (err) return cb(err);
					inst.author.data = html;
					inst.author.valid = true;
					inst.author.mtime = new Date();
					cb();
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
	for (var key in inst.opts) {
		opts[key] = inst.opts[key];
	}
	if (!opts.content) opts.content = inst.author.data;
	if (opts.console === undefined) opts.console = true;
	if (opts.images === undefined) opts.images = false;
	if (opts.style === undefined && !Dom.settings.debug) opts.style = Dom.settings.style;
	Dom.pool.acquire(function(err, page) {
		if (err) return cb(err);
		inst.page = page;
		inst.page.load(inst.user.url, opts);
		h.processMw(inst, h.users, req, res);
		inst.page.wait('idle', function(err) {
			if (err) return cb(err);
			inst.user.mtime = new Date();
			inst.output(inst.page, next);
			function next(err, str) {
				Dom.pool.unlock(inst.page, function() {
					delete this.page;
				}.bind(inst));
				if (err) return cb(err);
				inst.user.data = str;
				inst.user.valid = true;
				cb();
			}
		});
	});
};

Handler.prototype.processMw = function(inst, mwObj, req, res) {
	var list = mwObj.before.concat(mwObj.current).concat(mwObj.after);
	for (var i=0; i < list.length; i++) {
		list[i](inst, req, res);
	}
};

function isRemote(url) {
	return /^https?:\/\//.test(url);
}

