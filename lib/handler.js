const { BrowserPool, PlaywrightPlugin } = require('browser-pool');
const { chromium } = require('playwright-core');
const debug = require('debug')('express-dom');
const clone = require('clone');

const plugins = require('./plugins');
const helpers = require('./helpers');
const tracker = require('./tracker');
const Deferred = require('./deferred');
const asyncEmit = require('./async-emit');

let browserPool;

class RequestTracker extends Deferred {
	#count = 0;

	constructor(page) {
		super();
		page.on('request', () => this.creates());
		page.on('requestfinished', () => this.completes());
		page.on('requestfailed', () => this.completes());
	}
	creates() {
		this.#count++;
	}
	completes() {
		if (--this.#count == 0) setImmediate(this.resolve);
	}
}

module.exports = class Handler {
	static pool = {
		max: 20
	};
	static plugins = plugins;
	static helpers = helpers;
	static settings = {
		helpers: [
			helpers.view,
			helpers.prioritize
		],
		prepare: {
			plugins: [
				plugins.hide,
				plugins.noreq,
				plugins.html
			]
		},
		load: {
			disable: Boolean(process.env.DEVELOP),
			plugins: [
				plugins.hide,
				plugins.nomedia,
				plugins.prerender,
				plugins.redirect,
				plugins.referrer,
				plugins.html
			]
		},
		console: process.env.NODE_ENV != "production",
		stall: 15000,
		allow: "same-origin",
		navigation: false,
		verbose: true
	};

	constructor(view, ...helpers) {
		const h = this;
		if (typeof view == "function") {
			helpers.unshift(view);
			view = null;
		} else {
			h.view = view;
		}
		debug("new handler", view);
		h.settings = emptySettings(Handler.settings);
		h.settings.helpers = helpers.concat(Handler.settings.helpers);
		h.settings.prepare = emptySettings(Handler.settings, true);
		h.settings.load = emptySettings(Handler.settings, true);

		h.chain = (...args) => h.middleware(...args);
		h.chain.load = (...args) => h.load(...args);
		h.chain.prepare = (...args) => h.prepare(...args);
	}
	#init(settings, defaults, opts, args) {
		if (!browserPool) browserPool = new BrowserPool({
			browserPlugins: [new PlaywrightPlugin(chromium, {
				maxOpenPagesPerBrowser: Handler.pool.max,
				retireBrowserAfterPageCount: Handler.pool.maxloads,
				useIncognitoPages: true, // each page can have its cookies
				launchOptions: {
					channel: 'chrome',
					timeout: 5000
				}
			})],
		});
		if (typeof opts == "function") opts = null;
		else args.shift();
		let plugins = settings.plugins;
		Object.assign(settings, defaults, opts);
		if ((!opts || !opts.plugins) && plugins.length) settings.plugins = plugins;
		else plugins = settings.plugins;
		if (typeof plugins == "function") plugins = [plugins];
		settings.plugins = args.concat(plugins);
	}

