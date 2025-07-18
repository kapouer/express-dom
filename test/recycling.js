const assert = require('node:assert').strict;
const { once } = require('node:events');
const { request } = require('undici');
const express = require('express');
const cookie = require('cookie');

const dom = require('..');

dom.debug = require('node:inspector').url() !== undefined;

let server, origin;

describe("Recycling", function() {
	this.timeout(0);

	before(async () => {
		const app = express();
		const staticMw = express.static(__dirname + '/public');

		app.use((req, res, next) => {
			req.cookies = cookie.parse(req.get('cookie') ?? "");
			next();
		});
		app.get('/protected.json', (req, res, next) => {
			res.send(req.cookies);
		});

		app.get(/\.(json|js|css|png)$/, staticMw);

		app.get(/\.html$/, dom({
			pool: {
				minIdle: 0,
				min:0,
				max: 1
			},
			timeout: 1000,
			log: true,
			online: { cookies: new Set(['cookie1', 'cookie2']) }
		}).route((phase, req) => {
			phase.settings.browser = req.query.browser ?? "chrome";
		}), (err, req, res, next) => {
			if (err) console.error(err);
			else next();
		}, staticMw);

		server = app.listen();
		await once(server, 'listening');
		origin = `http://localhost:${server.address().port}`;
	});

	after(async () => {
		server.close();
		await dom.destroy();
	});

	it("sets cookie for inner request with chrome", async () => {
		const { statusCode, body } = await request(`${origin}/cookies.html`, {
			headers: {
				cookie: 'cookie1=1;cookie3=3;cookie2=2'
			}
		});
		assert.equal(statusCode, 200);
		const text = await body.text();
		assert.match(text, /cookie1/);
		assert.match(text, /cookie2/);
	});

	it("does not leak cookies with chrome", async () => {
		const { body } = await request(`${origin}/cookies.html`, {
			headers: {
				cookie: 'cookie1=1a'
			}
		});
		const text = await body.text();
		assert.match(text, /cookie1/);

		const { body: body2 } = await request(`${origin}/cookies.html`, {
			headers: {
				cookie: 'cookie2=2a'
			}
		});
		const text2 = await body2.text();
		assert.doesNotMatch(text2, /cookie1/);
		assert.match(text2, /cookie2/);
	});

	it("sets cookie for inner request with firefox", async () => {
		const { statusCode, body } = await request(`${origin}/cookies.html?browser=firefox`, {
			headers: {
				cookie: 'cookie1=1;cookie3=3;cookie2=2'
			}
		});
		assert.equal(statusCode, 200);
		const text = await body.text();
		assert.match(text, /cookie1/);
		assert.match(text, /cookie2/);
	});

	it("does not leak cookies with firefox", async () => {
		const { body } = await request(`${origin}/cookies.html?browser=firefox`, {
			headers: {
				cookie: 'cookie1=1a'
			}
		});
		const text = await body.text();
		assert.match(text, /cookie1/);

		const { body: body2 } = await request(`${origin}/cookies.html`, {
			headers: {
				cookie: 'cookie2=2a'
			}
		});
		const text2 = await body2.text();
		assert.doesNotMatch(text2, /cookie1/);
		assert.match(text2, /cookie2/);
	});

});

