const assert = require('node:assert').strict;
const { once } = require('node:events');
const { promises: fs } = require('node:fs');
const { request } = require('undici');
const express = require('express');

const dom = require('../');

dom.defaults.timeout = 10000;
dom.defaults.log = true;

dom.debug = require('node:inspector').url() !== undefined;

let server, host, origin;

describe("Basic functionnalities", function() {
	this.timeout(0);

	const requests = new Set();

	before(async () => {
		const app = express();
		const staticMw = express.static(__dirname + '/public');

		app.get(/\.(json|js|css|png)$/, (req, res, next) => {
			requests.add(req.path);
			if (req.query.delay) {
				setTimeout(next, parseInt(req.query.delay));
				delete req.query.delay;
			} else {
				next();
			}
		}, staticMw);

		app.get('/remote', dom().route(({ location }, req) => {
			if (req.query.url) {
				location.href = req.query.url;
			}
		}));
		app.get('/partial', async (req, res) => {
			req.url = '/basic-manual.html';
			try {
				const ret = await dom()(req);
				for (const header in ret.headers) {
					res.setHeader(header, ret.headers[header]);
				}
				res.status(ret.statusCode);
				res.send(ret.body);
			} catch (ex) {
				console.error(ex);
			}
		});
		app.get('/plugin-status.html', (req, res, next) => {
			if (req.query.status) {
				res.status(parseInt(req.query.status));
			}
			next('route');
		});
		app.get('/scaled.html', dom({
			online: { devicePixelRatio: 4 }
		}), (req, res, next) => {
			res.send(`<!DOCTYPE html><html>
			<body onload="document.body.innerHTML = window.devicePixelRatio">0</body>
			</html>`);
		});

		app.get('/basic-offline.html', dom({
			online: { enabled: false },
			offline: { enabled: true }
		}).route(({ location }) => {
			location.pathname = '/basic-inline.html';
		}), staticMw);

		app.get('/basic-manual.html', staticMw);

		app.get(/\.html$/, dom(), (err, req, res, next) => {
			if (err) console.error(err);
			else next();
		}, staticMw);

		server = app.listen();
		await once(server, 'listening');
		origin = `http://localhost:${server.address().port}`;
		host = `localhost:${server.address().port}`;
	});

	after(async () => {
		server.close();
		await dom.destroy();
	});



	it("prerender a simple Html page, being hidden", async () => {
		const { statusCode, body } = await request(`${origin}/basic-html.html`);
		assert.equal(statusCode, 200);
		const html = await body.text();
		assert.match(html, /\btoto\b/);
		assert.match(html, /\bhidden\b/);
	});

	it("loads a simple Html page using manual response", async () => {
		const { statusCode, body } = await request(`${origin}/partial`);
		assert.equal(statusCode, 200);
		assert.match(await body.text(), /toto/);
	});

	it("render a given Html page using manual request url", async () => {
		const res = await dom()(origin + '/basic-manual.html');
		assert.equal(res.statusCode, 200);
		assert.equal(res.get('Content-Type'), 'text/html');
		assert.match(res.body, /toto/);
	});

	it("render a given Html page using manual request body", async () => {
		const res = await dom()({
			headers: { host },
			protocol: 'http',
			url: '/fullmanual',
			body: await fs.readFile(__dirname + '/public/basic-html.html')
		});
		assert.equal(res.req, undefined);
		assert.equal(res.statusCode, 200);
		assert.equal(res.get('Content-Type'), 'text/html');
		assert.match(res.body, /toto/);
	});

	it("loads a simple UTF8 Html page", async () => {
		const { statusCode, body } = await request(`${origin}/basic-utf8.html`);
		assert.equal(statusCode, 200);
		assert.match(await body.text(), /modifié/);
	});

	it("should load html from a url", async () => {
		const { statusCode, body } = await request(`${origin}/remote?url=` + encodeURIComponent(`${origin}/plugin-status.html`));

		assert.equal(statusCode, 200);
		assert.match(await body.text(), /OuiOui/);
	});

	it("should load html from a url that sets status", async () => {
		const { statusCode, body } = await request(`${origin}/remote?url=` + encodeURIComponent(`${origin}/plugin-status.html?status=403`));

		assert.equal(statusCode, 403);
		assert.match(await body.text(), /OuiOui/);
	});

	it("loads a simple Html page and not its stylesheet", async () => {
		const { statusCode, body } = await request(`${origin}/basic-style.html`);
		assert.equal(statusCode, 200);
		assert.ok(!requests.has('/css/style.css'));
		assert.match(await body.text(), /toto/);
	});

	it("loads an offline page and not its inline script", async () => {
		const { statusCode, body } = await request(`${origin}/basic-offline.html`);
		assert.equal(statusCode, 200);
		assert.match(await body.text(), /tata/);
	});

	it("redirects using navigation", async () => {
		const {
			statusCode,
			headers: { location }
		} = await request(`${origin}/basic-redirect.html`);
		assert.equal(statusCode, 302);
		assert.equal(location, `${origin}/basic-redirect-loc.html`);
	});

	it("changes window.devicePixelRatio", async () => {
		const { statusCode, body } = await request(`${origin}/scaled.html`);
		assert.equal(statusCode, 200);
		assert.match(await body.text(), />4</);
	});

	it("loads a page with query", async () => {
		const { statusCode, body } = await request(`${origin}/basic-query.html?data=[test.enc]`);
		assert.equal(statusCode, 200);
		assert.match(await body.text(), /\[test.enc\]/);
	});

});

