const { Pool } = require('lightning-pool');
const puppeteer = require('puppeteer-core');
const debug = require('debug')('express-dom');
const { randomUUID } = require('node:crypto');
const { IncomingMessage } = require('node:http');

const Phase = require('./phase');
const plugins = require('./plugins');
const routers = require('./routers');
const RequestTracker = require('./request-tracker');
const asyncTracker = require('./async-tracker');
const customTracker = require('./custom-tracker');
const { ManualRequest, ManualResponse } = require('./manual');
const mergeWith = require('lodash.mergewith');

function mergeOpts(dst, src) {
	return mergeWith(dst, src, (dst, src) => {
		if (Array.isArray(src) || src instanceof Set) {
			return structuredClone(src);
		}
	});
}

class PoolFactory {
	#opts;
	#browser;
	constructor(browser, opts) {
		this.#browser = browser;
		this.#opts = opts;
	}

	async create() {
		const browser = await this.#browser;
		const context = await browser.createBrowserContext(this.#opts);
		const page = await context.newPage();
		await page.setViewport({
			width: 640,
			height: 480,
			deviceScaleFactor: this.#opts.devicePixelRatio
		});
		return page;
	}

	async destroy(page) {
		await page.browserContext().close();
	}

	async reset(page) {
		await page.goto("about:blank");
	}

	async validate(page) {
		// each used page must be thrown
		throw new Error();
	}
}

module.exports = class Handler {
	static executable = null;
	static debug = process.env.PWDEBUG == 1;

	static header = 'Sec-Purpose';

	static defaults = {
		routers,
		plugins,
		log: process.env.NODE_ENV != "production" ? "info" : "error",
		timeout: process.env.PWDEBUG == 1 ? 0 : 10000,
		page: {},
		pool: {
			max: 50,
			min: 0,
			minIdle: 0,
			maxQueue: 100,
			fifo: false,
			acquireMaxRetries: 1,
			acquireTimeoutMillis: 15000,
			idleTimeoutMillis: 180000,
			houseKeepInterval: 5000,
			resetOnReturn: true,
			validation: false
		},
		browser: 'chrome',
		cookies: new Set(),
		devicePixelRatio: 1,
		browsers: {
			chrome: {
				executablePath: '/usr/bin/chromium',
				args: [
					'--force-color-profile=srgb',
					'--deterministic-mode',
					'--disable-gpu',
					'--headless=new'
				],
				regpol: /^Refused to .+ because it violates the following Content Security Policy directive:/
			},
			firefox: {
				executablePath: '/usr/bin/firefox',
				regpol: /^Error: Content-Security-Policy:/
			}
		},
		offline: {
			header: 'prepare',
			policies: {
				default: "'none'"
			},
			enabled: false,
			track: false,
			styles: [],
			scripts: [],
			plugins: new Set([
				'console',
				'hidden',
				'cookies', // only needed to reset cookies
				'html'
			])
		},
		online: {
			header: 'prefetch; prerender',
			policies: {
				default: "'none'",
				script: "'self' 'unsafe-inline'",
				connect: "'self'"
			},
			enabled: !process.env.DEVELOP,
			track: true,
			styles: [],
			scripts: [],
			cookies: new Set(),
			plugins: new Set([
				'console',
				'hidden',
				'cookies',
				'redirect',
				'referrer',
				'html'
			])
		},
		visible: {
			policies: {}
		}
	};
	static #browsers = new Map();
	static #pools = new Map();

	#router;

	constructor(conf = {}) {
		this.opts = mergeOpts({}, Handler.defaults);
		if (typeof conf == "function") conf(this.opts);
		else mergeOpts(this.opts, conf);
		this.chain = (...args) => this.middleware(...args);
	}

	route(fn) {
		this.#router = fn;
		return this.chain;
	}

	static async destroy() {
		const pools = Handler.#pools;
		for (const [key, instance] of pools.entries()) {
			await instance.close(true);
			pools.delete(key);
		}
		const browsers = Handler.#browsers;
		for (const [name, browser] of browsers.entries()) {
			await (await browser).close();
			browsers.delete(name);
		}
	}

	async #initBrowser(browser) {
		const opts = {
			browser,
			acceptInsecureCerts: true,
			devtools: false, //Handler.debug,
			timeout: this.opts.timeout / 2
		};
		Object.assign(opts, this.opts.browsers[browser]);
		return puppeteer.launch(opts);
	}

