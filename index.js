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

//Dom.plugins = require('./plugins');
Dom.edits = [];
Dom.uses = [];


function Handler(remote, options) {
	this.remote = remote;
	this.options = options || {};
	this.chainable = this.middleware.bind(this);
	this.chainable.edit = this.edit.bind(this);
	this.chainable.use = this.use.bind(this);
	this.edits = Dom.edits.slice(0);
	this.uses = Dom.uses.slice(0);
}

Handler.prototype.init = function(settings, cb) {
	if (/https?:/.test(this.remote)) {
		this.url = this.remote;
		request(this.remote, function(err, res, body) {
			if (body) this.html = body;
			else err = new Error("Empty initial html in " + url);
			cb(err);
		}.bind(this));
	} else {
		this.url = req.protocol + '://' + req.headers.host + req.url;
		var view = new (settings.view)(this.remote, {
			defaultEngine: 'html',
			root: settings.views,
			engines: {".html": function() {}}
		});
		if (!view.path) {
			var root = view.root;
			var dirs = Array.isArray(root) && root.length > 1
			?	'directories "' + root.slice(0, -1).join('", "') + '" or "' + root[root.length - 1] + '"'
			: 'directory "' + root + '"';
			var err = new Error('Failed to lookup view "' + this.remote + '" in views ' + dirs);
			err.view = view;
			return cb(err);
		}
		fs.readFile(view.path, function(err, body) {
			if (body) this.html = body;
			else err = new Error("Empty initial html in " + view.path);
			cb(err);
		}.bind(this));
	}
};

Handler.prototype.middleware = function(req, res, next) {
	if (!Dom.pool) Dom.pool = initPool(req.app.settings);

	var q = queue(2)
	.defer(acquire.bind(this))
	.defer(this.init.bind(this), req.app.settings)
	.await(function() {
		var q = queue(1);
		if (this.edits.length) {
			q.defer(prepare.bind(this))
			.defer(processMw.bind(this), this.edits, req, res)
			.defer(processMw.bind(this), [finishEdit], req, res);
		}
		q.defer(load.bind(this), req)
		.defer(processMw.bind(this), this.uses, req, res)
		.defer(processMw.bind(this), [finishUse], req, res)
		.await(next);
	}.bind(this));
};

function load(req, cb) {
	var settings = req.app.settings;
	this.init(settings, function(err) {
		if (err) return cb(err);
		var opts = {};
		for (var key in this.options) {
			opts[key] = this.options[key];
		}
		if (!opts.content) opts.content = this.html;
		if (!opts.cookie) opts.cookie = req.get('Cookie');
		this.page.load(this.url, opts, cb);
	}.bind(this));
}

function prepare(next) {
	this.page.load(this.url, {
		content: this.html,
		allow: "none",
		script: disableAllScripts
	}, next);
}

var disableAllScripts = '(' + function() {
	var disableds = [];
	var observer = new MutationObserver(function(mutations) {
		var node, old, list
		for (var m=0; m < mutations.length; m++) {
			list = mutations[m].addedNodes;
			if (!list) continue;
			for (var i=0; i < list.length; i++) {
				node = list[i];
				if (node.nodeType != 1) continue;
				old = node.type;
				node.type = "disabled";
				disableds.push([node, old]);
			}
		}
	});
	observer.observe(document, {
		childList: true,
		subtree: true
	});
	document.addEventListener('DOMContentLoaded', function() {
		observer.disconnect();
		for (var i=0, len=disableds.length; i < len; i++) {
			disableds[i][0].type = disableds[i][1];
		}
	});
}.toString() + ')();';

function acquire(cb) {
	Dom.pool.acquire(function(err, page) {
		this.page = page;
		cb(err);
	}.bind(this));
}

function release(page) {
	page.removeAllListeners();
	page.unload(function() {
		Dom.pool.release(page);
	});
}

function finishEdit(h, req, res, next) {
	h.page.wait('idle').html(function(err, html) {
		if (err) return next(err);
		h.html = html;
		h.page.removeAllListeners();
	});
}

function finishUse(h, req, res, next) {
	h.page.wait('idle').html(function(err, html) {
		if (err) return next(err);
		res.send(html);
	});
}

function processMw(list, req, res, next) {
	if (!list || !list.length) return next();
	var q = queue(1);
	var self = this;
	list.forEach(function(mw) {
		if (mw.length == 2) q.defer(mw, self.page);
		else q.defer(mw, self, req, res);
	});
	q.await(next);
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

