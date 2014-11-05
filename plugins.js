var URL = require('url');
var Path = require('path');

exports.absolutify = function(h) {
	h.page.wait('ready').run(function() {
		function absolut(selector, att) {
			var list = document.querySelectorAll(selector);
			var node;
			for (var i=0, len=list.length; i < len; i++) {
				node = list[i];
				if (node[att]) node.attributes.getNamedItem(att).nodeValue = node[att];
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

exports.debug = function(h) {
	h.page.wait('unload');
};
