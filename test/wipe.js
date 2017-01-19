var expect = require('expect.js');
var request = require('request');
var express = require('express');

var host = "http://localhost";
var dom = require('../');
dom.settings.stall = 5000;
dom.settings.allow = 'all';
dom.settings.timeout = 10000;
dom.settings.console = true;
dom.pool.idleTimeout = 200;
dom.pool.destroyTimeout = 1000;

describe("Released instances", function suite() {
	this.timeout(10000);
	var server, port;

	before(function(done) {
		var app = express();
		app.set('views', __dirname + '/public');
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

	it("should be destroyed after destroyTimeout", function(done) {
		request({
			method: 'GET',
			url: host + ':' + port + '/a0.html'
		}, function(err, res, body) {
			expect(res.statusCode).to.be(200);
			expect(body.indexOf('toto')).to.be.greaterThan(0);
			var pool = dom.pool.instance;
			setTimeout(function() {
				expect(pool.lists[0].length).to.be(0);
				done();
			}, pool.idleTimeout + pool.destroyTimeout + pool.wipeTimeout);
		});
	});

});

