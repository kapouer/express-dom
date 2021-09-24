const expect = require('expect.js');
const request = require('request');
const express = require('express');

const host = "http://localhost";
const dom = require('../');
dom.settings.stall = 900000;
dom.settings.allow = 'all';
dom.settings.timeout = 900000;
dom.settings.stallTimeout = 200; // the value used in the tests
dom.settings.console = true;
dom.settings.helpers.push(dom.helpers.develop);
dom.pool.max = 4;

describe("Prepare and load", () => {
	let server, port;

	before((done) => {
		const app = express();
		app.set('views', __dirname + '/public');

		app.get(/\.(json|js|css|png)$/, express.static(app.get('views')));
		app.get(/\.html$/, dom().prepare((page, settings, request, response) => {
			page.when('ready', () => {
				return page.run((settings) => {
					document.body.setAttribute('data-views', settings.views);
				}, request.app.settings);
			});
		}).load());


		server = app.listen((err) => {
			if (err) console.error(err);
			port = server.address().port;
			done();
		});
	});

	after((done) => {
		server.close();
		done();
	});


	it("should prepare and load a page", (done) => {
		request({
			method: 'GET',
			url: host + ':' + port + '/develop.html'
		}, (err, res, body) => {
			expect(res.statusCode).to.be(200);
			expect(body.indexOf('/public</body>')).to.be.greaterThan(0);
			expect(body.indexOf('toto')).to.be(-1);
			done();
		});
	});

	it("should prepare and not load a page", (done) => {
		request({
			method: 'GET',
			url: host + ':' + port + '/develop.html?develop'
		}, (err, res, body) => {
			expect(res.statusCode).to.be(200);
			expect(body.indexOf('data-views="')).to.be.greaterThan(0);
			expect(body.indexOf('toto')).to.be.greaterThan(0);
			done();
		});
	});

});

