const assert = require('node:assert').strict;
const { once } = require('node:events');
const { request } = require('undici');
const express = require('express');

const dom = require('..');

dom.defaults.timeout = 10000;
dom.defaults.console = true;

dom.debug = require('node:inspector').url() !== undefined;

describe("Idle tracker waits for", function() {
	this.timeout(0);
	let server, host;

	before(async () => {
		const app = express();
		app.set('views', __dirname + '/public');
		const staticMw = express.static(app.get('views'));
		app.get(/\.(json|js|css|png)$/, (req, res, next) => {
			if (req.query.delay) {
				setTimeout(next, parseInt(req.query.delay));
				delete req.query.delay;
			} else {
				next();
			}
		}, staticMw);

		app.get('/remote', dom((loc, opts, req) => {
			if (req.query.url) {
				loc.href = req.query.url;
			}
		}));
		app.get('/plugin-status.html', dom((opts, req, res) => {
			if (req.query.status) {
				res.status(parseInt(req.query.status));
			}
		}), staticMw);

		app.get(/\.html$/, dom(), staticMw);

		server = app.listen();
		await once(server, 'listening');
		host = `http://localhost:${server.address().port}`;
	});

	after(async () => {
		server.close();
		await dom.destroy();
	});


	it("DOMContentLoaded in inline script", async () => {
		const { statusCode, body } = await request(`${host}/basic-inline.html`);
		assert.equal(statusCode, 200);
		assert.match(await body.text(), /tutu/);
	});

	it("Promise.resolve in inline script", async () => {
		const { statusCode, body } = await request(`${host}/basic-resolve.html`);
		assert.equal(statusCode, 200);
		assert.match(await body.text(), /tutu/);
	});

	it("new Promise in inline script", async () => {
		const { statusCode, body } = await request(`${host}/basic-promise.html`);
		assert.equal(statusCode, 200);
		assert.match(await body.text(), /tutu/);
	});

	it("sync script", async () => {
		// race conditions are tricky, let's run this many times
		for (let i = 0; i < 10; i++) {
			const { statusCode, body } = await request(`${host}/script.html`);
			assert.equal(statusCode, 200);
			assert.match(await body.text(), /tutu/);
		}
	});

	it("async script", async () => {
		// race conditions are tricky, let's run this many times
		for (let i = 0; i < 10; i++) {
			const { statusCode, body } = await request(`${host}/script-async.html`);
			assert.equal(statusCode, 200);
			assert.match(await body.text(), /tutu/);
		}
	});

	it("script in data uri", async () => {
		// race conditions are tricky, let's run this many times
		for (let i = 0; i < 10; i++) {
			const { statusCode, body } = await request(`${host}/script-data.html`);
			assert.equal(statusCode, 200);
			assert.match(await body.text(), /tutu/);
		}
	});

	it("xhr to be complete", async () => {
		const { statusCode, body } = await request(`${host}/basic-xhr.html`);
		assert.equal(statusCode, 200);
		assert.match(await body.text(), /tarte/);
	});

	it("fetch to be complete", async () => {
		for (let i = 0; i < 10; i++) {
			const { statusCode, body } = await request(`${host}/basic-fetch.html`);
			assert.equal(statusCode, 200);
			assert.match(await body.text(), /tarte/);
		}
	});

	it("async script with await", async () => {
		const { statusCode, body } = await request(`${host}/script-await.html`);
		assert.equal(statusCode, 200);
		assert.match(await body.text(), /tutu/);
	});

});

