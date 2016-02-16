var URL = require('url');
var stream = require('stream');
var dom = require('../');

exports.absolute = function(page) {
	page.when('ready', function(cb) {
		this.run(function() {
			var dloc = document.location;
			var base = dloc.protocol + '//' + dloc.host;
			function absolut(selector, att) {
				var list = document.querySelectorAll(selector);
				var node;
				for (var i=0; i < list.length; i++) {
					node = list.item(i);
					var item = node.attributes.getNamedItem(att);
					if (!item) continue;
					var uloc = new URL(item.nodeValue, base);
					item.nodeValue = uloc.href;
				}
			}
			absolut('a', 'href');
			absolut('img', 'src');
			absolut('video', 'src');
			absolut('object', 'src');
			absolut('link', 'href');
			absolut('script', 'src');
			absolut('include', 'src');
		}, cb);
	});
};

exports.mount = function(page) {
	page.when('ready', function(cb) {
		this.run(function() {
			var dloc = document.location;
			var base = dloc.protocol + '//' + dloc.host;
			function mount(selector, att) {
				var list = document.querySelectorAll(selector);
				var node;
				for (var i=0; i < list.length; i++) {
					node = list.item(i);
					var item = node.attributes.getNamedItem(att);
					if (!item) continue;
					var val = item.nodeValue;
					if (!val || val.charAt(0) == '#') continue;
					var uloc = new URL(val, base);
					if (uloc.protocol == dloc.protocol && uloc.host == dloc.host) {
						item.nodeValue = uloc.pathname + uloc.search + uloc.hash;
					}
				}
			}
			mount('a', 'href');
			mount('img', 'src');
			mount('video', 'src');
			mount('object', 'src');
			mount('link', 'href');
			mount('script', 'src');
			mount('include', 'src');
		}, cb);
	});
};

exports.html = function(page, state, settings) {
	page.when('idle', function(cb) {
		if (state.code) return cb(); // someone has handled this before us
		this.html(function(err, str) {
			state.data = str;
			cb();
		});
	});
};

exports.redirect = function(page, state, settings) {
	page.once('navigate', function(uri) {
		state.status = 302;
		state.headers.Location = uri;
	});
};

exports.nocss = function(page, state, settings) {
	// <script> tags are loaded with request header Accept */*
	// <link> tags are loaded with Accept 'text/css,*/*;q=0.1'
	// Accept text/html is for the document
	// loading images automatically is disabled by default in express-dom
	// everything else is allowed
	settings.filters.push(function() {
		var accept = this.headers.Accept;
		if (accept) {
			if (accept.split(',').shift() == "text/css") this.cancel = true;
		} else if (/.css(\?.*)?$/.test(this.uri)) {
			this.cancel = true;
		}
	});
};

exports.png = function(page, state, settings) {
	page.when('idle', function(cb) {
		var pass = new stream.PassThrough();
		page.png(pass, function(err) {
			if (err) {
				state.status = 500;
				state.data = err;
			} else {
				state.data = pass;
			}
			cb(); // always call after setting state object
		});
	});
};
