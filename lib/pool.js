var WebKit = require('webkitgtk');
var debug = require('debug')('express-dom');

module.exports = Pool;


function Pool(opts, dom) {
	this.dom = dom;
	dom.navigator = WebKit.navigator;
	// one list for each priority
	this.lists = [];
	// one queue for each priority
	this.queues = [];
	// max items by list
	this.max = opts.max || 4;
	this.maxloads = 100;
	this.notices = 1;
	this.destroyTimeout = opts.destroyTimeout || 600000; // destroy the page if not used for that time
	this.idleTimeout = opts.idleTimeout || 180000; // unload the page if not used for that time
	this.wipeTimeout = Math.max(this.idleTimeout / 4, 3000);
	setInterval(this.wipe.bind(this), this.wipeTimeout);
}

Pool.prototype.wipe = function() {
	var me = this;
	var now = Date.now();
	this.lists = this.lists.map(function(list) {
		var nlist = list.filter(function(page) {
			if (page.trash) return false;
			if (page.locked) return true;
			if (now > page.releaseTime + me.destroyTimeout || page.numloads > me.maxloads) {
				// prevents the page from being grabbed during unload/destroy
				page.locked = true;
				page.unload().catch(error).then(function() {
					return this.destroy();
				}.bind(page)).catch(error);
				return false;
			} else if (page.pingTime && now > page.pingTime + me.idleTimeout) {
				// ensures idling page is unloaded after some time
				page.locked = true;
				page.unload(function(err) {
					this.locked = false;
					error(err);
				}.bind(page));
				return true;
			} else {
				return true;
			}
		});

		// in case destroy calls have been made
		if (nlist.length != list.length) {
			list = nlist;
		}
		return list;
	});
};

Pool.prototype.acquire = function(priority, cb) {
	var me = this;
	var list = this.lists[priority];
	if (!list) list = this.lists[priority] = [];
	if (!list.count) list.count = list.length;
	var count = list.count;
	if (count < me.max) {
		list.count++;
		WebKit(this.dom.settings, function(err, page) {
			if (err) {
				list.count--;
				return cb(err);
			}
			page.locked = true;
			page.on('crash', function() {
				// eslint-disable-next-line no-console
				console.warn("page crashed", page.uri);
				page.trash = true;
				this.release(page, function() {
					this.wipe();
				}.bind(this));
			}.bind(this));
			list[count] = page;
			page.prepare = page.preload; // just let us name it prepare
			cb(null, page);
		}.bind(this));
	} else {
		var page;
		for (var i=0; i < list.length; i++) {
			page = list[i];
			if (!page.locked && !page.trash) break;
			page = null;
		}
		if (page) {
			page.locked = true;
			delete page.releaseTime;
			page.numloads = (page.numloads || 0) + 1;
			page.reset(function() {
				page.pingTime = Date.now();
				cb(null, page);
			});
		} else {
			var queue = this.queues[priority];
			if (!queue) queue = this.queues[priority] = [];
			queue.push({
				ts: Date.now(),
				cb: cb
			});
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
	var me = this;
	this.queues.forEach(function(queue, priority) {
		var next, nextIndex = -1, oldest = Infinity;
		for (var i = 0; i < queue.length; i++) {
			next = queue[i];
			if (next.ts < oldest) {
				oldest = next.ts;
				nextIndex = i;
			}
		}
		if (nextIndex >= 0) {
			next = queue[nextIndex];
			queue.splice(nextIndex, 1);
			me.acquire(priority, next.cb);
		}
	});
};

function error(err) {
	// eslint-disable-next-line no-console
	if (err) console.error(err);
}

