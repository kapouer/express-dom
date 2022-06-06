const { BrowserPool, PlaywrightPlugin } = require('browser-pool');
const { chromium } = require('playwright-core');
const debug = require('debug')('express-dom');
const clone = require('clone');
const { randomUUID } = require('node:crypto');
const { Deferred } = require('class-deferred');

const plugins = require('./plugins');
const helpers = require('./helpers');
const tracker = require('./tracker');
const asyncEmit = require('./async-emit');

let browserPool;

class RequestTracker extends Deferred {
	#requests = 0;

	constructor(page) {
		super();
		page.on('request', () => this.#creates());
		page.on('requestfinished', () => this.#completes());
		page.on('requestfailed', () => this.#completes());
	}
	#creates() {
		this.#requests++;
	}
	#completes() {
		this.#requests--;
		if (this.#requests == 0) {
			setImmediate(this.resolve);
		}
	}
}

module.exports = class Handler {
	static plugins = plugins;
	static helpers = helpers;
	static settings = {
		helpers: [
			'view',
			'prioritize'
		],
		prepare: {
			plugins: [
				'hide',
				'html'
			]
		},
		load: {
			disable: Boolean(process.env.DEVELOP),
			plugins: [
				'console',
				'hide',
				'prerender',
				'redirect',
				'referrer',
				'html'
			]
		},
		policies: {
			default: "'none'"
		},
		headers: {},
		filters: [],
		console: process.env.NODE_ENV != "production" ? "info" : "error",
		timeout: 10000,
		scale: 1,
		navigation: false,
		debug: false,
		browser: 'chrome',
		pageMax: 20,
		pageUse: 200
	};

	constructor(...helpers) {
		const h = this;
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
				maxOpenPagesPerBrowser: Handler.settings.pageMax,
				retireBrowserAfterPageCount: Handler.settings.pageUse,
				useIncognitoPages: true, // each page can have its cookies
				launchOptions: {
					channel: Handler.settings.browser,
					devtools: Handler.settings.debug,
					timeout: Handler.settings.timeout / 2
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
		const h = new Handler();
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
				url: loc.pathname + loc.search,
				path: loc.pathname
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

		const loc = settings.location = getAbsoluteUrl(req);
		if (req.headers.cookie) {
			settings.headers.cookie = req.headers.cookie;
		}

		for (const helper of settings.helpers) {
			const fn = typeof helper == "string" ? Handler.helpers[helper] : helper;
			if (!fn) {
				throw new Error(`helper not found: ${helper}`);
			}
			await fn(this, settings, req, res);
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
				res.status(500);
				isPath = false;
			}
		}
		if (!isPath) {
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
		const page = await browserPool.newPage({
			pageOptions: {
				ignoreHTTPSErrors: true,
				deviceScaleFactor: settings.scale ?? 1
			}
		});
		asyncEmit(page);
		const mSettings = {
			...settings,
			...settings[method]
		};
		const { plugins } = mSettings;
		delete mSettings.plugins;
		for (const plugin of plugins) {
			const fn = typeof plugin == "string" ? Handler.plugins[plugin] : plugin;
			if (!fn) {
				throw new Error(`plugin not found: ${plugin}`);
			}
			await fn(page, mSettings, req, res);
		}

		settings.location = mSettings.location;
		settings.input = mSettings.input;
		delete mSettings.location;
		delete mSettings.input;
		const url = settings.location.toString();
		debug(method, url);

		if (mSettings.filters.length) page.route(/.*/, async (route, request) => {
			let accept = true;
			for (const filter of mSettings.filters) {
				accept = await filter(request);
				if (accept === false) break;
			}
			if (accept === false) {
				route.abort();
			} else {
				route.continue();
			}
		});

		const csp = buildPolicies(mSettings.policies);

		page.route(url, route => {
			route.fulfill({
				headers: {
					"Content-Security-Policy": csp
				},
				body: settings.input,
				contentType: 'text/html'
			});
		});

		page.on('crash', err => {
			console.error("page crashed", url, err);
		});

		page.on('pageerror', err => {
			if (mSettings.console) console.error(err);
			res.status(500);
			settings.input = err;
		});
		const reqTrack = new RequestTracker(page);

		const fnid = 'signal_' + randomUUID();
		await page.addInitScript(tracker, fnid);
		try {
			await page.goto(url, {
				waitUntil: 'domcontentloaded',
				timeout: mSettings.timeout
			});
			debug("page loaded");

			const [event, timeout] = await Promise.race([
				Promise.all([
					page.evaluate(id => window[id], fnid),
					reqTrack
				]),
				new Promise(resolve => {
					setTimeout(() => resolve(true), mSettings.timeout);
				})
			]);
			if (timeout) {
				throw new Error(`Timeout waiting for: ${url}`);
			}
			debug("page idle");
			await asyncEmit(page, 'idle');
			debug("async emit done");
		} catch (ex) {
			if (ex.message.startsWith("page.evaluate: Execution context was destroyed")) {
				// pass
				console.error(ex);
			} else {
				console.error(ex);
			}
		} finally {
			try {
				await page.close();
			} catch {
				// don't care about an error here
			}
		}

		if (mSettings.output !== undefined) {
			settings.input = mSettings.output;
		}
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

function getAbsoluteUrl({ protocol, headers, url }) {
	if (protocol == "about:") {
		return new URL(`about:${url}`);
	} else {
		return new URL(`${protocol}://${headers.host}${url}`);
	}
}

function buildPolicies(pol) {
	return Object.entries(pol).map(([key, val]) => {
		return `${key}-src ${val}`;
	}).join('; ');
}
