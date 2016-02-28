var app = require('express')();
var dom = require('..');
var URL = require('url');

app.get('*', dom(function(settings, request, response) {
	if (!request.query.url) return response.sendStatus(400);
	var obj = URL.parse(request.query.url);
	if (!obj.protocol) obj.protocol = 'http:';
	settings.location = Object.assign({}, obj);
	var mod = obj.protocol.startsWith('https') ? require('https') : require('http');
	obj.headers = {
		'User-Agent': "Mozilla/5.0"
	};
	// here we use a passthrough, but returning a promise can avoid that
	var ps = new require('stream').PassThrough();
	mod.request(obj, function(res) {
		res.setEncoding('utf-8');
		res.pipe(ps);
	}).end();
	settings.input = ps;
}).load({
	plugins: dom.plugins.png
}));

server = app.listen(process.env.PORT, function(err) {
	if (err) console.error(err);
	var port = server.address().port;
	console.log(`
		Call http://localhost:${port}/?url=<remoteUrl>
		to get a screenshot
	`);
});

