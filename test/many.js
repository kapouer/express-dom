const assert = require('node:assert').strict;
const { once } = require('node:events');
const { request } = require('undici');
const express = require('express');

const dom = require('..');

dom.plugins.testEval = (page, settings, req) => {
	page.on('idle', async () => {
		await page.evaluate(views => {
			document.body.setAttribute('data-views', views);
		}, req.app.get('views'));
	});
};

describe("Busy", function() {
	this.timeout(0);
	let server, host;

	before(async () => {
		const app = express();
		app.set('views', __dirname + '/public');
		const staticMw = express.static(app.get('views'));
		app.get(/\/json\/c0-(\d+)\.json$/, (req, res) => {
			const obj = {};
			obj[req.params[0]] = "c0-" + req.params[0];
			res.json(obj);
		});
		app.get(/\.(json|js|css|png)$/, (req, res, next) => {
			if (req.query.delay) {
				setTimeout(next, parseInt(req.query.delay));
				delete req.query.delay;
			} else {
				next();
			}
		}, staticMw);
		app.get(/\.html$/, dom({
			online: {
				timeout: 30000
			},
			offline: {
				timeout: 30000,
				enabled: true,
				plugins: new Set(['hidden', 'testEval', 'html'])
			}
		}), (err, req, res, next) => {
			console.error(err);
			res.sendStatus(500);
		}, staticMw);

		server = app.listen();
		await once(server, 'listening');
		host = `http://localhost:${server.address().port}`;
	});

	after(async () => {
		server.close();
		await dom.destroy();
	});



	it("with many fetchs", async function() {
		this.timeout(10000);
		const MANY = 50;
		const { statusCode, body } = await request(`${host}/fetch-many.html?how=${MANY}`);
		assert.equal(statusCode, 200);
		const text = await body.text();
		for (let j = 0 ; j < MANY ; j++) {
			assert.match(text, new RegExp('c0-' + j));
		}
	});


	it("with many pages", async function() {
		this.timeout(20000);
		const list = [];
		const MAX = 10;
		const NUM = 6;
		let count = MAX * NUM;

		for (let i = 0; i < MAX; i++) {
			list.push(async () => {
				const MANY = 50;
				const { statusCode, body } = await request(`${host}/fetch-many.html?how=${MANY}&n=${i}`);
				assert.equal(statusCode, 200);
				const text = await body.text();
				for (let j = 0 ; j < MANY ; j++) {
					assert.match(text, new RegExp('c0-' + j));
				}
				count--;
			});
			list.push(async () => {
				const { statusCode, body } = await request(`${host}/basic-html.html?${i}`);
				assert.equal(statusCode, 200);
				const text = await body.text();
				assert.match(text, /toto/);
				count--;
			});
			list.push(async () => {
				const { statusCode, body } = await request(`${host}/script-async.html?${i}`);
				assert.equal(statusCode, 200);
				const text = await body.text();
				assert.match(text, /tutu/);
				count--;
			});
			list.push(async () => {
				const { statusCode, body } = await request(`${host}/basic-resolve.html?${i}`);
				assert.equal(statusCode, 200);
				const text = await body.text();
				assert.match(text, /tutu/);
				count--;
			});
			list.push(async () => {
				const { statusCode, body } = await request(`${host}/script-data.html?${i}`);
				assert.equal(statusCode, 200);
				const text = await body.text();
				assert.match(text, /tutu/);
				count--;
			});
			list.push(async () => {
				const { statusCode, body } = await request(`${host}/basic-fetch.html?${i}`);
				assert.equal(statusCode, 200);
				const text = await body.text();
				assert.match(text, /tarte/);
				count--;
			});
		}
		await Promise.all(list.map(fn => fn()));
		assert.equal(count, 0);
	});

	it("with many sub-requested pages without deadlock", async function() {
		this.timeout(40000);
		const list = [];
		const MAX = dom.pageMax * 3;
		let count = MAX;

		for (let i = 0; i < MAX; i++) {
			list.push(async () => {
				const { statusCode, body } = await request(`${host}/sub.html?${i}`);
				assert.equal(statusCode, 200);
				const text = await body.text();
				assert.match(text, /div class="load">true<\/div>/);
				count--;
			});
		}
		await Promise.all(list.map(fn => fn()));
		assert.equal(count, 0);
	});

});

