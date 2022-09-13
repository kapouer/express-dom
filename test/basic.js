const assert = require('node:assert').strict;
const { once } = require('node:events');
const { request } = require('undici');
const express = require('express');

const dom = require('../');

dom.defaults.timeout = 10000;
dom.defaults.log = true;

dom.debug = require('node:inspector').url() !== undefined;

describe("Basic functionnalities", function() {
	this.timeout(0);
	let server, host;
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
		app.get('/plugin-status.html', (req, res, next) => {
			if (req.query.status) {
				res.status(parseInt(req.query.status));
			}
			next('route');
		});
		app.get('/scaled.html', dom({
			online: { scale: 4 }
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

		app.get(/\.html$/, dom(), (err, req, res, next) => {
			if (err) console.error(err);
			else next();
		}, staticMw);

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

	it("loads a simple UTF8 Html page", async () => {
		const { statusCode, body } = await request(`${host}/basic-utf8.html`);
		assert.equal(statusCode, 200);
		assert.match(await body.text(), /modifié/);
	});

	it("should load html from a url", async () => {
		const { statusCode, body } = await request(`${host}/remote?url=` + encodeURIComponent(`${host}/plugin-status.html`));

		assert.equal(statusCode, 200);
		assert.match(await body.text(), /OuiOui/);
	});

	it("should load html from a url that sets status", async () => {
		const { statusCode, body } = await request(`${host}/remote?url=` + encodeURIComponent(`${host}/plugin-status.html?status=403`));

		assert.equal(statusCode, 403);
		assert.match(await body.text(), /OuiOui/);
	});

	it("loads a simple Html page and not its stylesheet", async () => {
		const { statusCode, body } = await request(`${host}/basic-style.html`);
		assert.equal(statusCode, 200);
		assert.ok(!requests.has('/css/style.css'));
		assert.match(await body.text(), /toto/);
	});

	it("loads an offline page and not its inline script", async () => {
		const { statusCode, body } = await request(`${host}/basic-offline.html`);
		assert.equal(statusCode, 200);
		assert.match(await body.text(), /tata/);
	});

	it("redirects using navigation", async () => {
		const {
			statusCode,
			headers: { location }
		} = await request(`${host}/basic-redirect.html`);
		assert.equal(statusCode, 302);
		assert.equal(location, `${host}/basic-redirect-loc.html`);
	});

	it("changes window.devicePixelRatio using settings.scale", async () => {
		const { statusCode, body } = await request(`${host}/scaled.html`);
		assert.equal(statusCode, 200);
		assert.match(await body.text(), />4</);
	});

});

