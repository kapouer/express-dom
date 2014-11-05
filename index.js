var WebKit = require('webkitgtk');
var Pool = require('generic-pool').Pool;
var fs = require('fs');
var queue = require('queue-async');
var escapeStringRegexp = require('escape-string-regexp');
var request = require('request');

var Dom = module.exports = function(url, options) {
	var h = new Handler(url, options);
	return h.chainable;
};

Dom.settings = {
	min: 1,
	max: 8,
	idleTimeoutMillis: 30000,
	refreshIdle: false,
	display: 0,
	debug: !!process.env.DEBUG
};
Dom.plugins = require('./plugins');

Dom.edits = [];
Dom.uses = [Dom.plugins.nomedia];


function Handler(remote, options) {
	this.remote = remote;
	this.options = options || {};
	this.chainable = this.middleware.bind(this);
	this.chainable.edit = this.edit.bind(this);
	this.chainable.use = this.use.bind(this);
	this.edits = Dom.edits.slice(0);
	this.uses = Dom.uses.slice(0);
}

Handler.prototype.middleware = function(req, res, next) {
	if (!Dom.pool) Dom.pool = initPool(Dom.settings);
	var q = queue(2)
	.defer(acquire, this)
	.defer(init, this, req.app.settings)
	.awaitAll(function(err) {
		if (err) return next(err);
		var q = queue(1);
		if (this.edits.length) {
			this.page.preload(this.url, {content: this.html});
			processMw(this, this.edits, req, res);
			q.defer(finishEdit, this);
		}
		q.awaitAll(function(err) {
		console.log("never reached")
			if (err) return next(err);
			load(this, req);
			processMw(this, this.uses, req, res);
			finishUse(this, req, res, next);
		}.bind(this));
	}.bind(this));
};

function acquire(h, cb) {
	Dom.pool.acquire(function(err, page) {
		h.page = page;
		cb(err);
	});
}

function init(h, settings, cb) {
	if (/https?:/.test(h.remote)) {
		h.url = h.remote;
		request(h.remote, function(err, res, body) {
			if (body) h.html = body;
			else err = new Error("Empty initial html in " + url);
			cb(err);
		});
	} else {
		h.url = req.protocol + '://' + req.headers.host + req.url;
		var view = new (settings.view)(h.remote, {
			defaultEngine: 'html',
			root: settings.views,
			engines: {".html": function() {}}
		});
		if (!view.path) {
			var root = view.root;
			var dirs = Array.isArray(root) && root.length > 1
			?	'directories "' + root.slice(0, -1).join('", "') + '" or "' + root[root.length - 1] + '"'
			: 'directory "' + root + '"';
			var err = new Error('Failed to lookup view "' + h.remote + '" in views ' + dirs);
			err.view = view;
			return cb(err);
		}
		fs.readFile(view.path, function(err, body) {
			if (body) h.html = body;
			else err = new Error("Empty initial html in " + view.path);
			cb(err);
		});
	}
}

function load(h, req) {
	var opts = {};
	for (var key in h.options) {
		opts[key] = h.options[key];
	}
	if (!opts.content) opts.content = h.html;
	if (!opts.cookie) opts.cookie = req.get('Cookie');
	h.page.load(h.url, opts);
}

function release(page) {
	page.removeAllListeners();
	page.unload(function() {
		Dom.pool.release(page);
	});
}

function finishEdit(h, cb) {
	h.page.wait('idle').html(function(err, html) {
		if (Dom.settings.debug) return;
		if (err) return cb(err);
		h.html = html;
		h.page.removeAllListeners();
		cb();
	});
}

function finishUse(h, req, res, next) {
	h.page.wait('idle').html(function(err, html) {
		if (err) return next(err);
		res.send(html);
	});
}

function processMw(h, list, req, res) {
	if (!list || !list.length) return;
	for (var i=0, mw; i < list.length; i++) {
		mw = list[i];
		if (!mw) {
			console.error("Empty middleware");
			continue;
		}
		mw(h, req, res);
	}
}

Handler.prototype.use = function(mw) {
	this.uses.push(mw);
	return this.chainable;
};
Handler.prototype.edit = function(mw) {
	this.edits.push(mw);
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
		Dom.edits.push(Dom.plugins.debug);
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

