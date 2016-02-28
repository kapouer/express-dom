var expect = require('expect.js');
var request = require('request');
var express = require('express');

var host = "http://localhost";
var dom = require('../');
dom.settings.stall = 1000;
dom.settings.allow = 'all';
dom.settings.timeout = 10000;
dom.settings.stallTimeout = 200; // the value used in the tests
dom.settings.console = true;
dom.settings.verbose = true;

describe("Time management", function suite() {
	this.timeout(10000);
	var server, port;

	before(function(done) {
		var app = express();
		app.set('views', __dirname + '/public');

		app.get('/json/b2-0.json', function(req, res, next) {
			res.type('json');
			setTimeout(function() {
				res.write('{ "toto" : "I ve been modified and I was supposed to" ');
				setTimeout(function() {
					res.write('}');
					res.end();
				}, 200);
			}, 200);
		});

		app.get('/json/b2-1.json', function(req, res, next) {
			res.type('json');
			setTimeout(function() {
				res.write('{ "toto" : "I ve been modified but wasnt supposed to" ');
				setTimeout(function() {
					res.write('}');
					res.end();
				}, 10000);
				// End of file will come too late
			}, 200);
		});

		app.get('/json/b3-0.json', function(req, res, next) {
			res.type('json');
			setTimeout(function() {
				res.send('{ "toto" : "I ve been modified and I was supposed to" }');
			}, 200);
		});

		app.get('/json/b3-1.json', function(req, res, next) {
			res.type('json');
			setTimeout(function() {
				res.send('{ "toto" : "I ve been modified but I wasnt supposed to" }');
			}, 10000);
			// File will come too late
		});


		app.get(/\.(json|js|css|png)$/, express.static(app.get('views')));
		app.get(/\.html$/, dom().load());


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



// Time b0
	it("should trigger ignorance from Express-Dom due to setTimeout > 200", function(done) {
		request({
			method: 'GET',
			url: host + ':' + port + '/b0.html'
		}, function(err, res, body) {
			expect(body.indexOf('tata')).to.be.greaterThan(0);
			expect(body.indexOf('titi')).to.be.greaterThan(0);
			done();
		});
	});

// Time b1
	it("should trigger ignorance from Express-Dom due to setInterval > 200", function(done) {
		request({
			method: 'GET',
			url: host + ':' + port + '/b1.html'
		}, function(err, res, body) {
			expect(body.indexOf('tata')).to.be.greaterThan(0);
			expect(body.indexOf('titi')).to.be.greaterThan(0);
			done();
		});
	});

// Time b2
	it("should trigger ignorance from Express-Dom due to slowly loading parts of a ressource", function(done) {
		request({
			method: 'GET',
			url: host + ':' + port + '/b2.html'
		}, function(err, res, body) {
			expect(body.indexOf('I ve been modified and I was supposed to')).to.be.greaterThan(0);
			expect(body.indexOf('Original file')).to.be.greaterThan(0);
			done();
		});
	});

// Time b2
	it("should trigger ignorance from Express-Dom due to slowly loading ressource", function(done) {
		request({
			method: 'GET',
			url: host + ':' + port + '/b3.html'
		}, function(err, res, body) {
			expect(body.indexOf('I ve been modified and I was supposed to')).to.be.greaterThan(0);
			expect(body.indexOf('Original file')).to.be.greaterThan(0);
			done();
		});
	});


});

