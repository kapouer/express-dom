const expect = require('expect.js');
const request = require('request');
const express = require('express');

const host = "http://localhost";
const dom = require('../');
dom.settings.stall = 5000;
dom.settings.allow = 'all';
dom.settings.timeout = 10000;
dom.settings.console = true;

describe("Remote url loading", function suite() {
	this.timeout(3000);
	let server, port;

	before((done) => {
		const app = express();
		app.set('views', __dirname + '/public');
		app.get(/\.(json|js|css|png)$/, express.static(app.get('views')));
		app.get('/remote', dom((mw, settings, req, res) => {
			if (req.query.url) {
				settings.view = req.query.url;
			}
		}).load());
		app.get('/a1.html', dom((mw, settings, req, res) => {
			if (req.query.status) {
				res.statusCode = parseInt(req.query.status);
			}
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


	it("should load a remote url", (done) => {
		const urlA = host + ':' + port + '/remote';
		const urlB = host + ':' + port + '/a1.html?status=404';
		request({
			method: 'GET',
			url: urlA + '?url=' + encodeURIComponent(urlB)
		}, (err, res, body) => {
			expect(res.statusCode).to.be(404);
			expect(body.indexOf('toto')).to.be.greaterThan(0);
			done();
		});
	});

});

