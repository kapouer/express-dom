var Path = require('path');
var fs = require('fs');
var debug = require('debug')('express-dom');
var pify = require('pify');
var BufferList = require('bl');
var http = require('http');
var https = require('https');
var URL = require('url');
var PassThrough = require('stream').PassThrough;

exports.view = function(settings, request, response) {
	if (settings.input != null) return;
	var view = settings.view || request.path;

	if (Buffer.isBuffer(view)) {
		return update(view);
	}
	if (
		(typeof view == "string" && /^https?:\/\//.test(view))
		||
		(view.protocol && view.hostname)
	) {
		view = pipeUrl(view);
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

function pipeUrl(url) {
	var obj = typeof url == "string" ? URL.parse(url) : Object.assign({}, url);
	obj.headers = Object.assign({
		"User-Agent": "Mozilla/5.0"
	}, obj.headers);
	if (!obj.href) obj.href = URL.format(obj);

	var ps = new PassThrough();
	debug("requesting", obj.href);
	var req = (obj.protocol == "https:" ? https : http).request(obj, function(res) {
		if (res.headers.location) {
			var location = URL.resolve(obj.href, res.headers.location);
			var redirObj = URL.parse(location);
			try {
				req.abort();
			} catch(ex) {
			}
			redirObj.redirects = (obj.redirects || 0) + 1;
			if (redirObj.redirects >= 5) {
				debug("Too many redirects");
				ps.emit('error', new Error(`Too many redirects ${obj.href}`));
			} else {
				debug("Redirecting to", obj.href);
				pipeUrl(redirObj).pipe(ps);
			}
		} else {
			debug("pipe url response", res.statusCode);
			res.setEncoding('utf-8');
			res.pipe(ps);
		}
	}).end();
	return ps;
}
