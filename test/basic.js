var expect = require('expect.js');
var request = require('request');
var express = require('express');

var host = "http://localhost";
var dom = require('../');
dom.settings.stall = 5000;
dom.settings.allow = 'all';
dom.settings.timeout = 10000;
dom.settings.console = true;

describe("Basic handler", function suite() {
	this.timeout(3000);
	var server, port = 7779;

	before(function(done) {
		var app = express();
		app.set('statics', __dirname + '/public');
		app.get(/\.(json|js|css|png)$/, express.static(app.get('statics')));
		app.get(/\.html$/, function(req, res, next) {
			dom(req.path.substring(1))(req, res, next);
		});

		server = app.listen(port, function(err) {
			if (err) console.error(err);
			done();
		});
	});

	after(function(done) {
		server.close();
		done();
	});

	it("should change body by script run after DOMContentLoaded event in user phase", function(done) {
		request({
			method: 'GET',
			url: host + ':' + port + '/basic1.html'
		}, function(err, res, body) {
			expect(res.statusCode).to.be(200);
			expect(body.indexOf('toto')).to.be.greaterThan(0);
			done();
		});
	});

	it("should change body by external jquery after ready", function(done) {
		request({
			method: 'GET',
			url: host + ':' + port + '/basic2.html'
		}, function(err, res, body) {
			expect(res.statusCode).to.be(200);
			expect(body.indexOf('toto')).to.be.greaterThan(0);
			done();
		});
	});

	it("should change body by external jquery and xhr after ready", function(done) {
		request({
			method: 'GET',
			url: host + ':' + port + '/basic3.html'
		}, function(err, res, body) {
			expect(res.statusCode).to.be(200);
			expect(body.indexOf('tarte')).to.be.greaterThan(0);
			done();
		});
	});


});