	static async destroy() {
		await browserPool.destroy();
		browserPool = null;
	}
	clone() {
		const h = new Handler(this.view);
		h.settings = clone(this.settings);
		return h;
	}
	prepare(opts) {
		this.#init(
			this.settings.prepare,
			Handler.settings.prepare,
			opts,
			Array.from(arguments)
		);
		return this.chain;
	}

	load(opts) {
		this.#init(
			this.settings.load,
			Handler.settings.load,
			opts,
			Array.from(arguments)
		);
		return this.chain;
	}
	async middleware(req, res, next) {
		const manual = {};
		if (typeof req == "string") {
			debug("Called in manual mode");
			const loc = new URL(req);
			req = {
				headers: {
					host: loc.host
				},
				protocol: loc.protocol,
				url: loc.path
			};
			req.get = function (key) {
				return this.headers[key];
			}.bind(req);
			res = { statusCode: 200 };
			res.sendStatus = function (status) {
				res.statusCode = manual.status = status;
			};
			res.send = function (str) {
				manual.body = str;
			};
			res.status = res.sendStatus;
			req.res = res;
		}
		// per request settings
		const rh = this.clone();
		try {
			await rh.runMiddleware(req, res);
			if (!next) {
				return manual;
			}
		} catch (err) {
			if (next) next(err);
			else throw err;
		}
	}

	async runMiddleware(req, res) {
		const { settings } = this;

		const loc = settings.location = new URL(
			req.url,
			(req.get('X-Forwarded-Proto') ?? req.protocol) + '://' + req.headers.host
		);
		if (req.headers.cookie) loc.headers = {
			cookie: req.headers.cookie
		};

		for (const helper of settings.helpers) {
			await helper(this, settings, req, res);
		}

		debug('view loaded for', loc.pathname, "with", settings.prepare.plugins.length, "prepare plugins, and", settings.load.plugins.length, "load plugins");

		if (!settings.prepare.disable && settings.prepare.plugins.length > 0) {
			await this.runMethod('prepare', settings, req, res);
		}

		if (!settings.load.disable && settings.load.plugins.length > 0) {
			await this.runMethod('load', settings, req, res);
		}

		let data = settings.input;
		// hopefully free faster that memory
		delete settings.input;
		if (res.get && !res.get('Content-Type')) {
			res.set('Content-Type', "text/html");
		}
		let status = res.statusCode;
		if (data === false) {
			debug("data handled by plugin");
			return;
		}
		if (!data) {
			if (!settings.prepare && !settings.load) {
				return res.sendStatus(501);
			} else {
				return res.sendStatus(404);
			}
		}
		let isPath = true, isStream = false;
		if (data instanceof Error) {
			isPath = false;
			data = null;
		} else if (Buffer.isBuffer(data)) {
			isPath = false;
		} else if (typeof data.pipe == "function") {
			isPath = false;
			isStream = true;
		} else if (typeof data != "string") {
			data = data.toString();
		}
		if (isPath && data.startsWith('<')) {
			isPath = false;
		}
		if (isPath) {
			try {
				res.sendFile(data);
			} catch (ex) {
				// eslint-disable-next-line no-console
				console.error("express-dom thought input was a file path", data);
				status = 500;
				isPath = false;
			}
		}
		if (!isPath) {
			if (status) res.status(status);
			if (isStream) {
				data.once('error', (err) => {
					res.emit('error', err);
					data.unpipe(res);
				});
				data.pipe(res);
			} else {
				res.send(data);
			}
		}
	}

	async runMethod(method, settings, req, res) {
		const page = await browserPool.newPage();
		asyncEmit(page);
		const mSettings = Object.assign({}, settings, settings[method]);
		mSettings.location = settings.location;
		const plugins = mSettings.plugins;
		delete mSettings.plugins;
		for (const plugin of plugins) {
			await plugin(page, mSettings, req, res);
		}

		settings.location = mSettings.location;
		settings.input = mSettings.input;
		delete mSettings.location;
		delete mSettings.input;
		const url = settings.location.toString();
		debug(method, url);

		page.route(url, route => {
			route.fulfill({
				body: settings.input,
				contentType: 'text/html'
			});
		});

		if (mSettings.verbose) page.on('console', msg => {
			// eslint-disable-next-line no-console
			console[msg.type()](msg.text());
		});
		page.on('pageerror', err => {
			res.statusCode = 500;
			settings.input = err;
			if (mSettings.verbose) console.error(err);
		});
		const reqTrack = new RequestTracker(page);

		const fnid = 'signal' + Math.floor(Math.random() * 10000000);
		await page.addInitScript(tracker, {
			id: fnid,
			stall: mSettings.stall
		});
		try {
			await page.goto(url, {
				waitUntil: 'domcontentloaded'
			});
			debug("page loaded");
			await reqTrack;
			debug("page requests finished");
			const event = await page.evaluate(id => window[id], fnid);
			debug("page idle");
			if (event == "idle") {
				await asyncEmit(page, 'idle');
				debug("async emit done");
			} else {
				console.warn("Unknown event", event);
			}
		} catch (ex) {
			console.error(ex);
		}

		if (mSettings.output !== undefined) {
			settings.input = mSettings.output;
		}
		await page.close();
	}
};

function emptySettings(defaults, withArrays) {
	// use defaults but not .load, .prepare sub global settings
	let obj = Object.assign({}, defaults);
	delete obj.load;
	delete obj.prepare;
	obj = clone(obj);
	if (withArrays) {
		if (!obj.filters) obj.filters = [];
		if (!obj.plugins) obj.plugins = [];
		if (!obj.scripts) obj.scripts = [];
	}
	return obj;
}
