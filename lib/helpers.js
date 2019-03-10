var Path = require('path');
var pify = require('pify');
var readFile = pify(require('fs').readFile);
var debug = require('debug')('express-dom');
var BufferList = require('bl');
var http = require('http');
var https = require('https');
var URL = require('url');
var dom = require('..');

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
		return fetchUrl(view).then(function(res) {
			response.status(res.statusCode);
			return bufferPipe(res);
		}).then(update);
	}
	if (typeof view.pipe == "function") {
		return bufferPipe(view).then(update);
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
		return settings;
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
	return readFile(path).catch(function() {
		return tryRoot(views, view);
	});
}

function bufferPipe(ps) {
	return pify(function(cb) {
		ps.pipe(BufferList(cb));
	})();
}

function fetchUrl(url) {
	var obj = typeof url == "string" ? URL.parse(url) : Object.assign({}, url);
	if (!dom.navigator.userAgent) {
		// eslint-disable-next-line no-console
		console.warn("Missing dom.navigator.userAgent property");
	} else {
		obj.headers = Object.assign({
			"User-Agent": dom.navigator.userAgent
		}, obj.headers);
	}
	obj.href = URL.format(obj);
	obj.path = URL.parse(obj.href).path;

	debug("requesting", obj.href);
	return new Promise(function(resolve, reject) {
		var req = (obj.protocol == "https:" ? https : http).request(obj, function(res) {
			if (res.headers.location) {
				var location = URL.resolve(obj.href, res.headers.location);
				var redirObj = URL.parse(location);
				try {
					req.abort();
				} catch(ex) {
					// ignore
				}
				redirObj.redirects = (obj.redirects || 0) + 1;
				if (redirObj.redirects >= 5) {
					debug("Too many redirects");
					return reject(new Error(`Too many redirects ${obj.href}`));
				} else {
					debug("Redirecting to", obj.href);
					fetchUrl(redirObj).then(resolve).catch(reject);
				}
			} else {
				debug("pipe url response", res.statusCode);
				res.setEncoding('utf-8');
				resolve(res);
			}
		});
		req.once('error', reject);
		req.end();
	});
}


exports.prioritize = function(mw, settings, request) {
	if (!settings.priority) settings.priority = 0;
	if (request.xhr) settings.priority++;
};

exports.develop = function(mw, settings, request) {
	if (request.query.develop !== undefined) {
		delete request.query.develop;
		settings.load.disable = true;
	}
};
