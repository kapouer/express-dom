var WebKit = require('webkitgtk');
var Pool = require('generic-pool').Pool;
var fs = require('fs');
var queue = require('queue-async');
var escapeStringRegexp = require('escape-string-regexp');
var request = require('request');

var Dom = module.exports = function(model, options) {
	var h = new Handler(model, options);
	return h.chainable;
};

Dom.Handler = Handler;

Dom.settings = {
	min: 1,
	max: 8,
	idleTimeoutMillis: 30000,
	refreshIdle: false,
	display: 0,
	debug: !!process.env.DEBUG
};
Dom.plugins = require('./plugins');

Dom.authors = [];
Dom.users = [Dom.plugins.nomedia];

Dom.author = function(mw) {
	Dom.authors.push(mw);
	return Dom;
};

Dom.use = function(mw) {
	Dom.users.push(mw);
	return Dom;
};

function Handler(url, options) {
	this.viewUrl = url;
	this.options = options || {};
	this.chainable = this.middleware.bind(this);
	this.chainable.author = this.author.bind(this);
	this.chainable.use = this.use.bind(this);
	this.authors = Dom.authors.slice(0);
	this.users = Dom.users.slice(0);
}

Handler.prototype.middleware = function(req, res, next) {
	this.url = req.protocol + '://' + req.headers.host + req.url;
	if (this.url == this.viewUrl) {
		return next(new Error("The view has the same url as the requested page"));
	}
	if (!Dom.pool) Dom.pool = initPool(Dom.settings);
	queue(1)
	.defer(this.acquire.bind(this))
	.defer(this.getView.bind(this), req)
	.defer(this.getAuthored.bind(this), req, res)
	.defer(this.getUsed.bind(this), req, res)
	.defer(this.release.bind(this))
	.awaitAll(function(err, stack) {
		if (err) return next(err);
		res.send(this.html);
	}.bind(this));
};

Handler.prototype.acquire = function(cb) {
	var h = this;
	Dom.pool.acquire(function(err, page) {
		h.page = page;
		cb(err);
	});
};

Handler.prototype.getView = function(req, cb) {
	var h = this;
	var settings = req.app.settings;
	if (/https?:/.test(h.viewUrl)) {
		request(h.viewUrl, function(err, res, body) {
			if (body) h.viewHtml = body;
			else err = new Error("Empty initial html in " + h.viewUrl);
			cb(err);
		});
	} else {
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
			return cb(err);
		}
		fs.readFile(expressView.path, function(err, body) {
			if (body) h.viewHtml = body;
			else err = new Error("Empty initial html in " + expressView.path);
			cb(err);
		});
	}
};

Handler.prototype.load = function(req, cb) {
	var h = this;
	var opts = {};
	for (var key in h.options) {
		opts[key] = h.options[key];
	}
	if (!opts.content) opts.content = h.authorHtml;
	if (!opts.cookie) opts.cookie = req.get('Cookie');
	if (opts.console === undefined) opts.console = true;
	if (!cb) h.page.load(h.url, opts);
	else if (cb) h.page.load(h.url, opts);

};

Handler.prototype.getAuthored = function(req, res, cb) {
	var h = this;
	if (h.authors.length) {
		h.page.preload(h.url, {content: h.viewHtml, console: true});
		h.processMw(h.authors, req, res);
		h.page.wait('idle').html(function(err, html) {
			if (err) return cb(err);
			h.authorHtml = html;
			h.page.removeAllListeners();
			cb();
		});
	} else {
		h.authorHtml = h.viewHtml;
		cb();
	}
};

Handler.prototype.getUsed = function(req, res, cb) {
	this.load(req);
	this.processMw(this.users, req, res);
	this.page.wait('idle').html(function(err, html) {
		if (err) return cb(err);
		this.html = html;
		cb();
	}.bind(this));
};

Handler.prototype.release = function(cb) {
	var page = this.page;
	page.removeAllListeners();
	page.unload(function(err) {
		Dom.pool.release(page);
		cb(err);
	});
};

Handler.prototype.processMw = function(list, req, res) {
	if (!list || !list.length) return;
	for (var i=0, mw; i < list.length; i++) {
		mw = list[i];
		if (!mw) {
			console.error("Empty middleware");
			continue;
		}
		mw(this, req, res);
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
	return Pool(opts);
}

