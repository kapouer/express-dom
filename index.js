var fs = require('fs');
var request = require('request');
var Path = require('path');
var debug = require('debug')('express-dom');
var WebKit = require('webkitgtk');

var Dom = module.exports = function(model, opts) {
	if (!Dom.pool) {
		Dom.pool = new Pool(Dom.settings);
		Dom.handlers = {}; // hash to store each view <-> middleware handler
	}
	var h = Dom.handlers[model];
	if (h) return h.chainable;
	h = new Handler(model, opts);
	Dom.handlers[model] = h;
	return h.chainable;
};

Dom.Handler = Handler;

Dom.settings = {
	max: 16,
	destroyTimeout: 600000,
	idleTimeout: 180000,
	display: process.env.DISPLAY || 0,
	style: fs.readFileSync(__dirname + '/index.css'),
	debug: !!process.env.INSPECTOR,
	console: !!process.env.DEBUG,
	"enable-private-browsing": true,
	"auto-load-images": false,
	stall: 15000,
	allow: "same-origin"
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
	debug("new handler", model, opts);
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
		path = Path.resolve(root, path);
		if (path.indexOf(root) !== 0) return next(new Error("Path outside statics dir\n" + path));
		if (path.slice(-1) == "/") path += "index";
		if (Path.extname(path) != ".html") path += ".html";
		h.url = path;
	}
	var url = req.protocol + '://' + req.headers.host + req.url;
	h.getView(h.url, req, res, function(err, view) {
		if (err) return next(err);
		debug('view loaded', view.key || view.url);
		h.getPage(view, url, req, res, function(err, user) {
			if (err) return next(err);
			debug('page built', user.key || user.url);
			h.finish(user, res);
		});
	});
};

Handler.prototype.getPage = function(view, url, req, res, cb) {
	var h = this;
	h.getAuthored(view, req.protocol + '://' + req.headers.host, req, res, function(err, author) {
		if (err) return cb(err);
		debug('page authored', author.key || author.url);
		h.getUsed(author, url, req, res, cb);
	});
};

Handler.prototype.get = function(url, depend, req, cb) {
	// this is useful for raja dom proxy
	cb = cb || req || depend;
	cb(null, new SimpleResource(url));
};

Handler.prototype.finish = function(user, res) {
	for (var name in user.headers) {
		if (name in {'Content-Type':1, 'Content-Encoding':1}) {
			res.set(name, user.headers[name]);
		}
	}
	if (user.mtime) res.set('Last-Modified', user.mtime.toUTCString());
	res.send(user.data);
	debug('page sent', user.url, user.headers);
};

