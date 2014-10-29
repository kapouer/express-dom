var express = require('express');
var app = express();
var dom = require('../');

app.set('views', 'public');

app.get(
	/\.(css|js|woff|eot|ttf|svg|png|jpg|gif)$/,
	express.static('public', {index: false, redirect: false})
);

app.get('/', dom('index').use(function(page, next) {
	page.on('request', function(req) {
		if (/\.js$/.test(req.uri) == false && req.uri != page.uri) req.uri = null;
		console.log("page request", req.uri);
	});
	page.on('response', function(res) {
		console.log(res.uri, res.status);
	});
	next();
}));

var port = 7799;
app.listen(port);
console.log("http://localhost:" + port + "/");

