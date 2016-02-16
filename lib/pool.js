var WebKit = require('webkitgtk');
var debug = require('debug')('express-dom');

module.exports = Pool;


function Pool(opts, dom) {
	this.dom = dom;
	this.list = [];
	this.count = 0;
	this.max = opts.max || 8;
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
		if (page.releaseTime) {
			if (now > page.releaseTime + this.destroyTimeout) {
				nlist.pop();
				page.destroy(function(err) {
					if (err) console.error(err);
				});
			}
		} else if (page.pingTime && now > page.pingTime + this.idleTimeout) {
			this.release(page);
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
		this.release(page, function() {
			page.locked = true;
			delete page.releaseTime;
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
			console.info("express-dom", this.queue.length, "queued acquisitions - consider raising dom.settings.max above", this.max);
		}
	}
};

Pool.prototype.release = function(page, cb) {
	debug("release page", page.uri);
	page.locked = true;
	page.releaseTime = Date.now();
	page.unload(function(err) {
		page.locked = false;
		if (cb) cb(err);
		setImmediate(this.process.bind(this));
	}.bind(this));
};

Pool.prototype.process = function() {
	var next = this.queue.shift();
	if (next) {
		var diff = Date.now() - next.ts;
		if (diff > 5000) console.info("Took", diff + "ms", "to acquire a page");
		this.acquire(next.cb);
	}
};
