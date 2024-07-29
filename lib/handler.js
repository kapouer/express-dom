const { Pool } = require('lightning-pool');
const { chromium } = require('playwright-core');
const debug = require('debug')('express-dom');
const clone = require('clone');
const { randomUUID } = require('node:crypto');
const which = require('which');
const { IncomingMessage } = require('node:http');

const Phase = require('./phase');
const plugins = require('./plugins');
const routers = require('./routers');
const RequestTracker = require('./request-tracker');
const asyncTracker = require('./async-tracker');
const customTracker = require('./custom-tracker');
const asyncEmitter = require('./async-emitter');
const { ManualRequest, ManualResponse } = require('./manual');

class PoolFactory {
	#opts;
	#browser;
	constructor(browser, opts) {
		this.#browser = browser;
		this.#opts = opts;
	}

	async create() {
		const context = await this.#browser.newContext(this.#opts);
		return context.newPage();
	}

	async destroy(page) {
		await page.context().close();
	}

	async validate(page) {
		// each used page must be thrown
		throw new Error();
	}
}

module.exports = class Handler {
	static executable = null;
	static browser = 'chrome';
	static debug = process.env.PWDEBUG == 1;

	static header = 'Sec-Purpose';

	static #pools = [];
	static #browser;
	static plugins = plugins;
	static routers = routers;
	static defaults = {
		cookies: new Set(),
		log: process.env.NODE_ENV != "production" ? "info" : "error",
		timeout: process.env.PWDEBUG == 1 ? 0 : 10000,
		page: {
			ignoreHTTPSErrors: true,
			serviceWorkers: 'block'
		},
		pool: {
			max: 10,
			min: 2,
			minIdle: 2,
			maxQueue: 100,
			acquireTimeoutMillis: 15000,
			validation: true
		}
	};
	static pools = [{
		visible: false,
		pool: {
			...this.defaults.pool
		},
		page: {
			...this.defaults.page,
			deviceScaleFactor: 1
		}
	}, {
		visible: true,
		pool: {
			...this.defaults.pool
		},
		page: {
			...this.defaults.page,
			deviceScaleFactor: 1
		}
	}, {
		visible: true,
		pool: {
			...this.defaults.pool
		},
		page: {
			...this.defaults.page,
			deviceScaleFactor: 2
		}
	}, {
		visible: true,
		pool: {
			...this.defaults.pool
		},
		page: {
			...this.defaults.page,
			deviceScaleFactor: 4
		}
	}];
	static offline = {
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
			'cookies',
			'html'
		])
	};
	static online = {
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
		plugins: new Set([
			'console',
			'hidden',
			'cookies',
			'media',
			'redirect',
			'referrer',
			'html'
		])
	};
	static visible = {
		policies: {}
	};

	#router;

	constructor(conf = {}) {
		this.plugins = clone(Handler.plugins);
		for (const phase of ['offline', 'online', 'visible']) {
			this[phase] = Object.assign(
				clone(Handler.defaults),
				clone(Handler[phase]),
				conf[phase]
			);
		}
		if (typeof conf == "function") {
			conf(this);
		}
		this.chain = (...args) => this.middleware(...args);
	}

	#init() {
		if (!Handler.#browser) {
			Handler.#browser = this.#initBrowser();
		}
	}

	route(fn) {
		this.#router = fn;
		return this.chain;
	}

	static async destroy() {
		for (const pool of Handler.#pools) {
			await pool.close(true);
		}
		await Handler.#browser.close();
		Handler.#pools = [];
		Handler.#browser = null;
	}

	async #initBrowser() {
		const expath = Handler.executable ?? await which('chromium', { nothrow: true }) ?? await which('google-chrome', { nothrow: true });
		const opts = {
			channel: Handler.browser,
			executablePath: expath,
			devtools: false, //Handler.debug,
			timeout: Handler.defaults.timeout / 2,
			args: [
				'--force-color-profile=srgb',
				'--deterministic-mode',
				'--disable-gpu',
				'--headless=new'
			]
		};
		Handler.#browser = await chromium.launch(opts);
	}

	async acquire(scale = 1, visible) {
		const def = Handler.pools.find(
			conf => conf.visible == visible && conf.page.deviceScaleFactor == scale
		);

		if (!def) throw new Error("No pool has scale: " + scale);
		if (!Handler.#browser) {
			this.#initBrowser();
		}
		await Handler.#browser;
		const pool = def.instance ??= new Pool(
			new PoolFactory(Handler.#browser, def.page), def.pool
		);
		const page = await pool.acquire();
		page.pool = pool;
		return page;
	}

	async release(page) {
		const { pool } = page;
		delete page.pool;
		await pool.release(page);
	}

	async middleware(req, res, next) {
		this.#init();
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

		phase.settings = clone(phase.settings);
		phase.policies = clone(phase.policies);

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
		const { location, settings } = phase;
		const page = await this.acquire(settings.scale, phase.visible);

		if (Array.isArray(settings.plugins)) {
			settings.plugins = new Set(settings.plugins);
		}

		page.location = location;

		for (const plugin of settings.plugins) {
			const fn = this.plugins[plugin];
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

		const errListener = err => console.error(err);

		page.on('crash', errListener);
		page.on('pageerror', errListener);

		page.once('response', response => {
			const code = response.status();
			if (code != 200 && res.statusCode == 200) {
				res.status(code);
			}
		});

		await page.route(str => str == url, route => {
			if (req instanceof ManualRequest && req.body) {
				return route.fulfill({
					status: req.status,
					body: req.body,
					headers: req.headers
				});
			} else {
				const headers = {
					...route.request().headers(),
					[Handler.header]: settings.header
				};
				return route.continue({ headers });
			}
		}, { times: 1 });

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

		let closeListener;

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
					closeListener = () => resolve('close');
					page.on('close', closeListener);
				})
			]);
			if (event == "timeout") {
				debug("page timeout", url);
				throw new Error('Page timeout');
			} else if (event == "close") {
				debug("page closed", url);
			} else if (event == "idle") {
				debug("page idle", url);
				await asyncEmitter(page, 'idle');
			} else {
				debug("page stale", url);
				throw new Error('Page stale');
			}
		} finally {
			page.off('crash', errListener);
			page.off('pageerror', errListener);
			if (closeListener) page.off('close', closeListener);
			this.release(page).catch(err => {
				console.error(err);
			});
		}
	}
};





function initScripts(page, list) {
	return Promise.all(list.map(args => {
		if (!args) return;
		if (typeof args == "function") args = [args];
		return page.addInitScript(...args);
	}));
}

function initStyles(css) {
	const sheet = new CSSStyleSheet();
	document.adoptedStyleSheets.push(sheet);
	return sheet.replace(css);
}
