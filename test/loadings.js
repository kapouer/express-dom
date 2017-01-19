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
dom.pool.max = 4;

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


	it("should load several pages (more than pool.max) at the same time", function(done) {
		this.timeout(10000);
		var count = 0;
		var counts = {};
		var received = {};
		function countDone(from, counter) {
			count--;
			if (!count) done();
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

	it("should load > pool.max pages that load sub-pages without being deadlocked", function(done) {
		this.timeout(10000);
		var count = 0;
		var counts = {};
		var received = {};
		function countDone(from, counter) {
			count--;
			if (!count) done();
		}
		function batch(i) {
			count++;
			request({
				method: 'GET',
				url: host + ':' + port + '/sub.html' + '?' + i
			}, function(err, res, body) {
				if (err) console.error(err);
				expect(res.statusCode).to.be(200);
				expect(body.indexOf('div class="load">true</div>')).to.be.greaterThan(0);
				countDone('c0', i);
			});
		}
		var i=0;
		// at the limit: there's one missing instance
		while (i++ < 3 * dom.pool.max) setTimeout(batch.bind(null, i));
	});

});

