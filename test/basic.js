const assert = require('node:assert').strict;
const { once } = require('node:events');
const { request } = require('undici');
const express = require('express');

const dom = require('../');

dom.settings.stall = 5000;
dom.settings.timeout = 10000;
dom.settings.console = true;

describe("Basic functionnalities", function() {
	this.timeout(0);
	let server, host;

	before(async () => {
		const app = express();
		app.set('views', __dirname + '/public');
		app.get(/\.(json|js|css|png)$/, (req, res, next) => {
			if (req.query.delay) {
				setTimeout(next, parseInt(req.query.delay));
				delete req.query.delay;
			} else {
				next();
			}
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



	it("loads a simple Html page", async () => {
		const { statusCode, body } = await request(`${host}/basic-html.html`);
		assert.equal(statusCode, 200);
		assert.match(await body.text(), /toto/);
	});

	it("changes DOM using inline script", async () => {
		const { statusCode, body } = await request(`${host}/basic-inline.html`);
		assert.equal(statusCode, 200);
		assert.match(await body.text(), /tutu/);
	});

	it("changes DOM using inline Promise.resolve", async () => {
		const { statusCode, body } = await request(`${host}/basic-resolve.html`);
		assert.equal(statusCode, 200);
		assert.match(await body.text(), /tutu/);
	});

	it("changes DOM using inline new Promise", async () => {
		const { statusCode, body } = await request(`${host}/basic-promise.html`);
		assert.equal(statusCode, 200);
		assert.match(await body.text(), /tutu/);
	});

	it("changes DOM using script", async () => {
		// race conditions are tricky, let's run this many times
		for (let i = 0; i < 10; i++) {
			const { statusCode, body } = await request(`${host}/basic-script.html`);
			assert.equal(statusCode, 200);
			assert.match(await body.text(), /tutu/);
		}
	});

	it("changes DOM using async script", async () => {
		// race conditions are tricky, let's run this many times
		for (let i = 0; i < 10; i++) {
			const { statusCode, body } = await request(`${host}/basic-script-async.html`);
			assert.equal(statusCode, 200);
			assert.match(await body.text(), /tutu/);
		}
	});

	it("changes DOM using data script", async () => {
		// race conditions are tricky, let's run this many times
		for (let i = 0; i < 10; i++) {
			const { statusCode, body } = await request(`${host}/basic-script-data.html`);
			assert.equal(statusCode, 200);
			assert.match(await body.text(), /tutu/);
		}
	});

	it("changes DOM using data loaded by xhr", async () => {
		const { statusCode, body } = await request(`${host}/basic-xhr.html`);
		assert.equal(statusCode, 200);
		assert.match(await body.text(), /tarte/);
	});

	it("changes DOM using data loaded by fetch", async () => {
		for (let i = 0; i < 10; i++) {
			const { statusCode, body } = await request(`${host}/basic-fetch.html`);
			assert.equal(statusCode, 200);
			assert.match(await body.text(), /tarte/);
		}
	});

	it("redirects using navigation", async () => {
		const {
			statusCode,
			headers: { location }
		} = await request(`${host}/basic-redirect.html`);
		assert.equal(statusCode, 302);
		assert.equal(location, `${host}/basic-redirect-loc.html`);
	});

});

