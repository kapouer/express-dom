var URL = require('url');
var Path = require('path');

exports.absolute = function(page) {
	page.wait('ready').run(function() {
		function absolut(selector, att) {
			var list = document.querySelectorAll(selector);
			var node;
			for (var i=0; i < list.length; i++) {
				node = list.item(i);
				var item = node.attributes.getNamedItem(att);
				if (!item) continue;
				var uloc = new URL(item.nodeValue, document.baseURI);
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
	});
};

exports.mount = function(page) {
	page.wait('ready').run(function() {
		var dloc = document.location;
		function mount(selector, att) {
			var list = document.querySelectorAll(selector);
			var node;
			for (var i=0; i < list.length; i++) {
				node = list.item(i);
				var item = node.attributes.getNamedItem(att);
				if (!item) continue;
				var uloc = new URL(item.nodeValue, document.baseURI);
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
	});
};

exports.nostylesheets = function(page) {
	// <script> tags are loaded with request header Accept */*
	// <link> tags are loaded with Accept 'text/css,*/*;q=0.1'
	// Accept text/html is for the document
	// loading images automatically is disabled by default in express-dom
	// everything else is allowed
	page.on('request', function(req) {
		var accept = req.headers.Accept;
		if (accept && accept.split(',').shift() == "text/css") req.cancel = true;
	});
};

