const expect = require('expect.js');
const request = require('request');
const express = require('express');

const host = "http://localhost";
const dom = require('../');
dom.settings.stall = 5000;
dom.settings.allow = 'all';
dom.settings.timeout = 10000;
dom.settings.console = true;
dom.pool.max = 8;

const pluginsCounts = {};

function pagePluginTest(page, plugin, ev) {
	page.when(ev, (cb) => {
		page.run((plugin, ev, done) => {
			const el = document && document.getElementById(plugin + ev);
			if (!el) console.error("ready event but NOT INTERACTIVE", document.readyState);
			try {
				el.innerHTML = plugin + " " + ev;
			} catch(e) {
				console.error(plugin, ev, Boolean(document), Boolean(document.documentElement), e.toString());
			}
			done();
		}, plugin, ev, cb);
	});
	if (!pluginsCounts[plugin + ev]) pluginsCounts[plugin + ev] = 0;
	pluginsCounts[plugin + ev]++;
}

describe("when queues", function suite() {
	this.timeout(40000);
	let server, port;

	before((done) => {
		const app = express();
		app.set('views', __dirname + '/public');

		app.get(/\.(json|js|css|png)$/, express.static(app.get('views')));
		app.get(/\.html$/, (req, res, next) => {
			const mw = dom();
			mw.prepare((page) => {
				pagePluginTest(page, 'prepare', 'ready');
				pagePluginTest(page, 'prepare', 'load');
				pagePluginTest(page, 'prepare', 'idle');
			});
			mw.load((page) => {
				pagePluginTest(page, 'load', 'ready');
				pagePluginTest(page, 'load', 'load');
				pagePluginTest(page, 'load', 'idle');
			});
			mw(req, res, next);
		});

		server = app.listen((err) => {
			if (err) console.error(err);
			port = server.address().port;
			done();
		});
	});

	after((done) => {
		server.close();
		done();
	});

	it("should load a hundred pages with asynchronous plugins", function(done) {
		this.timeout(40000);
		let count = 0;
		function countDone(from, counter) {
			count--;
			if (!count) done();
		}
		function batch(i) {
			count++;
			request({
				method: 'GET',
				url: host + ':' + port + '/when.html'
			}, (err, res, body) => {
				expect(body.indexOf('prepare ready')).to.be.greaterThan(0);
				expect(body.indexOf('prepare load')).to.be.greaterThan(0);
				expect(body.indexOf('prepare idle')).to.be.greaterThan(0);
				expect(body.indexOf('load ready')).to.be.greaterThan(0);
				expect(body.indexOf('load load')).to.be.greaterThan(0);
				expect(body.indexOf('load idle')).to.be.greaterThan(0);
				expect(body.indexOf('toto')).to.be.greaterThan(0);
				countDone('when', i);
			});
		}
		let i = 0;
		while (i++ < 40) batch(i);
	});

});

