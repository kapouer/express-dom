var WebKit = require('webkitgtk');
var Pool = require('generic-pool').Pool;
var fs = require('fs');
var queue = require('queue-async');
var escapeStringRegexp = require('escape-string-regexp');
var request = require('request');

var Dom = module.exports = function(model, options) {
	// init pool later, allowing user to set pool settings
	if (!Dom.pool) Dom.pool = Dom.initPool(Dom.settings);
	var h = new Handler(model, options);
	return h.chainable;
};

Dom.Handler = Handler;

Dom.settings = {
	min: 2,
	max: 16,
	idleTimeoutMillis: 30000,
	refreshIdle: false,
	display: 0,
	style: "html,body { display:none !important; }",
	debug: !!process.env.DEBUG
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

function Handler(viewUrl, options) {
	this.viewUrl = viewUrl;
	this.options = options || {};
	this.chainable = this.middleware.bind(this);
	this.chainable.author = this.author.bind(this);
	this.chainable.use = this.use.bind(this);
	this.authors = Dom.authors.slice(0);
	this.users = Dom.users.slice(0);
	this.pages = {};
	if (this.init) this.init(); // used by raja
}

Handler.prototype.middleware = function(req, res, next) {
	var h = this;
	if (!/https?:/.test(h.viewUrl)) {
		// absolute path for h.viewUrl
		var settings = req.app.settings;
		var expressView = new (settings.view)(h.viewUrl, {
			defaultEngine: 'html',
			root: settings.views,
			engines: {".html": function() {}}
		});
		if (!expressView.path) {
			var root = expressView.root;
			var dirs = Array.isArray(root) && root.length > 1
			?	'directories "' + root.slice(0, -1).join('", "') + '" or "' + root[root.length - 1] + '"'
			: 'directory "' + root + '"';
			var err = new Error('Failed to lookup view "' + h.viewUrl + '" in views ' + dirs);
			err.view = expressView;
			return next(err);
		}
		h.viewUrl = expressView.path;
	}
	var url = h.url = req.protocol + '://' + req.headers.host + req.url;
	if (url == h.viewUrl) {
		return next(new Error("The view has the same url as the requested page"));
	}
	h.instance(url, function(err, inst) {
		if (err) return next(err);
		var q = queue(1);
		if (!inst.html) {
			if (!inst.authorHtml) {
				if (!h.viewHtml) {
					q.defer(h.getView.bind(h), req);
				}
				q.defer(h.getAuthored.bind(h), inst, req, res);
			}
			q.defer(h.getUsed.bind(h), inst, req, res);
		}
		q.defer(h.finish.bind(h), inst, res)
		.defer(h.gc.bind(h))
		.awaitAll(function(err, stack) {
			if (err) return next(err);
		});
	});
};

Handler.prototype.instance = function(url, cb) {
	var h = this;
	var inst = h.pages[url];
	if (!inst) inst = h.pages[url] = {
		hits: 0,
		url: url
	};
	inst.hits++;
	inst.atime = Date.now();
	inst.mtime = inst.atime;
	inst.lock = true;
	cb(null, inst);
};

Handler.prototype.finish = function(inst, res, cb) {
	res.type('text/html');
	res.set('Last-Modified', (new Date(inst.mtime)).toUTCString());
	res.send(inst.html);
	// call getUsed when requesting this url again
	delete inst.html;
	inst.lock = false;
	cb();
};

Handler.prototype.acquire = function(inst, cb) {
	if (inst.page) return cb();
	// before acquiring a new page, make sure we can - pool.availableObjectsCount() > 0
	// if it's zero, release a non-locked page with lowest (hits, atime) pair
	this.gc(function() {
		Dom.pool.acquire(function(err, page) {
			inst.page = page;
			cb(err);
		});
	});
};

Handler.prototype.gc = function(cb) {
	if (Dom.pool.getPoolSize() < Dom.settings.max || Dom.pool.availableObjectsCount() > 0) return cb();
	var minScore = +Infinity;
	var minInst;
	for (var url in this.pages) {
		var inst = this.pages[url];
		if (inst.lock) continue;
		var score = 0;
		if (inst.score !== undefined) {
			// allow a score to be set by application
			score = inst.score;
		} else {
			// or use our default scoring
			score = (inst.weight || 1) * 60000 * inst.hits / (Date.now() - inst.atime);
		}
		if (score < minScore) {
			minScore = score;
			minInst = inst;
		}
	}
	if (minInst) {
		this.release(minInst, cb);
	}
};

Handler.prototype.getView = function(req, cb) {
	var h = this;
	if (h.viewHtml) return cb();
	var loader = /https?:/.test(h.viewUrl) ? h.loadRemote : h.loadLocal;
	loader.call(h, h.viewUrl, function(err, body) {
		if (body) {
			h.viewHtml = body;
			h.mtime = Date.now();
		}	else {
			err = new Error("Empty initial html in " + h.viewUrl);
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

Handler.prototype.load = function(inst, req, cb) {
	var h = this;
	var opts = {};
	for (var key in h.options) {
		opts[key] = h.options[key];
	}
	if (!opts.content) opts.content = inst.authorHtml;
	if (!opts.cookie) opts.cookie = req.get('Cookie');
	if (opts.console === undefined) opts.console = true;
	if (opts.images === undefined) opts.images = false;
	if (opts.style === undefined && !Dom.settings.debug) opts.style = Dom.settings.style;
	this.acquire(inst, function(err) {
		if (err) return cb(err);
		inst.page.load(inst.url, opts, cb);
	});
};

Handler.prototype.getAuthored = function(inst, req, res, cb) {
	var h = this;
	if (inst.authorHtml) return cb();
	if (h.authors.length) {
		h.acquire(inst, function(err) {
			if (err) return cb(err);
			var obj = {
				content: h.viewHtml,
				console: true
			};
			if (!Dom.settings.debug) obj.style = Dom.settings.style;
			inst.page.preload(inst.url, obj);
			h.processMw(inst, h.authors, req, res);
			inst.page.wait('idle').html(function(err, html) {
				if (err) return cb(err);
				inst.authorHtml = html;
				inst.page.removeAllListeners();
				cb();
			});
		});
	} else {
		inst.authorHtml = h.viewHtml;
		cb();
	}
};

Handler.prototype.getUsed = function(inst, req, res, cb) {
	var h = this;
	if (inst.html) return cb();
	h.load(inst, req, function(err) {
		h.processMw(inst, h.users, req, res);
		inst.page.wait('idle').html(function(err, html) {
			if (err) return cb(err);
			inst.mtime = Date.now();
			inst.html = html;
			cb();
		});
	});
};

Handler.prototype.release = function(inst, cb) {
	delete this.pages[inst.url];
	var page = inst.page;
	if (!page) return cb();
	page.removeAllListeners();
	page.unload(function(err) {
		Dom.pool.release(page);
		cb(err);
	});
};

Handler.prototype.processMw = function(inst, list, req, res) {
	if (!list || !list.length) return;
	for (var i=0, mw; i < list.length; i++) {
		mw = list[i];
		if (!mw) {
			console.error("Empty middleware");
			continue;
		}
		mw(inst, req, res);
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


Dom.initPool = function(settings) {
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
	var pool = Pool(opts);
	process.on('exit', function() {
		pool.drain(function() {
			pool.destroyAllNow();
		});
	});
	return pool;
};

