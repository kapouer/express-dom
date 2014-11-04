var express = require('express');
var app = express();
var dom = require('../');

app.set('views', 'public');

app.get(
	/\.(css|js|woff|eot|ttf|svg|png|jpg|gif)$/,
	express.static('public', {index: false, redirect: false})
);

// disables onlyScripts
dom.plugins = [];

app.get('/', dom('http://figaro-front-test.nsocket.com/fidji/live1', {allow: 'all'}).use(function(page, next) {
	page.on('response', function(res) {
		console.log(res.uri, res.status, res.mime);
	});
	next();
}));
/*
.use(function(h, req, res, next) {
	var pt = require('stream').PassThrough();
	pt.pipe(res);
	h.page.wait('idle', function(err) {
		if (err) return next(err);
	}).png(pt);
}));
*/

var port = 7799;
app.listen(port);
console.log("http://localhost:" + port + "/");

