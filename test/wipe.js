const expect = require('expect.js');
const request = require('request');
const express = require('express');

const host = "http://localhost";
const dom = require('../');
dom.settings.stall = 5000;
dom.settings.allow = 'all';
dom.settings.timeout = 10000;
dom.settings.console = true;
dom.pool.idleTimeout = 200;
dom.pool.destroyTimeout = 1000;

describe("Released instances", function suite() {
	this.timeout(10000);
	let server, port;

	before((done) => {
		const app = express();
		app.set('views', __dirname + '/public');
		app.get(/\/json\/c0-(\d+)\.json$/, (req, res) => {
			const obj = {};
			obj[req.params[0]] = "c0-" + req.params[0];
			res.send(obj);
		});
		app.get(/\.(json|js|css|png)$/, express.static(app.get('views')));
		app.get(/\.html$/, dom().load());


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

	it("should be destroyed after destroyTimeout - single pool", (done) => {
		request({
			method: 'GET',
			url: host + ':' + port + '/a0.html'
		}, (err, res, body) => {
			expect(res.statusCode).to.be(200);
			expect(body.indexOf('toto')).to.be.greaterThan(0);
			const pool = dom.pool.instance;
			setTimeout(() => {
				expect(pool.lists[0].length).to.be(0);
				done();
			}, pool.idleTimeout + pool.destroyTimeout + pool.wipeTimeout);
		});
	});

	it("should be destroyed after destroyTimeout - both pools", (done) => {
		request({
			method: 'GET',
			url: host + ':' + port + '/sub.html'
		}, (err, res, body) => {
			expect(res.statusCode).to.be(200);
			expect(body.indexOf('div class="load">true</div>')).to.be.greaterThan(0);
			const pool = dom.pool.instance;
			setTimeout(() => {
				expect(pool.lists[0].length).to.be(0);
				expect(pool.lists[1].length).to.be(0);
				done();
			}, pool.idleTimeout + pool.destroyTimeout + pool.wipeTimeout);
		});
	});

});

