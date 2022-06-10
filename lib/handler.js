const { BrowserPool, PlaywrightPlugin } = require('browser-pool');
const { chromium } = require('playwright-core');
const debug = require('debug')('express-dom');
const clone = require('clone');
const { randomUUID } = require('node:crypto');

const plugins = require('./plugins');
const RequestTracker = require('./request-tracker');
const tracker = require('./client-tracker');
const asyncEmitter = require('./async-emitter');
const { ManualRequest, ManualResponse } = require('./manual');


module.exports = class Handler {
	static pageMax = 20;
	static pageUse = 200;
	static browser = 'chrome';
	static debug = process.env.PWDEBUG == 1;

	static #pool;
	static plugins = plugins;
	static defaults = {
		cookies: new Set(),
		console: process.env.NODE_ENV != "production" ? "info" : "error",
		timeout: process.env.PWDEBUG == 1 ? 0 : 10000,
		scale: 1
	};
	static offline = {
		policies: {
			default: "'none'"
		},
		enabled: false,
		styles: [],
		scripts: [],
		plugins: new Set([
			'console',
			'hidden',
			'html'
		])
	};
	static online = {
		policies: {
			default: "'none'",
			script: "'self' 'unsafe-inline'",
			connect: "'self'"
		},
		enabled: !process.env.DEVELOP,
		styles: [],
		scripts: [],
		plugins: new Set([
			'console',
			'hidden',
			'cookies',
			'redirect',
			'referrer',
			'html'
		])
	};

	#helper;
	#settings;

	constructor(helper) {
		if (typeof helper == 'function') {
			this.#helper = helper;
		} else {
			this.#settings = helper ?? {};
		}
		this.chain = (...args) => this.middleware(...args);
	}

	#init() {
		if (!Handler.#pool) Handler.#pool = new BrowserPool({
			browserPlugins: [new PlaywrightPlugin(chromium, {
				maxOpenPagesPerBrowser: Handler.pageMax,
				retireBrowserAfterPageCount: Handler.pageUse,
				useIncognitoPages: true, // each page can have its cookies
				launchOptions: {
					channel: Handler.browser,
					devtools: Handler.debug,
					timeout: Handler.timeout / 2
				}
			})],
		});
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
		const online = Object.assign(
			clone(Handler.defaults),
			clone(Handler.online)
		);
		const offline = Object.assign(
			clone(Handler.defaults),
			clone(Handler.offline)
		);
		const location = getAbsoluteUrl(req);

		const plugins = clone(Handler.plugins);

		if (this.#helper) {
			await this.#helper({
				location, online, offline, plugins
			}, req, res);
		} else if (this.#settings) {
			Object.assign(offline, this.#settings.offline);
			Object.assign(online, this.#settings.online);
		}
		if (Array.isArray(online.plugins)) {
			online.plugins = new Set(online.plugins);
		}
		if (Array.isArray(offline.plugins)) {
			offline.plugins = new Set(offline.plugins);
		}

		const phase = location.searchParams.get('develop');
		const runOn = online.enabled && online.plugins.size > 0;
		const runOff = offline.enabled && offline.plugins.size > 0;

		const inner = {
			phase: null,
			opts: null,
			csp: null
		};

		if (phase === null) {
			// run online or directly offline phase
			if (runOn) {
				inner.phase = '';
				inner.opts = online;
			} else if (runOff) {
				inner.opts = offline;
				inner.csp = online.policies;
				inner.phase = 'source';
			}
		} else if (phase === "source") {
			// run source phase
			inner.csp = offline.policies;
		} else {
			// run offline or directly source phase
			inner.csp = online.policies;
			if (runOff) {
				inner.phase = 'source';
				inner.opts = offline;
			}
		}

		if (inner.csp) {
			res.set('Content-Security-Policy', buildPolicies(inner.csp));
		}
		if (!inner.opts) {
			next();
		} else {
			location.searchParams.set('develop', inner.phase);
			if (Handler.debug) inner.opts.timeout = 0;
			await this.runMethod(plugins, location, inner.opts, req, res);
		}
	}

	async runMethod(plugins, loc, settings, req, res) {
		const page = await Handler.#pool.newPage({
			pageOptions: {
				ignoreHTTPSErrors: true,
				deviceScaleFactor: settings.scale ?? 1
			}
		});

		const {
			scripts, styles, timeout, referer
		} = settings;

		page.location = loc;

		for (const plugin of settings.plugins) {
			const fn = plugins[plugin];
			if (!fn) {
				throw new Error(`plugin not found: ${plugin}`);
			}
			await fn(page, settings, req, res);
		}
		const url = page.location.toString();

		page.on('crash', err => console.error(err));
		page.on('pageerror', err => console.error(err));

		page.once('response', response => {
			const code = response.status();
			if (code != 200 && res.statusCode == 200) {
				res.status(code);
			}
		});

		const reqTrack = new RequestTracker(page);

		const fnid = 'signal_' + randomUUID();
		await initScripts(page, [
			[tracker, fnid],
			styles.length > 0 ? [initStyles, styles.join('\n')] : null
		].concat(scripts));

		try {
			await page.goto(url, {
				waitUntil: 'domcontentloaded',
				timeout, referer
			});
			debug("page loaded");

			const event = await Promise.race([
				Promise.all([
					page.evaluate(id => window[id], fnid),
					reqTrack
				]).then(() => 'idle'),
				new Promise(resolve => {
					setTimeout(() => resolve('timeout'), timeout);
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

function getAbsoluteUrl({ protocol, headers, url }) {
	if (protocol == "about:") {
		return new URL(`about:${url}`);
	} else {
		return new URL(`${protocol}://${headers.host}${url}`);
	}
}

function buildPolicies(pol) {
	return Object.entries(pol).map(([key, val]) => {
		if (!['sandbox'].includes(key)) {
			key += '-src';
		}
		return `${key} ${val}`;
	}).join('; ');
}

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
