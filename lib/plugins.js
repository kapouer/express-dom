const debug = require('debug')('express-dom');

exports.absolute = function (page) {
	page.on('idle', () => {
		return page.evaluate(() => {
			const dloc = document.location;
			const base = dloc.protocol + '//' + dloc.host;
			const nodes = [
				['a', 'href'],
				['img', 'src'],
				['video', 'src'],
				['object', 'src'],
				['link', 'href'],
				['script', 'src'],
				['include', 'src']
			];
			for (const [sel, att] of nodes) {
				for (const node of document.querySelectorAll(sel)) {
					const item = node.attributes.getNamedItem(att);
					if (!item) continue;
					const uloc = new URL(item.nodeValue, base);
					item.nodeValue = uloc.href;
				}
			}
		});
	});
};

exports.mount = function (page) {
	page.on('idle', () => {
		return page.evaluate(() => {
			const dloc = document.location;
			const base = dloc.protocol + '//' + dloc.host;
			const nodes = [
				['a', 'href'],
				['img', 'src'],
				['video', 'src'],
				['object', 'src'],
				['link', 'href'],
				['script', 'src'],
				['include', 'src']
			];
			for (const [sel, att] of nodes) {
				for (const node of document.querySelectorAll(sel)) {
					const item = node.attributes.getNamedItem(att);
					if (!item) continue;
					const val = item.nodeValue;
					if (!val || val.charAt(0) == '#') continue;
					const uloc = new URL(val, base);
					if (uloc.protocol == dloc.protocol && uloc.host == dloc.host) {
						item.nodeValue = uloc.pathname + uloc.search + uloc.hash;
					}
				}
			}
		});
	});
};

exports.html = async function (page, settings, req, res) {
	page.on('idle', async () => {
		debug("html plugin idle");
		if (!res.headersSent) {
			res.set('Content-Type', 'text/html');
			res.send(await page.content());
		}
	});
};

exports.redirect = function (page, settings, req, res) {
	// when supported, use settings.policies['navigate-to'] = "'none'";
	page.on('request', async request => {
		if (page.url() == "about:blank") return;
		if (request.isNavigationRequest()) {
			const loc = request.url();
			res.status(302);
			res.set('Location', loc);
			res.end();
			return request.abort();
		}
	});
};

exports.referrer = exports.referer = function(page, settings, req) {
	settings.referer = req.get('Referer');
};

exports.hidden = async function (page, { hidden, scripts, styles }) {
	if (hidden === false) return;
	// document.hidden here for compatibility with old web api
	scripts.push(() => {
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			get: function () { return "hidden"; }
		});
		Object.defineProperty(document, "hidden", {
			configurable: true,
			get: function () { return true; }
		});
	});
	styles.push(`html {
		display:none !important;
	}
	* {
		-webkit-transition:none !important;
		transition:none !important;
		-webkit-transition-property: none !important;
		transition-property: none !important;
		-webkit-transform: none !important;
		transform: none !important;
		-webkit-animation: none !important;
		animation: none !important;
	}`);
};

exports.cookies = async function (page, settings, req) {
	const context = page.browserContext();
	context.deleteCookie(...await context.cookies());
	const { cookies: allows } = settings;
	const { cookies } = req;
	if (!cookies || allows === false || allows.size === 0) return;
	const list = [];
	for (const [name, value] of Object.entries(cookies)) {
		if (allows === true || allows.has(name)) {
			debug("cookie allowed", name);
			list.push({
				name,
				value,
				domain: page.location.host,
				path: '/'
			});
		}
	}
	if (list.length) await context.setCookie(...list);
};

exports.png = function (page, settings, req, res) {
	settings.hide = false;
	page.on('idle', async () => {
		res.set('Content-Type', 'image/png');
		res.send(await page.screenshot({
			animations: false,
			fullPage: true,
			scale: "css",
			type: "png",
			timeout: 5000
		}));
	});
};

