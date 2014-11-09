var express = require('express');
var app = express();
var dom = require('../');

app.set('views', 'public');

app.get(
	/\.(css|js|woff|eot|ttf|svg|png|jpg|gif)$/,
	express.static('public', {index: false, redirect: false})
);

app.get('/', dom('http://figaro-front-test.nsocket.com/fidji/live1')
.edit(dom.plugins.absolutify)
);

app.use(function(err, req, res, next) {
	if (err) {
		console.error(err);
		res.sendStatus(500);
	} else {
		next();
	}
});
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

