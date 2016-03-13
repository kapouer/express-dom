var expect = require('expect.js');
var request = require('request');
var express = require('express');

var host = "http://localhost";
var dom = require('../');
dom.settings.stall = 5000;
dom.settings.allow = 'all';
dom.settings.timeout = 10000;
dom.settings.console = true;
dom.pool.max = 8;

function pagePluginTest(page, plugin, ev) {
	page.when(ev, function(cb) {
		page.run(function(plugin, ev, done) {
			var el = document && document.getElementById(plugin + ev);
			if (!el) console.error("ready event but NOT INTERACTIVE", document.readyState);
			try {
				el.innerHTML = plugin + " " + ev;
			} catch(e) {
				console.error(plugin, ev, !!document, !!document.documentElement, e.toString());
				if (!el) console.log(document.documentElement.outerHTML);
			}
			done();
		}, plugin, ev, cb);
	});
	if (!pluginsCounts[plugin + ev]) pluginsCounts[plugin + ev] = 0;
	pluginsCounts[plugin + ev]++;
}

var pluginsCounts = {};

describe("when queues", function suite() {
	this.timeout(40000);
	var server, port;

	before(function(done) {
		var app = express();
		app.set('views', __dirname + '/public');

		app.get(/\.(json|js|css|png)$/, express.static(app.get('views')));
		app.get(/\.html$/, function(req, res, next) {
			var mw = dom();
			mw.prepare(function(page) {
				pagePluginTest(page, 'prepare', 'ready');
				pagePluginTest(page, 'prepare', 'load');
				pagePluginTest(page, 'prepare', 'idle');
			});
			mw.load(function(page) {
				pagePluginTest(page, 'load', 'ready');
				pagePluginTest(page, 'load', 'load');
				pagePluginTest(page, 'load', 'idle');
			});
			mw(req, res, next);
		});

		server = app.listen(function(err) {
			if (err) console.error(err);
			port = server.address().port;
			done();
		});
	});

	after(function(done) {
		server.close();
		done();
	});

	it("should load a hundred pages with asynchronous plugins", function(done) {
		this.timeout(40000);
		var count = 0;
		var counts = {};
		var received = {};
		function countDone(from, counter) {
			count--;
//			if (!counts[from]) counts[from] = 0;
//			counts[from]++;
//			console.log(count, counts);
			if (!count) done();
//			if (!received[from]) received[from] = [];
//			received[from].push(counter);
//			received[from].sort(function(a, b) {
//				return parseInt(a) - parseInt(b);
//			});
//			if (count < 4) {
//				console.log(received);
//				console.log(pluginsCounts);
//			}
		}
		function batch(i) {
			count++;
			request({
				method: 'GET',
				url: host + ':' + port + '/when.html'
			}, function(err, res, body) {
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
		var i=0;
		while (i++ < 40) batch(i);
	});

});

