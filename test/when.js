var expect = require('expect.js');
var request = require('request');
var express = require('express');

var host = "http://localhost";
var dom = require('../');
dom.settings.stall = 5000;
dom.settings.allow = 'all';
dom.settings.timeout = 10000;
dom.settings.console = true;
dom.settings.max = 8;
require('http').globalAgent.maxSockets = 50000;

function pagePluginTest(page, plugin, ev) {
	page.when(ev, function(cb) {
		page.run(function(plugin, ev, done) {
			var el = document && document.getElementById(plugin + ev);
			if (!el) console.error("ready event but NOT INTERACTIVE", document.readyState);
			try {
				el.innerText = plugin + " " + ev;
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
		app.set('statics', __dirname + '/public');

		app.get(/\.(json|js|css|png)$/, express.static(app.get('statics')));
		app.get(/\.html$/, function(req, res, next) {
			var mw = dom(req.path.substring(1));
			mw.author(function(page) {
				pagePluginTest(page, 'author', 'ready');
				pagePluginTest(page, 'author', 'load');
				pagePluginTest(page, 'author', 'idle');
			});
			mw.use(function(page) {
				pagePluginTest(page, 'user', 'ready');
				pagePluginTest(page, 'user', 'load');
				pagePluginTest(page, 'user', 'idle');
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
				expect(body.indexOf('author ready')).to.be.greaterThan(0);
				expect(body.indexOf('author load')).to.be.greaterThan(0);
				expect(body.indexOf('author idle')).to.be.greaterThan(0);
				expect(body.indexOf('user ready')).to.be.greaterThan(0);
				expect(body.indexOf('user load')).to.be.greaterThan(0);
				expect(body.indexOf('user idle')).to.be.greaterThan(0);
				expect(body.indexOf('toto')).to.be.greaterThan(0);
				countDone('when', i);
			});
		}
		var i=0;
		while (i++ < 40) batch(i);
	});

});

