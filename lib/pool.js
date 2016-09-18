var WebKit = require('webkitgtk');
var debug = require('debug')('express-dom');

module.exports = Pool;


function Pool(opts, dom) {
	this.dom = dom;
	dom.navigator = WebKit.navigator;
	this.list = [];
	this.count = 0;
	this.max = opts.max || 8;
	this.maxloads = 100;
	this.notices = 1;
	this.queue = [];
	this.destroyTimeout = opts.destroyTimeout || 600000; // destroy the page if not used for that time
	this.idleTimeout = opts.idleTimeout || 180000; // unload the page if not used for that time
	setInterval(this.wipe.bind(this), this.idleTimeout / 4);
}

Pool.prototype.wipe = function() {
	var now = Date.now();
	var page;
	var nlist = [];
	for (var i=0; i < this.list.length; i++) {
		page = this.list[i];
		nlist.push(page);
		if (page.locked) continue;
		if (page.releaseTime && now > page.releaseTime + this.destroyTimeout || page.numloads && page.numloads > this.maxloads) {
			nlist.pop();
			// prevents the page from being grabbed during unload/destroy
			page.locked = true;
			page.unload().catch(error).then(function() {
				return this.destroy();
			}.bind(page)).catch(error);
		} else if (page.pingTime && now > page.pingTime + this.idleTimeout) {
			// ensures idling page is unloaded after some time
			page.locked = true;
			page.unload(function(err) {
				this.locked = false;
				error(err);
			}.bind(page));
		}
	}
	// in case destroy calls have been made
	if (nlist.length != this.list.length) {
		this.list = nlist;
		this.count = this.list.length;
	}
};

Pool.prototype.acquire = function(cb) {
	var create = false;
	var page;
	if (this.count < this.max) {
		this.count++;
		create = true;
	} else {
		for (var i=0; i < this.list.length; i++) {
			page = this.list[i];
			if (!page.locked) {
				break;
			}
			page = null;
		}
	}

	if (page) {
		page.locked = true;
		delete page.releaseTime;
		page.numloads = (page.numloads || 0) + 1;
		page.reset(function(err) {
			page.pingTime = Date.now();
			cb(null, page);
		});
	} else if (create) {
		WebKit(this.dom.settings, function(err, page) {
			if (err) return cb(err);
			page.locked = true;
			this.list.push(page);
			page.prepare = page.preload; // just let us name it prepare
			cb(null, page);
		}.bind(this));
	} else {
		this.queue.push({ts: Date.now(), cb: cb});
		if (this.queue.length > (this.max * this.notices)) {
			this.notices++;
			console.info("express-dom", this.queue.length, "queued acquisitions - consider raising dom.pool.max above", this.max);
		}
	}
};

Pool.prototype.release = function(page) {
	debug("release page", page.uri);
	page.locked = false;
	page.releaseTime = Date.now();
	setImmediate(this.process.bind(this));
};

Pool.prototype.process = function() {
	var next = this.queue.shift();
	if (next) {
		var diff = Date.now() - next.ts;
		if (diff > 5000) console.info("Took", diff + "ms", "to acquire a page");
		this.acquire(next.cb);
	}
};

function error(err) {
	if (err) console.error(err);
}

