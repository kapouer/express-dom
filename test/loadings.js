var expect = require('expect.js');
var request = require('request');
var express = require('express');

var host = "http://localhost";
var dom = require('../');
dom.settings.stall = 900000;
dom.settings.allow = 'all';
dom.settings.timeout = 900000;
dom.settings.stallTimeout = 200; // the value used in the tests
dom.settings.console = true;
dom.settings.pool.max = 8;

describe("Loading ressources", function suite() {
	var server, port;

	before(function(done) {
		var app = express();
		app.set('views', __dirname + '/public');
		var countJSON = 0;
		app.get(/\/json\/c0-(\d+)\.json$/, function(req, res, next) {
			var obj = {};
			obj[req.params[0]] = "c0-" + req.params[0];
			res.send(obj);
		});
		app.get(/\.(json|js|css|png)$/, express.static(app.get('views')));
		var count = 0;
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



// Loading c0
//	it("should load 100 json ressources after $().ready", function(done) {
//		request({
//			method: 'GET',
//			url: host + ':' + port + '/c0.html'
//		}, function(err, res, body) {
//			expect(res.statusCode).to.be(200);
//			for (var i = 0 ; i < 100 ; i++) {
//				expect(body.indexOf('c0-'+i)).to.be.greaterThan(0);
//			}
//			done();
//		});
//	});


// Loading c1
	it("should load several pages (more than settings.max) in the same time", function(done) {
		this.timeout(100000);
		var count = 0;
		var counts = {};
		var received = {};
		function countDone(from, counter) {
			count--;
//			if (!counts[from]) counts[from] = 0;
//			counts[from]++;
//			console.log(count, counts);
			if (!count) done();
//			if (!received[from]) received[from] = [];
//			received[from].push(counter);
//			received[from].sort();
//			if (count < 4) console.log(received);
		}
		function batch(i) {
			count++;
			request({
				method: 'GET',
				url: host + ':' + port + '/c0.html' + '?' + i
			}, function(err, res, body) {
				if (err) console.error(err);
				expect(res.statusCode).to.be(200);
				for (var j = 0 ; j < 100 ; j++) {
					expect(body.indexOf('c0-'+j)).to.be.greaterThan(0);
				}
				countDone('c0', i);
			});
			count++;
			request({
				method: 'GET',
				url: host + ':' + port + '/a2.html' + '?' + i
			}, function(err, res, body) {
				expect(res.statusCode).to.be(200);
				expect(body.indexOf('toto')).to.be.greaterThan(0);
				countDone('a2', i);
			});
			count++;
			request({
				method: 'GET',
				url: host + ':' + port + '/b0.html' + '?' + i
			}, function(err, res, body) {
				expect(res.statusCode).to.be(200);
				expect(body.indexOf('tata')).to.be.greaterThan(0);
				expect(body.indexOf('titi')).to.be.greaterThan(0);
				countDone('b0', i);
			});
			count++;
			request({
				method: 'GET',
				url: host + ':' + port + '/b1.html' + '?' + i
			}, function(err, res, body) {
				expect(body.indexOf('tata')).to.be.greaterThan(0);
				expect(body.indexOf('titi')).to.be.greaterThan(0);
				countDone('b1', i);
			});
			count++;
			request({
				method: 'GET',
				url: host + ':' + port + '/a0.html' + '?' + i
			}, function(err, res, body) {
				expect(res.statusCode).to.be(200);
				expect(body.indexOf('toto')).to.be.greaterThan(0);
				countDone('a0', i);
			});
			count++;
			request({
				method: 'GET',
				url: host + ':' + port + '/a4.html' + '?' + i
			}, function(err, res, body) {
				expect(res.statusCode).to.be(200);
				expect(body.indexOf('tarte')).to.be.greaterThan(0);
				countDone('a4', i);
			});
		}
		var i=0;
		while (i++ < 10) batch(i);

	});


});