Handler.prototype.getView = function(url, req, res, cb) {
	var h = this;
	h.get(url, function(err, resource) {
		if (err) return cb(err);
		if (resource.valid) {
			debug("got valid view", resource.key || resource.url);
			return cb(null, resource);
		}
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
	h.get(view.key || view.url, view, {headers: {
		'X-Author': 1,
		'Vary': 'X-Author'
	}}, function(err, resource) {
		if (err) return cb(err);
		if (resource.valid) {
			debug("got valid authored html", resource.key || resource.url);
			return cb(null, resource);
		}
		resource.headers['Content-Type'] = 'text/html';
		if (h.authors.before.length || h.authors.current.length || h.authors.after.length) {
			h.buildAuthored(resource, view, url, req, res, cb);
		} else {
			debug("no author plugins");
			resource.data = view.data;
			resource.valid = true;
			resource.mtime = new Date();
			resource.save(cb);
		}
	});
};

Handler.prototype.buildAuthored = function(resource, view, url, req, res, cb) {
	var h = this;
	Dom.pool.acquire(function(err, page) {
		if (err) return cb(err);
		debug('view.data length', view.data.length);
		var opts = {
			content: view.data,
			console: true
		};
		if (!Dom.settings.debug) opts.style = Dom.settings.style;
		debug('author preload', url);
		page.filters = [];
		page.prepare();
		h.processMw(page, resource, h.authors, req, res);
		page.when('idle', function(wcb) {
			this.html(function(err, str) {
				debug('author.data length', str && str.length);
				Dom.pool.release(page, function() {
					if (err) return cb(err);
					resource.data = str;
					resource.valid = true;
					resource.mtime = new Date();
					resource.save(cb);
				});
				wcb();
			});
		});
		page.preload(url, opts);
	});
};

Handler.prototype.getUsed = function(author, url, req, res, cb) {
	var h = this;
	h.get(url, author, res, function(err, resource) {
		if (err) return cb(err);
		if (resource.valid) {
			debug("got valid user html", resource.key || resource.url);
			return cb(null, resource);
		}
		h.buildUsed(resource, author, url, req, res, cb);
	});
};

Handler.prototype.buildUsed = function(resource, author, url, req, res, cb) {
	var h = this;
	if (author.mtime > resource.mtime) {
		debug('author is more recent than user, reload page', resource.url || resource.key);
		delete resource.page;
	}
	var prevPage = resource.page;
	if (prevPage && prevPage.readyState == "unloading") {
		console.error("* A live page is unloading but still bound to the resource, it must not happen");
		prevPage = false;
	}
	if (prevPage) {
		resource.page.locked = true;
		debug("user page already loaded", resource.key);
		next();
	} else Dom.pool.acquire(function(err, page) {
		if (err) return cb(err);
		resource.page = page;
		var opts = {};
		var customFn;
		for (var key in h.opts) {
			if (key == 'params' && typeof h.opts[key] == 'function') customFn = h.opts[key];
			else opts[key] = h.opts[key];
		}
		if (customFn) customFn(opts, req);
		if (!opts.content) {
			debug('use author data length', author.data.length);
			opts.content = author.data;
		} else {
			debug('use content from customFn data length', opts.content.length);
		}
		for (var k in Dom.settings) if (Dom.settings.hasOwnProperty(k) && opts[k] === undefined) {
			opts[k] = Dom.settings[k];
		}
		page.filters = [];
		page.prepare();
		h.processMw(page, resource, h.users, req, res);
		opts.filters = (opts.filters || []).concat(page.filters);

		debug("user load", resource.key || resource.url, "with stall", opts.stall);
		page.load(resource.url, opts);
		next();
	});
	function next(err) {
		if (err) console.trace(err);
		if (err) return cb(err);
		resource.mtime = new Date();
		resource.headers['Content-Type'] = 'text/html';
		var page = resource.page;
		if (!page) return cb(new Error("resource.page is missing for\n" + resource.key));
		resource.output(page, function(err, str) {
			page.pingTime = Date.now();
			Dom.pool.unlock(page, function(resource) {
				// breaks the link when the page is recycled
				debug("unlocked page removed from resource", resource.key || resource.url);
				delete resource.page;
			}.bind(this, resource));
			if (err) console.trace(err);
			if (err) return cb(err);
			debug('got html', resource.key || resource.url);
			resource.data = str;
			resource.valid = true;
			resource.save(cb);
		});
	}
};

Handler.prototype.processMw = function(page, resource, mwObj, req, res) {
	var list = mwObj.before.concat(mwObj.current).concat(mwObj.after);
	for (var i=0; i < list.length; i++) {
		list[i](page, resource, req, res);
	}
};


function Pool(opts) {
	this.list = [];
	this.count = 0;
	this.max = opts.max || 8;
	this.notices = 1;
	this.queue = [];
	this.destroyTimeout = opts.destroyTimeout || 600000; // destroy the page if not used for that time
	this.idleTimeout = opts.idleTimeout || 180000; // unload the page if not used for that time
	setInterval(this.wipe.bind(this), this.idleTimeout / 4);
}

Pool.prototype.wipe = function() {
	var now = Date.now();
	var page;
	var nlist = [];
	for (var i=0; i < this.list.length; i++) {
		page = this.list[i];
		if (page.trash) continue;
		nlist.push(page);
		if (page.locked) continue;
		if (page.releaseTime) {
			if (now > page.releaseTime + this.destroyTimeout || page.acquisitions >= 100) {
				nlist.pop();
				page.destroy(function(err) {
					if (err) console.error(err);
				});
			}
		} else if (page.pingTime && now > page.pingTime + this.idleTimeout) {
			this.release(page);
		}
	}
	// in case desstroy calls have been made
	if (nlist.length != this.list.length) {
		this.list = nlist;
		this.count = this.list.length;
	}
};

Pool.prototype.acquire = function(cb) {
	var create = false;
	var page;
	if (this.count < this.max) {
		this.count++;
		create = true;
	} else {
		for (var i=0; i < this.list.length; i++) {
			page = this.list[i];
			if (!page.locked && !page.trash) {
				break;
			}
			page = null;
		}
	}

	if (page) {
		this.release(page, function() {
			page.locked = true;
			page.acquisitions++;
			delete page.releaseTime;
			delete page.pingTime;
			cb(null, page);
		});
	} else if (create) {
		WebKit(Dom.settings, function(err, page) {
			if (err) return cb(err);
			page.locked = true;
			page.acquisitions = 1;
			page.on('crash', function() {
				console.warn("crashed page", page.uri);
				page.trash = true;
				this.release(page, function() {
					this.wipe();
				}.bind(this));
			}.bind(this));
			this.list.push(page);
			cb(null, page);
		}.bind(this));
	} else {
		this.queue.push({ts: Date.now(), cb: cb});
		if (this.queue.length > (this.max * this.notices)) {
			this.notices++;
			console.info("express-dom", this.queue.length, "queued acquisitions - consider raising dom.settings.max above", this.max);
		}
	}
};

Pool.prototype.unlock = function(page, unlockCb) {
	debug('unlock called', unlockCb ? 'with' : 'without', 'callback');
	page.unlock = unlockCb;
	page.locked = false;
	setImmediate(this.process.bind(this));
};

Pool.prototype.release = function(page, cb) {
	page.locked = true;
	page.releaseTime = Date.now();
	if (page.unlock) {
		debug("release call page.unlock");
		page.unlock();
		delete page.unlock;
	}
	page.unload(function(err) {
		page.locked = false;
		if (cb) cb(err);
		setImmediate(this.process.bind(this));
	}.bind(this));
};

Pool.prototype.process = function() {
	var next = this.queue.shift();
	if (next) {
		var diff = Date.now() - next.ts;
		if (diff > 5000) console.info("Took", diff + "ms", "to acquire a page");
		this.acquire(next.cb);
	}
};

function SimpleResource(url) {
	this.url = url;
	this.headers = {};
}
SimpleResource.prototype.save = function(cb) {
	cb(null, this);
};

SimpleResource.prototype.output = function(page, cb) {
	page.when('idle', function(wcb) {
		this.html(function(err, str) {
			wcb();
			cb(err, str);
		});
	});
};

function isRemote(url) {
	return /^https?:\/\//.test(url);
}

