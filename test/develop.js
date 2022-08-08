const assert = require('node:assert').strict;
const { once } = require('node:events');
const { request } = require('undici');
const express = require('express');

const dom = require('../');
dom.defaults.log = true;
dom.defaults.timeout = 1e8;

describe("Prepare or load depending on header", function() {
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

		dom.plugins.testView = (page, settings, req, res) => {
			page.on('idle', () => {
				return page.evaluate(views => {
					document.body.setAttribute('data-views', views);
				}, req.app.get('views'));
			});
		};
		app.get(/\.html$/, dom({
			offline: {
				enabled: true,
				plugins: new Set(['console', 'hidden', 'testView', 'html'])
			}
		}), (err, req, res, next) => {
			if (err) {
				console.error(err);
				res.sendStatus(500);
			} else next();
		}, staticMw);

		server = app.listen();
		await once(server, 'listening');
		host = `http://localhost:${server.address().port}`;
	});

	after(async () => {
		server.close();
		await dom.destroy();
	});



	it("should prepare and load a page", async () => {
		const { statusCode, body } = await request(`${host}/develop.html`);
		assert.equal(statusCode, 200);
		const text = await body.text();
		assert.match(text, /\/public<\/body>/);
		assert.doesNotMatch(text, /toto/);
	});

	it("should prepare and not load a page", async () => {
		const { statusCode, body } = await request(`${host}/develop.html`, { headers: { [dom.header]: dom.online.header }});
		assert.equal(statusCode, 200);
		const text = await body.text();
		assert.match(text, /data-views="/);
		assert.match(text, /toto/);
	});

});

