var expect = require('expect.js');
var request = require('request');
var express = require('express');

var host = "http://localhost";
var dom = require('../');
dom.settings.stall = 5000;
dom.settings.allow = 'all';
dom.settings.timeout = 10000;
dom.settings.console = true;

describe("Remote url loading", function suite() {
	this.timeout(3000);
	var server, port;

	before(function(done) {
		var app = express();
		app.set('views', __dirname + '/public');
		app.get(/\.(json|js|css|png)$/, express.static(app.get('views')));
		app.get('/remote', dom(function(mw, settings, req, res) {
			if (req.query.url) {
				settings.view = req.query.url;
			}
		}).load());
		app.get('/a1.html', dom(function(mw, settings, req, res) {
			if (req.query.status) {
				res.statusCode = parseInt(req.query.status);
			}
		}).load());


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


	it("should load a remote url", function(done) {
		var urlA = host + ':' + port + '/remote';
		var urlB = host + ':' + port + '/a1.html?status=404';
		request({
			method: 'GET',
			url: urlA + '?url=' + encodeURIComponent(urlB)
		}, function(err, res, body) {
			expect(res.statusCode).to.be(404);
			expect(body.indexOf('toto')).to.be.greaterThan(0);
			done();
		});
	});

});