	async acquire(browser, devicePixelRatio) {
		const browsers = Handler.#browsers;
		if (!browsers.has(browser)) {
			browsers.set(browser, this.#initBrowser(browser));
		}
		const pools = Handler.#pools;
		const key = { browser, devicePixelRatio };
		if (!pools.has(key)) {
			pools.set(key, new Pool(
				new PoolFactory(browsers.get(browser), {
					...this.opts.page,
					devicePixelRatio
				}), { ...this.opts.pool }
			));
		}
		const pool = pools.get(key);
		const page = await pool.acquire();
		page.pool = pool;
		const { regpol } = this.opts.browsers[browser];
		page.isCSPError = str => {
			return regpol.test(str);
		};
		return page;
	}

	async release(page) {
		const { pool, evals } = page;
		delete page.pool;
		delete page.evals;
		page.removeAllListeners();
		await Promise.all(evals.map(ev => {
			if (ev?.identifier) return page.removeScriptToEvaluateOnNewDocument(ev.identifier);
		}));
		try {
			await pool.release(page);
		} catch (err) {
			console.error(err);
		}
	}

	async middleware(req, res, next) {
		if (typeof req == "string" || !(req instanceof IncomingMessage)) {
			req = new ManualRequest(req);
		}
		const { res: initialRes } = req;
		if (!next && !res) {
			res = req.res = new ManualResponse(res);
		}
		try {
			await this.runMiddleware(req, res, next);
			if (res instanceof ManualResponse) {
				if (initialRes) req.res = initialRes;
				return res;
			}
		} catch (err) {
			if (next) next(err);
			else throw err;
		}
	}

	async runMiddleware(req, res, next) {
		const phase = new Phase(this, req);

		phase.settings = mergeOpts({}, phase.settings);
		phase.policies = mergeOpts({}, phase.policies);
		phase.plugins = { ...this.opts.plugins };

		if (this.#router) {
			await this.#router(phase, req, res);
		}

		res.set(phase.headers());
		res.vary(Handler.header);

		if (phase.settings?.enabled) {
			if (Handler.debug) phase.settings.timeout = 0;
			await this.runMethod(phase, req, res);
		} else {
			next();
		}
	}

	async runMethod(phase, req, res) {
		const { location, settings, plugins } = phase;
		const { browser = this.opts.browser, devicePixelRatio = 1 } = settings;
		if (!this.opts.browsers[browser]) {
			throw new Error("Unknown browser: " + browser);
		}
		const page = await this.acquire(browser, devicePixelRatio);

		if (Array.isArray(settings.plugins)) {
			settings.plugins = new Set(settings.plugins);
		}

		page.location = location;
		settings.headers = {};

		const idleListeners = [];
		page.on = function (key, listener) {
			if (key == "idle") {
				idleListeners.push(listener);
			} else {
				return puppeteer.Page.prototype.on.call(this, key, listener);
			}
		};

		for (const plugin of settings.plugins) {
			const fn = plugins[plugin];
			if (!fn) {
				throw new Error(`plugin not found: ${plugin}`);
			}
			await fn(page, settings, req, res);
		}

		// plugins might change any of these values
		const {
			scripts, styles, timeout, referer, track
		} = settings;

		const url = page.location.toString();

		const errListener = err => {
			if (!page.isCSPError(err)) console.error(err);
		};

		page.on('crash', errListener);
		page.on('pageerror', errListener);
		page.on('error', errListener);

		page.once('response', response => {
			const code = response.status();
			if (code != 200 && code != 304 && res.statusCode == 200) {
				res.status(code);
			}
		});

		await page.setRequestInterception(true);

		await page.on('request', request => {
			if (request.url() != url) {
				if (!request.isInterceptResolutionHandled()) request.continue();
				return;
			}
			if (req instanceof ManualRequest && req.body) {
				return request.respond({
					status: req.status,
					body: req.body,
					headers: req.headers
				});
			} else {
				const headers = {
					...request.headers(),
					[Handler.header]: settings.header,
					...settings.headers
				};
				return request.continue({ headers });
			}
		});

		const reqTrack = new RequestTracker(page);

		const id = randomUUID();

		const inits = [];
		if (typeof track == "function") {
			inits.push([`window['track_${id}'] = ${track.toString()}`]);
			inits.push([customTracker, { id }]);
		} else if (track) {
			inits.push([asyncTracker, { id, timeout }]);
		}
		if (styles.length) {
			inits.push([initStyles, styles.join('\n')]);
		}

		page.evals = await initScripts(page, inits.concat(scripts));

		try {
			await page.goto(url, {
				waitUntil: 'domcontentloaded',
				timeout, referer
			});
			debug("page loaded");

			const event = await Promise.race([
				Promise.all([
					track ? page.evaluate(id => window[id], `signal_${id}`) : null,
					reqTrack
				]).then(() => 'idle'),
				new Promise(resolve => {
					if (timeout) setTimeout(() => resolve('timeout'), timeout + 1000);
				}),
				new Promise(resolve => {
					page.on('close', () => resolve('close'));
				})
			]);
			if (event == "timeout") {
				debug("page timeout", url);
				throw new Error('Page timeout');
			} else if (event == "close") {
				debug("page closed", url);
			} else if (event == "idle") {
				debug("page idle", url);
				for (const fn of idleListeners) {
					await fn.apply(page);
				}
			} else {
				debug("page stale", url);
				throw new Error('Page stale');
			}
		} catch (err) {
			if (err.message.startsWith('Execution context was destroyed') || err.message.startsWith('Protocol error (browsingContext.navigate)')) {
				// pass
			} else {
				throw err;
			}
		} finally {
			page.on = puppeteer.Page.prototype.on;
			this.release(page);
		}
	}
};

function initScripts(page, list) {
	return Promise.all(list.map(args => {
		if (!args) return;
		if (typeof args == "function") args = [args];
		return page.evaluateOnNewDocument(...args);
	}));
}

function initStyles(css) {
	const sheet = new CSSStyleSheet();
	document.adoptedStyleSheets.push(sheet);
	return sheet.replace(css);
}
