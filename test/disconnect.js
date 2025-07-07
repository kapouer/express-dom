const assert = require('node:assert').strict;
const { once } = require('node:events');
const { request } = require('undici');
const express = require('express');

const dom = require('..');

dom.defaults.log = true;

dom.debug = require('node:inspector').url() !== undefined;

let server, origin;

describe("Browser lifecycle", function() {
	this.timeout(0);

	before(async () => {
		const app = express();
		const staticMw = express.static(__dirname + '/public');

		app.get(/\.(json|js|css|png)$/, staticMw);

		app.get(/\.html$/, dom({
			pool: {
				min: 0,
				minIdle: 0,
				max: 1
			}
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

	it("loads a page, disconnect browser manually, loads another page", async () => {
		assert.equal((await request(`${origin}/basic-html.html`)).statusCode, 200);
		await dom.disconnectBrowser("chrome");
		await new Promise(resolve => setTimeout(resolve, 1000));
		assert.equal((await request(`${origin}/basic-inline.html`)).statusCode, 200);
	});

});

