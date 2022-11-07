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
	page.route('**', async (route, request) => {
		if (page.url() == "about:blank") return route.continue();
		if (request.isNavigationRequest()) {
			const loc = request.url();
			res.status(302);
			res.set('Location', loc);
			res.end();
			return route.abort();
		} else {
			return route.continue();
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

exports.cookies = function (page, settings, req) {
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
	return page.context().addCookies(list);
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
		const equivs = await page.evaluate(() => {
			const equivs = {};
			for (const node of document.querySelectorAll('head > meta[http-equiv]')) {
				const list = (node.content || '').split(',');
				const name = node.httpEquiv;
				if (!equivs[name]) equivs[name] = [];
				const vals = equivs[name];
				for (const str of list) {
					if (!vals.includes(str)) vals.push(str);
				}
				node.remove();
			}
			return equivs;
		});
		const statuses = equivs.Status;
		delete equivs.Status;
		if (statuses?.length) {
			const status = statuses.pop();
			const code = parseInt(status);
			// the list of authorized Status codes
			if (!Number.isNaN(code) && [200, 301, 302, 400, 401, 403, 404, 451, 500].indexOf(code) >= 0) {
				res.status(code);
			} else {
				// eslint-disable-next-line no-console
				console.warn("express-dom got http-equiv Status with invalid value", status);
			}
		}
		for (const [name, equiv] of Object.entries(equivs)) {
			const header = res.get(name);
			const list = new Set(equiv);
			if (typeof header == "string") {
				list.add(header);
			} else if (Array.isArray(header)) {
				for (const item of header) list.add(item);
			}
			const str = Array.from(list).join(',');
			res.set(name, str);
		}
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
		log: ['log', 2],
		error: ['error', 4],
		info: ['info', 1],
		trace: ['log', 2]
	};
	const [, minLevel] = log === true ? [null, 0] : levels[log];
	page.on('console', msg => {
		const secPolRe = /^Refused to .+ because it violates the following Content Security Policy directive:/;
		const [type, level] = levels[msg.type()];
		if (type && minLevel <= level) {
			const text = msg.text();
			if (type != "error" || secPolRe.test(text) == false) {
				// eslint-disable-next-line no-console
				console[type](text);
			}
		}
	});
};

exports.media = async function (page, { media }) {
	if (media) {
		await page.emulateMedia(media);
	}
};
