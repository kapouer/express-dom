const Path = require('node:path');
const { readFile } = require('node:fs/promises');
const { promisify } = require('node:util');
const { request } = require('undici');

const debug = require('debug')('express-dom');
const { BufferListStream } = require('bl');

exports.view = async function view(mw, settings, req, res) {
	if (settings.input != null) return;
	const view = settings.view || req.path;

	if (Buffer.isBuffer(view)) {
		return update(view);
	}
	if (
		(typeof view == "string" && /^https?:\/\//.test(view))
		||
		(view.protocol && view.hostname)
	) {
		const { body, statusCode } = await request(view, {
			headers: {
				// TODO UserAgent here ? do we really care ?
				Accept: 'text/html'
			}
		});
		res.status(statusCode);
		return update(body);
	}
	if (typeof view.pipe == "function") {
		return bufferPipe(view).then(update);
	}
	if (typeof view != "string") {
		throw new Error("unknown input type");
	}
	if (view.startsWith('<')) {
		debug('View is html string');
		return update(view);
	}
	let views = settings.views ?? req.app?.get('views') ?? [];
	if (!Array.isArray(views)) views = [views];
	if (views.length == 0) {
		throw new Error("Please set settings.views or app views");
	}

	return tryRoot(views.slice(), view).then(update);

	function update(input) {
		settings.input = input;
		return settings;
	}
};

function tryRoot(views, view) {
	if (views.length == 0) throw new Error("view not found " + view);
	const root = views.shift();

	let path = view.indexOf(root) === 0 ? view : Path.join(root, view);
	if (path.indexOf(root) !== 0) {
		throw new Error("Path outside views dir\n" + root + '\n' + view);
	}
	if (Path.extname(path) != ".html") path += ".html";
	debug("read view from", path);
	return readFile(path).catch(() => {
		return tryRoot(views, view);
	});
}

function bufferPipe(ps) {
	return promisify(cb => {
		ps.pipe(BufferListStream(cb));
	})();
}


exports.prioritize = function(mw, settings, request) {
	if (!settings.priority) settings.priority = 0;
	if (request.xhr) settings.priority++;
};

exports.develop = function(mw, settings, request) {
	if (request.query.develop !== undefined) {
		settings.location.searchParams.delete('develop');
		settings.load.disable = true;
	}
};
