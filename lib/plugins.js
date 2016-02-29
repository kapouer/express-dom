var stream = require('stream');
var debug = require('debug')('express-dom');

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

exports.html = function(page, settings, request, response) {
	page.when('idle', function(cb) {
		debug("html plugin idle");
		if (settings.output) return cb(); // someone has handled this before us
		this.html(function(err, str) {
			if (err) {
				response.status(500);
				settings.output = err;
			} else {
				settings.output = str;
			}
			cb();
		});
	});
};

exports.redirect = function(page, settings, request, response) {
	page.once('navigate', function(uri) {
		response.status(302);
		response.set('Location', uri);
	});
};

exports.referrer = function(page, settings, request) {
	var ref = request.get('Referer');
	if (!ref) return;
	settings.scripts.push({
		fn: function(ref) {
			Object.defineProperty(document, "referrer", {
				get: function() { return "prerender"; }
			});
		},
		args: [ref]
	});
};

exports.noreq = function(page, settings) {
	settings.allow = "none";
	settings['auto-load-images'] = false;
};

exports.prerender = function(page, settings) {
	settings.scripts.push(function() {
		Object.defineProperty(document, "visibilityState", {
			get: function() { return "prerender"; }
		});
	});
};

exports.hide = function(page, settings) {
	// also avoid transitions
	settings.style = `
		html {
			display:none !important;
		}
		* {
			-webkit-transition:none !important;
			transition:none !important;
			-webkit-transition-property: none !important;
			transition-property: none !important;
			-webkit-transform: none !important;
			transform: none !important;
			-webkit-animation: none !important;
			animation: none !important;
		}`;
};

exports.nomedia = function(page, settings) {
	settings['auto-load-images'] = false;
	settings.filters.push(function() {
		var path = (new URL(this.uri, document.location)).pathname;
		if (!path) return;
		var basename = path.split("/").pop();
		if (!basename) return;
		var parts = basename.split(".");
		if (parts.length <= 1) return;
		ext = parts.pop().toLowerCase();
		if (ext.endsWith("json")) return;
		if (ext.endsWith("ml")) return;
		if (ext == "js") return;
		this.cancel = true;
	});
};

exports.png = function(page, settings, request, response) {
	settings['auto-load-images'] = true;
	settings.style = null;
	page.when('idle', function(cb) {
		var pass = new stream.PassThrough();
		page.png(pass, function(err) {
			if (err) {
				response.status(500);
				settings.output = err;
			} else {
				response.set('Content-Type', 'image/png');
				settings.output = pass;
			}
			cb(); // always call after setting state object
		});
	});
};
