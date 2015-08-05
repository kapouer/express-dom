var expect = require('expect.js');
var request = require('request');
var express = require('express');

var host = "http://localhost";
var dom = require('../');
dom.settings.stall = 5000;
dom.settings.allow = 'all';
dom.settings.timeout = 10000;
dom.settings.console = true;

describe("Basic functionnalities", function suite() {
	this.timeout(3000);
	var server, port;

	before(function(done) {
		var app = express();
		app.set('statics', __dirname + '/public');
		app.get(/\.(json|js|css|png)$/, express.static(app.get('statics')));
		app.get(/\.html$/, function(req, res, next) {
			dom(req.path.substring(1))(req, res, next);
		});


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



// Basic a0
	it("should load a simple Html page", function(done) {
		request({
			method: 'GET',
			url: host + ':' + port + '/a0.html'
		}, function(err, res, body) {
			expect(res.statusCode).to.be(200);
			expect(body.indexOf('toto')).to.be.greaterThan(0);
			done();
		});
	});

// Basic a1
	it("should change body by script run after DOMContentLoaded event in user phase", function(done) {
		request({
			method: 'GET',
			url: host + ':' + port + '/a1.html'
		}, function(err, res, body) {
			expect(res.statusCode).to.be(200);
			expect(body.indexOf('toto')).to.be.greaterThan(0);
			done();
		});
	});

// Basic a2
	it("should change body by external jquery.js (after ready)", function(done) {
		request({
			method: 'GET',
			url: host + ':' + port + '/a2.html'
		}, function(err, res, body) {
			expect(res.statusCode).to.be(200);
			expect(body.indexOf('toto')).to.be.greaterThan(0);
			done();
		});
	});

// Basic a3
	it("should change body by external jquery.js load from distant server (after ready)", function(done) {
		request({
			method: 'GET',
			url: host + ':' + port + '/a3.html'
		}, function(err, res, body) {
			expect(res.statusCode).to.be(200);
			expect(body.indexOf('toto')).to.be.greaterThan(0);
			done();
		});
	});

// Basic a4
	it("should change body by xhr after ready (and external jquery)", function(done) {
		request({
			method: 'GET',
			url: host + ':' + port + '/a4.html'
		}, function(err, res, body) {
			expect(res.statusCode).to.be(200);
			expect(body.indexOf('tarte')).to.be.greaterThan(0);
			done();
		});
	});


});

