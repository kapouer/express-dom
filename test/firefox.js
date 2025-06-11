const assert = require('node:assert').strict;
const { once } = require('node:events');
const { request } = require('undici');
const express = require('express');

const dom = require('..');

dom.defaults.timeout = 10000;
dom.defaults.log = true;

dom.debug = require('node:inspector').url() !== undefined;

let server, origin;

describe("Using firefox", function() {
	this.timeout(0);

	before(async () => {
		const app = express();
		const staticMw = express.static(__dirname + '/public');

		app.get(/\.(json|js|css|png)$/, staticMw);

		app.get(/\.html$/, dom().route((phase, req) => {
			phase.settings.browser = req.query.browser ?? "chromium";
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



	it("loads a page in firefox", async () => {
		const { statusCode, body } = await request(`${origin}/firefox.html?browser=firefox`);
		assert.equal(statusCode, 200);
		const txt = await body.text();
		assert.ok(txt.includes('Firefox'));
	});

	it("loads a page in firefox and then in chromium", async () => {
		const { body: firefoxBody } = await request(`${origin}/firefox.html?browser=firefox`);
		assert.ok((await firefoxBody.text()).includes('Firefox'));

		const { body: chromiumBody } = await request(`${origin}/firefox.html?browser=chrome`);
		assert.ok((await chromiumBody.text()).includes('HeadlessChrome'));
	});

});

