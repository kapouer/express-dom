var URL = require('url');
var Path = require('path');

exports.absolute = function(h) {
	h.page.wait('ready').run(function() {
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

exports.mount = function(h) {
	h.page.wait('ready').run(function() {
		var loc = document.location.protocol + '//' + document.location.host;
		function mount(selector, att) {
			var list = document.querySelectorAll(selector);
			var node;
			for (var i=0; i < list.length; i++) {
				node = list.item(i);
				var href = node[att];
				if (!href) continue;
				var item = node.attributes.getNamedItem(att);
				if (!item) continue;
				var val = item.nodeValue;
				if (val && val.toString()[0] != '/' && href && href.indexOf(loc) == 0  && !/^https?:/i.test(val)) {
					item.nodeValue = '/' + val;
				}
			}
		}
		mount('img', 'src');
		mount('video', 'src');
		mount('object', 'src');
		mount('link', 'href');
		mount('script', 'src');
	});
};

exports.nomedia = function(h) {
	h.page.on('request', function(req) {
		var obj = URL.parse(req.uri);
		var ext = Path.extname((obj.pathname || '').split('/').pop());
		if (!ext) return;
		if (ext == ".js") return;
		var accept = req.headers.Accept;
		if (accept == "*/*" || accept == "text/html") return;
		req.cancel = true;
	});
};

