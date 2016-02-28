var expect = require('expect.js');
var request = require('request');
var express = require('express');

var host = "http://localhost";
var dom = require('../');
dom.settings.stall = 5000;
dom.settings.allow = 'all';
dom.settings.timeout = 10000;
dom.settings.console = true;

describe("Miscellaneous tries", function suite() {
	this.timeout(3000);
	var server, port;

	before(function(done) {
		var app = express();
		app.set('views', __dirname + '/public');

		app.get('/d0.js', function(req, res, next) {
			res.end('$(function() {$(".shouldbemodified").text("éè");});')
		});

		app.get(/\.(json|js|css|png)$/, express.static(app.get('views')));
		app.get(/\.html$/, dom().load(function(p, s, request) {
			s['default-charset'] = request.headers['accept-charset'];
		}));

		server = app.listen(function(err) {
			if (err) console.error(err);
			port = server.address().port;
			done();
		});
	});

	after(function(done) {
		server.close();
		done();
	});



// Miscellaneous d0
	it("should understand string as utf8 (default)", function(done) {
		request({
			method: 'GET',
			url: host + ':' + port + '/d0.html'
		}, function(err, res, body) {
			expect(body.indexOf('éè')).to.be.greaterThan(0);
			done();
		});
	});

// Miscellaneous d1
	it("should understand string as iso-8859-1 when charset set accordingly", function(done) {
		request({
			method: 'GET',
			url: host + ':' + port + '/d0.html',
			headers: {
				"Accept-Charset": "iso-8859-1"
			}
		}, function(err, res, body) {
			expect(body.indexOf('Ã©Ã¨')).to.be.greaterThan(0);
			done();
		});
	});
});