exports.equivs = function (page, settings, req, res) {
	page.on('idle', async () => {
		const equivs = await page.evaluate(keepList => {
			const equivs = {};
			for (const node of document.querySelectorAll('head > meta[http-equiv]')) {
				const name = node.httpEquiv;
				if (node.content) {
					const list = node.content.split(',');
					if (!equivs[name]) equivs[name] = [];
					const vals = equivs[name];
					for (const str of list) {
						const tstr = str.trim();
						if (!vals.includes(tstr)) vals.push(tstr);
					}
				}
				if (!keepList.includes(name)) node.remove();
			}
			return equivs;
		}, settings.equivs ?? []);
		const statuses = equivs.Status;
		delete equivs.Status;
		if (statuses?.length) {
			const status = statuses.pop();
			const code = parseInt(status);
			// the list of authorized Status codes
			if (!Number.isNaN(code) && [200, 301, 302, 400, 401, 403, 404, 451, 500].indexOf(code) >= 0) {
				res.status(code);
				const text = status.substring(String(code).length).trim();
				if (text.length) res.statusText = text;
			} else {
				// eslint-disable-next-line no-console
				console.warn("express-dom got http-equiv Status with invalid value", status);
			}
		}
		for (const [name, equiv] of Object.entries(equivs)) {
			const header = res.get(name) ?? [];
			const headerList = Array.isArray(header) ? header : [header];
			const list = new Set(equiv);
			for (const str of headerList) {
				for (const item of str.split(',')) list.add(item.trim());
			}
			res.set(name, Array.from(list).join(', '));
		}
	});
};

exports.languages = function (page, settings, req, res) {
	const { headers } = settings;
	const header = req.get('Accept-Language');
	if (header) headers['Accept-Language'] = header;
	page.on('idle', async () => {
		const lang = await page.evaluate(() => document.documentElement.lang);
		if (lang) res.set('Content-Language', lang);
		res.vary('Accept-Language');
	});
};


exports.preloads = function (page, settings, req, res) {
	page.on('idle', async () => {
		const links = await page.evaluate(() => {
			const loc = document.location;
			return Array.from(
				document.head.querySelectorAll('link[rel="preload"]')
			).map(node => {
				node.remove();
				const url = new URL(node.href, loc);
				const remote = url.host != loc.host;
				const nopush = remote ? ';nopush' : '';
				const href = remote ? url.href : url.pathname + url.search;
				const cross = node.crossOrigin ? ';crossorigin=' + node.crossOrigin : '';
				return `<${href}>;rel=preload;as=${node.as}` + nopush + cross;
			}).join(',');
		});
		if (links.length) res.append('Link', links);
	});
};

exports.console = async function (page, { policies, log, scripts}) {
	if (Object.keys(policies).length > 1 || policies.default != "'none'") {
		scripts.push(() => {
			document.addEventListener("securitypolicyviolation", e => {
				if (e.blockedURI == "inline") {
					if (e.violatedDirective == "style-src-attr" && document.hidden) {
						// leave it
					} else console.warn(
						`Policy violation: inline in ${e.sourceFile}:${e.lineNumber}`
					);
				}
			});
		});
	}
	if (!log) return;

	const levels = {
		warning: ['warn', 3],
		warn: ['warn', 3],
		log: ['log', 2],
		error: ['error', 4],
		info: ['info', 1],
		trace: ['log', 2]
	};
	const [, minLevel] = log === true ? [null, 0] : levels[log];
	page.on('console', msg => {
		let msgType = msg.type();
		if (!levels[msgType]) {
			console.error("Unknown message type", msgType);
			msgType = 'error';
		}
		const [type, level] = levels[msgType];
		if (type && minLevel <= level) {
			const text = msg.text();
			if (type != "error" || !page.isCSPError(text)) {
				// eslint-disable-next-line no-console
				console[type](text);
			}
		}
	});
};

exports.media = async function (page, { media }) {
	await page.emulateMediaType(media);
};
