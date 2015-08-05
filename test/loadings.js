var expect = require('expect.js');
var request = require('request');
var express = require('express');

var host = "http://localhost";
var dom = require('../');
dom.settings.stall = 5000;
dom.settings.allow = 'all';
dom.settings.timeout = 10000;
dom.settings.console = true;
dom.settings.max = 2;


describe("Loading ressources", function suite() {
	this.timeout(3000);
	var server, port;

	before(function(done) {
		var app = express();
		app.set('statics', __dirname + '/public');
		app.get(/\/json\/c0-(\d+)\.json$/, function(req, res, next) {
			var obj = {};
			obj[req.params[0]] = "c0-" + req.params[0];
			res.send(obj);
		});
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



// Loading c0
	it("should load 100 json ressources after $().ready", function(done) {
		request({
			method: 'GET',
			url: host + ':' + port + '/c0.html'
		}, function(err, res, body) {
			expect(res.statusCode).to.be(200);
			for (var i = 0 ; i < 100 ; i++) {
				expect(body.indexOf('c0-'+i)).to.be.greaterThan(0);
			}
			done();
		});
	});


// Loading c1
	it("should load several pages (more than settings.max) in the same time", function(done) {
		var count = 0;
		function countDone() {
			count--;
			if (!count) done();
		}
		count++;
		request({
			method: 'GET',
			url: host + ':' + port + '/c0.html'
		}, function(err, res, body) {
			expect(res.statusCode).to.be(200);
			for (var i = 0 ; i < 100 ; i++) {
				expect(body.indexOf('c0-'+i)).to.be.greaterThan(0);
			}
			countDone();
		});
		count++;
		request({
			method: 'GET',
			url: host + ':' + port + '/a3.html'
		}, function(err, res, body) {
			expect(res.statusCode).to.be(200);
			expect(body.indexOf('toto')).to.be.greaterThan(0);
			countDone();
		});
		count++;
		request({
			method: 'GET',
			url: host + ':' + port + '/b0.html'
		}, function(err, res, body) {
			expect(body.indexOf('tata')).to.be.greaterThan(0);
			expect(body.indexOf('titi')).to.be.greaterThan(0);
			countDone();
		});
		count++;
		request({
			method: 'GET',
			url: host + ':' + port + '/b1.html'
		}, function(err, res, body) {
			expect(body.indexOf('tata')).to.be.greaterThan(0);
			expect(body.indexOf('titi')).to.be.greaterThan(0);
			countDone();
		});
		count++;
		request({
			method: 'GET',
			url: host + ':' + port + '/a4.html'
		}, function(err, res, body) {
			expect(res.statusCode).to.be(200);
			expect(body.indexOf('tarte')).to.be.greaterThan(0);
			countDone();
		});
	});


});

