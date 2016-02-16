var app = require('express')();
var dom = require('..');
var request = require('request');
var URL = require('url');

app.get('*', function(req, res, next) {
	var url = req.query.url;
	dom(request(url)).load({
		plugins: dom.plugins.png
	}, function(page, state) {
		// make sure the page is hosted with the remote url, not the localhost one
		state.location = URL.parse(url);
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

