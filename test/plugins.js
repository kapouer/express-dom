const assert = require('node:assert').strict;
const { once } = require('node:events');
const { request } = require('undici');
const express = require('express');

const dom = require('../');

dom.settings.timeout = 10000;
dom.settings.console = true;
dom.settings.load.cookies.add('mycookiename');

dom.settings.debug = require('node:inspector').url() !== undefined;

describe("Plugins", function() {
	this.timeout(0);
	let server, host;

	before(async () => {
		const app = express();
		app.set('views', __dirname + '/public');
		app.use((req, res, next) => {
			const header = req.get('cookie');
			req.cookies = header ? Object.fromEntries( // poor man's cookie parser
				header.split(';').map(str => str.split('='))
			) : {};
			next();
		});
		app.get('/protected.json', (req, res, next) => {
			if (req.cookies.anothercookie) {
				res.sendStatus(403);
			} else if (req.cookies.mycookiename == '1') {
				res.send({ protected: 'mycookievalue' });
			} else {
				res.sendStatus(401);
			}
		});
		app.get(/\.(json|js|css|png)$/, (req, res, next) => {
			if (req.query.delay) {
				setTimeout(next, parseInt(req.query.delay));
				delete req.query.delay;
			} else {
				next();
			}
		}, express.static(app.get('views')));

		app.get('/plugin-status.html', dom().load({ plugins: ['equivs'] }));
		app.get('/plugin-preload.html', dom().load({ plugins: ['preloads'] }));
		app.get('/plugin-cookie.html', dom().load());

		app.get(/\.html$/, dom().load());

		server = app.listen();
		await once(server, 'listening');
		host = `http://localhost:${server.address().port}`;
	});

	after(async () => {
		server.close();
		await dom.destroy();
	});



	it("equivs should change status code", async () => {
		const { statusCode, body } = await request(`${host}/plugin-status.html`);
		assert.equal(statusCode, 401);
		assert.match(await body.text(), /OuiOui/);
	});

	it("preloads should set Link response header", async () => {
		const { statusCode, headers } = await request(`${host}/plugin-preload.html`);
		assert.equal(statusCode, 200);
		assert.equal(headers.link, "</css/style.css>;rel=preload;as=style,</js/extern.js>;rel=preload;as=script");
	});

	it("sets cookie for inner request", async () => {
		const { statusCode, body } = await request(`${host}/plugin-cookie.html`, {
			headers: {
				cookie: 'mycookiename=1;anothercookie=2'
			}
		});
		assert.equal(statusCode, 200);
		assert.match(await body.text(), /mycookievalue/);
	});
});
