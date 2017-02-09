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
dom.settings.helpers.push(dom.helpers.develop);
dom.pool.max = 4;

describe("Prepare and load", function suite() {
	var server, port;

	before(function(done) {
		var app = express();
		app.set('views', __dirname + '/public');

		app.get(/\.(json|js|css|png)$/, express.static(app.get('views')));
		var count = 0;
		app.get(/\.html$/, dom().prepare(function(page, settings, request, response) {
			page.when('ready', function() {
				return page.run(function(settings) {
					document.body.setAttribute('data-views', settings.views);
				}, request.app.settings);
			});
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


	it("should prepare and load a page", function(done) {
		request({
			method: 'GET',
			url: host + ':' + port + '/develop.html'
		}, function(err, res, body) {
			expect(res.statusCode).to.be(200);
			expect(body.indexOf('/public</body>')).to.be.greaterThan(0);
			expect(body.indexOf('toto')).to.be(-1);
			done();
		});
	});

	it("should prepare and not load a page", function(done) {
		request({
			method: 'GET',
			url: host + ':' + port + '/develop.html?develop'
		}, function(err, res, body) {
			expect(res.statusCode).to.be(200);
			expect(body.indexOf('data-views="')).to.be.greaterThan(0);
			expect(body.indexOf('toto')).to.be.greaterThan(0);
			done();
		});
	});

});

