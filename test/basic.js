const assert = require('node:assert').strict;
const { once } = require('node:events');
const { request } = require('undici');
const express = require('express');

const dom = require('../');

dom.settings.stall = 5000;
dom.settings.allow = 'all';
dom.settings.timeout = 10000;
dom.settings.console = true;

describe("Basic functionnalities", function suite() {
	this.timeout(0);
	let server, host;

	before(async () => {
		const app = express();
		app.set('views', __dirname + '/public');
		app.get(/\.(json|js|css|png)$/, (req, res, next) => {
			if (req.query.delay) setTimeout(next, parseInt(req.query.delay));
			else next();
		}, express.static(app.get('views')));
		app.get(/\.html$/, dom().load());

		server = app.listen();
		await once(server, 'listening');
		host = `http://localhost:${server.address().port}`;
	});

	after(async () => {
		server.close();
		await dom.destroy();
	});



	// Basic a0
	it("should load a simple Html page", async () => {
		const { statusCode, body } = await request(`${host}/a0.html`);
		assert.equal(statusCode, 200);
		assert.match(await body.text(), /toto/);
	});

	// Basic a1
	it("should let script change dom after DOMContentLoaded", async () => {
		const { statusCode, body } = await request(`${host}/a1.html`);
		assert.equal(statusCode, 200);
		assert.match(await body.text(), /tutu/);
	});

	it("should change body by fetch", async () => {
		const { statusCode, body } = await request(`${host}/a4.html`);
		assert.equal(statusCode, 200);
		assert.match(await body.text(), /tarte/);
	});

	// // Basic a2
	// it("should change body by external jquery.js (after ready)", (done) => {
	// 	request({
	// 		method: 'GET',
	// 		url: host + ':' + port + '/a2.html'
	// 	}, (err, res, body) => {
	// 		expect(res.statusCode).to.be(200);
	// 		expect(body.indexOf('toto')).to.be.greaterThan(0);
	// 		done();
	// 	});
	// });

	// // Basic a3
	// it("should change body by external jquery.js load from distant server (after ready)", (done) => {
	// 	request({
	// 		method: 'GET',
	// 		url: host + ':' + port + '/a3.html'
	// 	}, (err, res, body) => {
	// 		expect(res.statusCode).to.be(200);
	// 		expect(body.indexOf('toto')).to.be.greaterThan(0);
	// 		done();
	// 	});
	// });




	// it("should redirect because client script sets document.location", (done) => {
	// 	request({
	// 		method: 'GET',
	// 		url: host + ':' + port + '/a5.html',
	// 		followRedirect: false
	// 	}, (err, res, body) => {
	// 		expect(res.statusCode).to.be(302);
	// 		expect(res.headers.location).to.be(host + ':' + port + '/newloc.html');
	// 		done();
	// 	});
	// });


});

