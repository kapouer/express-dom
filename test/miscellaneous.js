const expect = require('expect.js');
const request = require('request');
const express = require('express');

const host = "http://localhost";
const dom = require('../');
dom.settings.stall = 5000;
dom.settings.allow = 'all';
dom.settings.timeout = 10000;
dom.settings.console = true;

describe("Miscellaneous tries", function suite() {
	this.timeout(3000);
	let server, port;

	before((done) => {
		const app = express();
		app.set('views', __dirname + '/public');

		app.get('/d0.js', (req, res, next) => {
			res.end('$(function() {$(".shouldbemodified").text("éè");});');
		});

		app.get(/\.(json|js|css|png)$/, express.static(app.get('views')));
		app.get(/\.html$/, dom().load((p, s, request) => {
			s['default-charset'] = request.headers['accept-charset'];
		}));

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



	// Miscellaneous d0
	it("should understand string as utf8 (default)", (done) => {
		request({
			method: 'GET',
			url: host + ':' + port + '/d0.html'
		}, (err, res, body) => {
			expect(body.indexOf('éè')).to.be.greaterThan(0);
			done();
		});
	});

	// Miscellaneous d1
	it("should understand string as iso-8859-1 when charset set accordingly", (done) => {
		request({
			method: 'GET',
			url: host + ':' + port + '/d0.html',
			headers: {
				"Accept-Charset": "iso-8859-1"
			}
		}, (err, res, body) => {
			expect(body.indexOf('Ã©Ã¨')).to.be.greaterThan(0);
			done();
		});
	});
});

