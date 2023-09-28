const { BrowserPool, PlaywrightPlugin } = require('@crawlee/browser-pool');
const { chromium } = require('playwright-core');
const debug = require('debug')('express-dom');
const clone = require('clone');
const { randomUUID } = require('node:crypto');

const Phase = require('./phase');
const plugins = require('./plugins');
const routers = require('./routers');
const RequestTracker = require('./request-tracker');
const asyncTracker = require('./async-tracker');
const customTracker = require('./custom-tracker');
const asyncEmitter = require('./async-emitter');
const { ManualRequest, ManualResponse } = require('./manual');


module.exports = class Handler {
	static executable = "/usr/bin/chromium";
	static pageMax = 20;
	static pageUse = 200;
	static browser = 'chrome';
	static debug = process.env.PWDEBUG == 1;

	static header = 'Sec-Purpose';

	static #pool;
	static plugins = plugins;
	static routers = routers;
	static defaults = {
		cookies: new Set(),
		log: process.env.NODE_ENV != "production" ? "info" : "error",
		timeout: process.env.PWDEBUG == 1 ? 0 : 10000,
		scale: 1
	};
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
		const launchOptions = {
			channel: Handler.browser,
			executablePath: Handler.executable,
			devtools: Handler.debug,
			timeout: Handler.timeout / 2,
			args: [
				'--force-color-profile=srgb',
				'--deterministic-mode',
				'--disable-gpu'
			]
		};
		if (process.env.PLAYWRIGHT_CHROMIUM_USE_HEADLESS_NEW) {
			launchOptions.args.push('--headless=new');
		}
		if (!Handler.#pool) Handler.#pool = new BrowserPool({
			useFingerprints: false,
			browserPlugins: [new PlaywrightPlugin(chromium, {
				maxOpenPagesPerBrowser: Handler.pageMax,
				retireBrowserAfterPageCount: Handler.pageUse,
				useIncognitoPages: true, // each page can have its cookies
				launchOptions
			})],
		});
	}

	route(fn) {
		this.#router = fn;
		return this.chain;
	}

	static async destroy() {
		await Handler.#pool.destroy();
		Handler.#pool = null;
	}

	async middleware(req, res, next) {
		this.#init();
		if (typeof req == "string") {
			debug("Called in manual mode");
			req = new ManualRequest(req);
			res = req.res = new ManualResponse();
		}
		try {
			await this.runMiddleware(req, res, next);
			if (res instanceof ManualResponse) {
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
		const page = await Handler.#pool.newPage({
			pageOptions: {
				ignoreHTTPSErrors: true,
				deviceScaleFactor: settings.scale ?? 1,
				serviceWorkers: 'block'
			}
		});

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

		page.on('crash', err => console.error(err));
		page.on('pageerror', err => console.error(err));

		page.once('response', response => {
			const code = response.status();
			if (code != 200 && res.statusCode == 200) {
				res.status(code);
			}
		});

		await page.route(str => str == url, route => {
			const headers = {
				...route.request().headers(),
				[Handler.header]: settings.header
			};
			route.continue({ headers });
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
				await asyncEmitter(page, 'idle');
			} else {
				debug("page stale", url);
				throw new Error('Page stale');
			}
		} finally {
			if (!page.isClosed()) await page.close();
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
