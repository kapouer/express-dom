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

class Browsers {
	#opts;
	#browsers = new Map();
	#pools;

	constructor(opts, pools) {
		this.#opts = opts;
		this.#pools = pools;
	}

	async get(browser) {
		let inst;
		if (!this.#browsers.has(browser)) {
			const opts = {
				browser,
				acceptInsecureCerts: true,
				devtools: false, //Handler.debug,
				protocol: 'webDriverBiDi'
			};
			Object.assign(opts, this.#opts.browsers[browser]);
			const launching = puppeteer.launch(opts);
			this.#browsers.set(browser, launching);
			inst = await launching;
			inst.on('disconnected', () => {
				console.error("express-dom browser is disconnected", browser);
				this.del(browser);
			});
		} else {
			inst = await this.#browsers.get(browser);
		}
		return inst;
	}

	async del(browser) {
		const inst = await this.#browsers.get(browser);
		this.#browsers.delete(browser);
		const pools = this.#pools;
		for (const [key, pool] of pools.entries()) {
			if (key.split(' ')[0] == browser) {
				pools.delete(key);
				try {
					await pool.close(Infinity);
				} catch {
					// don't care
				}
			}
		}
		try {
			await inst.close();
		} catch {
			// don't care
		}
	}

	async destroy() {
		const browsers = this.#browsers;
		for (const key of browsers.keys()) {
			await this.del(key);
		}
	}
}

class PoolFactory {
	#opts;
	#browser;
	#browsers;

	constructor(browsers, browser, opts) {
		this.#browsers = browsers;
		this.#browser = browser;
		this.#opts = opts;
	}

	async create() {
		const browser = await this.#browsers.get(this.#browser);
		const context = await browser.createBrowserContext(this.#opts);
		const page = await this.#page(context);
		return { context, page };
	}

	async destroy(inst) {
		const { context } = inst;
		if (!context) return;
		delete inst.page;
		delete inst.context;
		try {
			await context.close();
		} catch (err) {
			console.error("express-dom destroy error", err);
		}
	}

	async reset(inst) {
		if (!inst.context) return;
		const { page } = inst;
		try {
			const previous = await page.cookies();
			await page.deleteCookie(...previous.map(cookie => {
				return {
					name: cookie.name
				};
			}));
		} catch (err) {
			if (err.name != "TargetCloseError") {
				console.error("error deleting cookies", err);
			}
		}
		try {
			await page.close();
		} catch (err) {
			console.error("express-dom reset error", err);
		}
		inst.page = await this.#page(inst.context);
	}

	async #page(context) {
		const page = await context.newPage();
		await page.setViewport({
			width: 640,
			height: 480,
			deviceScaleFactor: this.#opts.devicePixelRatio
		});
		return page;
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
			min: 1,
			minIdle: 1,
			maxQueue: 100,
			fifo: false,
			acquireMaxRetries: 1,
			acquireTimeoutMillis: 15000,
			idleTimeoutMillis: 600000,
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
					'--disable-gpu'
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
			hidden: true,
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
			hidden: true,
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
	static #browsers;
	static #pools = new Map();

	static init() {
		if (!this.#browsers) {
			this.#browsers = new Browsers(this.defaults, this.#pools);
		}
	}

	#router;

	constructor(conf = {}) {
		Handler.init();
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
		try {
			await Handler.#browsers.destroy();
		} catch (err) {
			console.error("express-dom destroy error", err);
		}
	}

	async acquire(browser, devicePixelRatio) {
		const pools = Handler.#pools;
		const key = `${browser} ${devicePixelRatio}`;
		let pool;
		if (!pools.has(key)) {
			pool = new Pool(
				new PoolFactory(Handler.#browsers, browser, {
					...this.opts.page,
					devicePixelRatio
				}), { ...this.opts.pool }
			);
			pool.start();
			pools.set(key, pool);
		} else {
			pool = pools.get(key);
		}
		const inst = await pool.acquire();
		inst.pool = pool;
		const { regpol } = this.opts.browsers[browser];
		inst.page.isCSPError = str => {
			return regpol.test(str);
		};
		return inst;
	}

	async release(inst) {
		try {
			inst.page.removeAllListeners();
			await inst.pool.release(inst);
			delete inst.pool;
		} catch (err) {
			console.error("express-dom release error", err);
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
		const inst = await this.acquire(browser, devicePixelRatio);
		const { page } = inst;
		try {
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
				if (!page.isCSPError(err)) console.error("express-dom page error", err);
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
				if (request.isInterceptResolutionHandled()) return;
				if (!request.isNavigationRequest()) {
					request.continue();
				} else if (req instanceof ManualRequest && req.body) {
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

			await initScripts(page, inits.concat(scripts));
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
			if (res.headersSent) {
				// pass
			} else {
				throw err;
			}
		} finally {
			page.on = puppeteer.Page.prototype.on;
			this.release(inst);
		}
	}
};

function initScripts(page, list) {
	return Promise.all(list.map(args => {
		if (!args) return;
		if (typeof args == "function") args = [args];
		return page.evaluateOnNewDocument(...args);
	}).filter(x => x != null));
}

function initStyles(css) {
	const sheet = new CSSStyleSheet();
	document.adoptedStyleSheets.push(sheet);
	return sheet.replace(css);
}
