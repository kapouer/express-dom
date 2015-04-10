var WebKit = require('webkitgtk');
var fs = require('fs');
var queue = require('queue-async');
var request = require('request');
var Path = require('path');
var debug = require('debug')('express-dom');


var Dom = module.exports = function(model, opts) {
	if (!Dom.pool) {
		Dom.pool = new Pool(Dom.settings.max);
		Dom.handlers = {}; // hash to store each view <-> middleware handler
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
		this.url = model;
	} else {
		this.model = model; // app.get('statics') is available in middleware
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
	if (h.model != null && h.url == null) {
		var path = h.model;
		var root = req.app.get('statics');
		if (!root) return next(new Error("Cannot find view, undefined 'statics' application setting"));
		if (!path) path = "index";
		var path = Path.resolve(root, path);
		if (path.indexOf(root) !== 0) return next(new Error("Path outside statics dir\n" + path));
		if (path.slice(-1) == "/") path += "index";
		if (Path.extname(path) != ".html") path += ".html";
		h.url = path;
	}
	var url = req.protocol + '://' + req.headers.host + req.url;
	if (url == h.url) {
		return next(new Error("The view has the same url as the requested page"));
	}
	h.getView(h.url, req, res, function(err, view) {
		if (err) return next(err);
		debug('view loaded', view.key, view.url);
		h.getPage(view, url, req, res, function(err, user) {
			if (err) return next(err);
			debug('page built', user.key);
			h.finish(user, res);
		});
	});
};

Handler.prototype.getPage = function(view, url, req, res, cb) {
	var h = this;
	h.getAuthored(view, url, req, res, function(err, author) {
		if (err) return cb(err);
		debug('page authored', author.key);
		h.getUsed(author, url, req, res, cb);
	});
};

Handler.prototype.get = function(url, depend, req, cb) {
	// this is useful for raja dom proxy
	cb(null, new SimpleResource(url));
};

Handler.prototype.finish = function(user, res) {
	res.set('Content-Type', user.headers['Content-Type']);
	res.set('Last-Modified', user.mtime.toUTCString());
	res.send(user.data);
	debug('page sent', user.url, user.headers);
};

Handler.prototype.getView = function(url, req, res, cb) {
	var h = this;
	h.get(url, function(err, resource) {
		if (resource.valid) return cb(null, resource);
		var loader = isRemote(url) ? h.loadRemote : h.loadLocal;
		loader.call(h, url, function(err, body) {
			if (!err || body) {
				resource.data = body;
				resource.valid = true;
				resource.mtime = new Date();
				resource.save(cb);
			}	else {
				if (!err) err = new Error("Empty initial html in " + url);
				if (!err.code || err.code == 'ENOENT') err.code = 404;
				else err.code = 500;
				cb(err);
			}
		});
	});
};

Handler.prototype.loadLocal = fs.readFile;
Handler.prototype.loadRemote = function(url, cb) {
	request(url, function(err, res, body) {
		cb(err, body);
	});
};

Handler.prototype.getAuthored = function(view, url, req, res, cb) {
	var h = this;
	h.get(url, view, {headers: { 'X-Author': 1, 'Vary': 'X-Author' }}, function(err, resource) {
		if (resource.valid) return cb(null, resource);
		resource.headers['Content-Type'] = 'text/html';
		if (h.authors.before.length || h.authors.current.length || h.authors.after.length) {
			Dom.pool.acquire(function(err, page) {
				if (err) return cb(err);
				var opts = {
					content: view.data,
					console: true
				};
				if (!Dom.settings.debug) opts.style = Dom.settings.style;
				page.preload(url, opts);
				h.processMw(page, resource, h.authors, req, res);
				page.wait('idle').html(function(err, html) {
					Dom.pool.release(page, function(perr) {
						if (err) return cb(err);
						resource.data = html;
						resource.valid = true;
						resource.mtime = new Date();
						resource.save(cb);
					});
				});
			});
		} else {
			resource.data = view.data;
			resource.valid = true;
			resource.mtime = new Date();
			resource.save(cb);
		}
	});
};

Handler.prototype.getUsed = function(author, url, req, res, cb) {
	var h = this;
	h.get(url, author, req, function(err, resource) {
		if (resource.valid) return cb(null, resource);
		Dom.pool.acquire(resource.page, function(err, page) {
			if (err) return cb(err);
			if (!resource.page) {
				resource.page = page;
				var opts = {};
				var customFn;
				for (var key in h.opts) {
					if (key == 'params' && typeof h.opts[key] == 'function') customFn = h.opts[key];
					else opts[key] = h.opts[key];
				}
				if (customFn) customFn(opts, req);
				if (!opts.content) opts.content = author.data;
				if (opts.console === undefined) opts.console = true;
				if (opts.images === undefined) opts.images = false;
				if (opts.style === undefined && !Dom.settings.debug) opts.style = Dom.settings.style;
				debug("user load", resource.key);
				page.load(resource.url, opts);
				h.processMw(page, resource, h.users, req, res);
				page.wait('idle', next);
			} else {
				next();
			}
		});
		function next(err) {
			if (err) return cb(err);
			resource.mtime = new Date();
			resource.headers['Content-Type'] = 'text/html';
			var page = resource.page;
			page.html(function(err, str) {
				Dom.pool.unlock(page, function(resource) {
					// breaks the link when the page is recycled
					debug("unlocked page removed from resource", resource.key);
					delete resource.page;
				}.bind(this, resource));
				if (err) return cb(err);
				debug('got html', resource.key);
				resource.data = str;
				resource.valid = true;
				resource.save(cb);
			});
		}
	});
};

Handler.prototype.processMw = function(page, resource, mwObj, req, res) {
	var list = mwObj.before.concat(mwObj.current).concat(mwObj.after);
	for (var i=0; i < list.length; i++) {
		list[i](page, resource, req, res);
	}
};


function Pool(cacheSize) {
	this.list = [];
	this.max = cacheSize;
	this.count = 0;
	this.queue = [];
}

Pool.prototype.acquire = function(page, cb) {
	if (page && !cb) {
		cb = page;
		page = null;
	}
	if (page) {
		page.locked = true;
	} else if (this.count < this.max) {
		this.count++;
		page = WebKit(Dom.settings);
		page.locked = true;
		this.list.push(page);
	} else for (var i=0; i < this.list.length; i++) {
		page = this.list[i];
		if (!page.locked) {
			page.locked = true;
			if (typeof page.unlock == "function") {
				debug("acquire call page.unlock");
				page.unlock();
				page.removeAllListeners();
				page.html = page.prototype.html;
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
	debug('unlock called', unlockCb ? 'with' : 'without', 'callback');
	page.unlock = unlockCb;
	page.locked = false;
	setImmediate(this.process.bind(this));
};

Pool.prototype.release = function(page, cb) {
	page.unload(function(err) {
		if (page.unlock) {
			debug("release call page.unlock");
			delete page.unlock;
		}
		page.removeAllListeners();
		page.html = page.constructor.prototype.html;
		page.locked = false;
		if (cb) cb();
		setImmediate(this.process.bind(this));
	}.bind(this));
};

Pool.prototype.process = function() {
	var next = this.queue.shift();
	if (next) this.acquire(next);
};

function SimpleResource(url) {
	this.url = url;
}
SimpleResource.prototype.save = function(cb) {
	cb(null, this);
};

function isRemote(url) {
	return /^https?:\/\//.test(url);
}

