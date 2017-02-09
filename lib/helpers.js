var Path = require('path');
var pify = require('pify');
var readFile = pify(require('fs').readFile);
var debug = require('debug')('express-dom');
var BufferList = require('bl');
var http = require('http');
var https = require('https');
var URL = require('url');
var dom = require('..');
var PassThrough = require('stream').PassThrough;

exports.view = function view(mw, settings, request, response) {
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
		debug('View is html string');
		return update(view);
	}
	var views = settings.views || request.app && request.app.get('views') || [];
	if (!Array.isArray(views)) views = [views];
	if (views.length == 0) {
		return Promise.reject(new Error("Please set settings.views or app views"));
	}

	return tryRoot(views.slice(), view).then(update);

	function update(input) {
		settings.input = input;
	}
};

function tryRoot(views, view) {
	if (views.length == 0) return Promise.reject(new Error("view not found " + view));
	var root = views.shift();

	var path = Path.join(root, view);
	if (path.indexOf(root) !== 0) return Promise.reject(
		new Error("Path outside views dir\n" + root + '\n' + view)
	);
	if (Path.extname(path) != ".html") path += ".html";
	debug("read view from", path);
	return readFile(path).catch(function(err) {
		return tryRoot(views, view);
	});
}

function pipeUrl(url) {
	var obj = typeof url == "string" ? URL.parse(url) : Object.assign({}, url);
	obj.headers = Object.assign({
		"User-Agent": dom.navigator.userAgent
	}, obj.headers);
	obj.href = URL.format(obj);
	obj.path = URL.parse(obj.href).path;

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


exports.prioritize = function(mw, settings, request, response) {
	if (!settings.priority) settings.priority = 0;
	if (request.xhr) settings.priority++;
};

exports.develop = function(mw, settings, request, response) {
	settings.load.disable = request.query.develop !== undefined;
};
