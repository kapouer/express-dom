var app = require('express')();
var dom = require('..');
var URL = require('url');

app.get('*', function(req, res, next) {
	var url = req.query.url;
	if (!url) return res.sendStatus(404);
	dom(request(url)).load({
		plugins: dom.plugins.png
	}, function(page, settings, request) {
		// make sure the page is hosted with the remote url, not the localhost one
		settings.allow = 'all';
		request.location = URL.parse(url);
	})(req, res, next);
});

server = app.listen(process.env.PORT, function(err) {
	if (err) console.error(err);
	var port = server.address().port;
	console.log(`
		Call http://localhost:${port}/?url=<remoteUrl>
		to get a screenshot
	`);
});

function request(url) {
	var obj = URL.parse(url);
	if (!obj.protocol) obj.protocol = 'http';
	var mod = obj.protocol.startsWith('https') ? require('https') : require('http');
	obj.headers = {
		'User-Agent': "Mozilla/5.0"
	};
	var ps = new require('stream').PassThrough();
	mod.request(obj, function(res) {
		res.setEncoding('utf-8');
		res.pipe(ps);
	}).end();
	return ps;
}
