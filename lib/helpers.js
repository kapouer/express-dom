var Path = require('path');
var fs = require('fs');
var debug = require('debug')('express-dom');
var pify = require('pify');
var BufferList = require('bl');

exports.view = function(settings, request, response) {
	if (settings.input != null) return;
	var view = settings.view || request.path;

	if (Buffer.isBuffer(view)) {
		return update(view);
	}
	if (typeof view.pipe == "function") {
		return pify(function(cb) {
			view.pipe(BufferList(cb));
		})().then(update);
	}
	if (typeof view != "string") {
		return Promise.reject(new Error("unknown input type"));
	}
	if (view.startsWith('<')) {
		return update(view);
	}
	var root = request.app.get('views');
	if (!root) return Promise.reject(
		new Error("Please set app views")
	);
	var path = Path.join(root, view);
	if (path.indexOf(root) !== 0) return Promise.reject(
		new Error("Path outside views dir\n" + path)
	);
	if (Path.extname(path) != ".html") path += ".html";
	debug("read view from", path);
	return pify(fs.readFile)(path).then(update);

	function update(input) {
		settings.input = input;
	}
};

