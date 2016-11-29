var expect = require('expect.js');
var request = require('request');
var express = require('express');

var host = "http://localhost";
var dom = require('../');
dom.settings.stall = 5000;
dom.settings.allow = 'all';
dom.settings.timeout = 10000;
dom.settings.console = true;

describe("Load from multiple views", function suite() {
	this.timeout(3000);
	var server, port;

	before(function(done) {
		var app = express();
		app.set('views', [__dirname + '/public', __dirname + '/alt']);
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



// Basic a0
	it("should load html page from public dir", function(done) {
		request({
			method: 'GET',
			url: host + ':' + port + '/a0.html'
		}, function(err, res, body) {
			expect(res.statusCode).to.be(200);
			expect(body.indexOf('toto')).to.be.greaterThan(0);
			done();
		});
	});

// Basic alt/index
	it("should alt html page from alt dir", function(done) {
		request({
			method: 'GET',
			url: host + ':' + port + '/alt.html'
		}, function(err, res, body) {
			expect(res.statusCode).to.be(200);
			expect(body.indexOf('tota')).to.be.greaterThan(0);
			done();
		});
	});

});

