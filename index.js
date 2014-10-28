var WebKit = require('webkitgtk');
var Pool = require('generic-pool').Pool;
var fs = require('fs');
var queue = require('queue-async');

var Dom = module.exports = function open(url) {
	var h = new Handler(url, this.plugins);
	return h.middleware.bind(h);
};
Dom.plugins = [];
Dom.open = open;

Dom.use = function(fn) {
	this.plugins.push(fn);
};


function Handler(url, plugins) {
	this.url = url;
	this.middleware.open = this.open.bind(this);
	this.middleware.use = this.use.bind(this);
	this.before = plugins.slice(0);
}

Handler.prototype.init = function(url, settings, cb) {
	if (/https?:/.test(url)) {
		request(url, function(err, res, body) {
			if (body) this.html = body;
			cb(err);
		}.bind(this));
	} else {
		var view = new (settings.view)(url, {
			defaultEngine: 'html',
			root: settings.views,
			engines: {html: function() {}}
		});
		if (!view.path) {
			var root = view.root;
			var dirs = Array.isArray(root) && root.length > 1
			?	'directories "' + root.slice(0, -1).join('", "') + '" or "' + root[root.length - 1] + '"'
			: 'directory "' + root + '"';
			var err = new Error('Failed to lookup view "' + url + '" in views ' + dirs);
			err.view = view;
			return cb(err);
		}
		fs.readFile(view.path, function(err, body) {
			if (body) this.html = body;
			cb(err);
		}.bind(this));
	}
};

Handler.prototype.middleware = function(req, res, next) {
	if (this.view) {
		return next(new Error("dom middleware not supposed to be called twice"));
	}
	if (!Dom.pool) Dom.pool = initPool(req.app.settings);

	var q = queue(1)
	.defer(acquire.bind(this))
	.defer(processMw.bind(this), this.before, req, res);
	.defer(load.bind(this), req)
	.defer(processMw.bind(this), this.after, req, res)
	.defer(processMw.bind(this), [lastMiddleware], req, res)
	.await(next);
};

function load(req, cb) {
	var url = req.protocol + '://' + req.headers.host + req.url;
	var settings = req.app.settings;
	this.init(this.url, settings, function(err) {
		if (err) return cb(err);
		this.page.load(url, {
			content: this.html,
			cookie: req.get('Cookie')
		}, cb);
	}.bind(this));
}

function acquire(cb) {
	Dom.pool.acquire(function(err, page) {
		this.page = page;
		cb(err);
	}.bind(this));
}

function lastMiddleware(page, req, res, next) {
	page.html(function(err, html) {
		if (err) return next(err);
		res.send(html);
	});
}

function processMw(list, req, res, next) {
	if (!list.length) return next();
	var q = queue(1);
	var page = this.page;
	list.forEach(function(mw) {
		q.defer(mw, page, req, res);
	});
	q.await(next);
}

Handler.prototype.use = function(mw) {
	(this.after || this.before).push(mw);
	return this.middleware.bind(this);
};
Handler.prototype.open = function() {
	if (this.after) throw new Error("already opened");
	this.after = [];
	return this.middleware.bind(this);
};


function initPool(settings) {
	return Pool({
		name : 'webkit',
		create : function(callback) {
			callback(null, WebKit(settings.display));
		},
		destroy : function(client) {
			client.destroy();
			if (global.gc) {
				global.gc();
			}
		},
		max : 8,
		min : 1,
		idleTimeoutMillis : 30000,
		refreshIdle: false
	});
}

