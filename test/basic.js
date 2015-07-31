var expect = require('expect.js');
var request = require('request');
var express = require('express');

var host = "http://localhost";

describe("Basic handler", function suite() {
	this.timeout(10000);
	var app, port = 7799;

	before(function(done) {
		app = express();
		var dom = require('../');
		dom.settings.stall = 5000;
		dom.settings.allow = 'all';
		dom.settings.timeout = 10000;
		app.set('statics', __dirname + '/public');
		app.get('/basic1', dom('basic1'));
		app.listen(port);
		done();
	});

	it("should change body by script run after DOMContentLoaded event in user phase", function(done) {
		request({
			method: 'GET',
			url: host + ':' + port + '/basic1'
		}, function(err, res, body) {
			expect(res.statusCode).to.be(200);
			expect(body.indexOf('toto')).to.be.greaterThan(0);
			done();
		});
	});

});

