// if using webkitgtk native, run this example with `xfvb-run -a node snapshot.js`

var app = require('express')();
var dom = require('..');
var URL = require('url');

app.get('*', dom(function(mw, settings, request, response) {
	if (!request.query.url) return response.sendStatus(400);
	var obj = URL.parse(request.query.url);
	if (!obj.protocol || !obj.host) return response.sendStatus(400);
	settings.location = Object.assign({}, obj);
	settings.view = request.query.url;
}).load({
	stall: 1000,
	plugins: [dom.plugins.png, function(page, settings) { settings.allow = "all"; }]
}));

server = app.listen(process.env.PORT, function(err) {
	if (err) console.error(err);
	var port = server.address().port;
	console.log(`
		Call http://localhost:${port}/?url=<remoteUrl>
		to get a screenshot
	`);
});

