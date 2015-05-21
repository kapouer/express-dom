var URL = require('url');
var Path = require('path');

exports.absolute = function(page) {
	page.wait('ready').run(function() {
		function absolut(selector, att) {
			var list = document.querySelectorAll(selector);
			var node;
			for (var i=0; i < list.length; i++) {
				node = list.item(i);
				var href = node[att];
				if (!href) continue;
				var item = node.attributes.getNamedItem(att);
				if (!item) continue;
				item.nodeValue = href;
			}
		}
		absolut('a', 'href');
		absolut('img', 'src');
		absolut('video', 'src');
		absolut('object', 'src');
		absolut('link', 'href');
		absolut('script', 'src');
	});
};

exports.mount = function(page) {
	page.wait('ready').run(function() {
		var loc = document.location.protocol + '//' + document.location.host;
		function mount(selector, att) {
			var list = document.querySelectorAll(selector);
			var node;
			for (var i=0; i < list.length; i++) {
				node = list.item(i);
				var item = node.attributes.getNamedItem(att);
				if (!item) continue;
				var val = item.nodeValue;
				var href = node[att] || loc + '/' + val;
				if (val && /^(\/|#)/.test(val) == false && href && href.indexOf(loc) == 0  && !/^https?:/i.test(val)) {
					item.nodeValue = '/' + val;
				}
			}
		}
		mount('a', 'href');
		mount('img', 'src');
		mount('video', 'src');
		mount('object', 'src');
		mount('link', 'href');
		mount('script', 'src');
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

