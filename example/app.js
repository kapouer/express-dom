var URL = require('url');
var express = require('express');
var app = express();
var dom = require('../');

dom.settings.stall = 1000;
dom.settings.allow = 'all';
dom.settings.charset = 'UTF-8';


// very stupid cache
var cache = {};
var _hget = dom.Handler.prototype.get;
dom.Handler.prototype.get = function(url, depend, req, cb) {
	cb = cb || req || depend;
	var key = url;
	if (!req) key = 'view ' + key;
	else if (req.headers && req.headers['X-Author']) {
		key = 'author ' + key;
	}
	var res = cache[key];
	if (res) return cb(null, res);
	_hget.call(this, url, depend, req, function(err, resource) {
		cache[key] = resource;
		cb(err, resource);
	});
};


dom.author(function(page) {
	page.wait('ready').run(function() {
		Array.prototype.slice.call(document.querySelectorAll('script')).forEach(function(node) {
			node.setAttribute('charset', 'utf-8');
		});
	});
});

dom.use(function(page) {
	page.on('request', function(req) {
		if (req.uri.indexOf('facebook') > 0) req.cancel = true;
	});
});

dom.use(function(page) {
	page.wait('idle').run(function() {
		Array.prototype.slice.call(document.querySelectorAll('script')).forEach(function(node) {
			if (node.parentNode) node.parentNode.removeChild(node);
		});
		// instagram workaround
		Array.prototype.slice.call(document.querySelectorAll('img')).forEach(function(node) {
			if (node.id && node.id.indexOf('pImageLoader') == 0 && node.parentNode) node.parentNode.removeChild(node);
			else node.removeAttribute('style');
		});
	});
}, 'after');

app.get("*", function(req, res, next) {
	var url = req.url;
	if (!url) return res.status(400).send("Usage: " + req.hostname + "/<url>");
	url = url.substring(1);
	if (/^\/\//.test(url)) url = "http:" + url;
	if (! /^https?:\/\//.test(url)) url = "http://" + url;
	var obj = URL.parse(url, true);
	if (!(obj.protocol in {"http:":1, "https:":1})) {
		return res.status(400).send("Unsupported protocol " + obj.protocol);
	}
	if (!obj.hostname || obj.hostname.split('.').length < 2) {
		return res.status(400).send("Bad hostname " + obj.hostname);
	}
	// fake request
	dom(url)({
		protocol: obj.protocol.slice(0, -1),
		headers: { host: obj.host	},
		url: obj.path
	}, res, next);
});

var port = 7799;
app.listen(port);
console.info("http://localhost:" + port + "/https://instagram.com/humansofny");

