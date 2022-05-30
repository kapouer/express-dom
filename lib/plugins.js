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
		if (settings.output == null) {
			settings.output = await page.content();
		}
	});
};

exports.redirect = function (page, settings, req, res) {
	settings.filters.push(request => {
		if (request.isNavigationRequest()) {
			res.status(302);
			res.set('Location', request.url());
			debug("page redirected");
			return false;
		}
	});
};

exports.referrer = function(page, { headers }, req) {
	headers.Referer = req.get('Referer');
};

exports.prerender = async function (page, { policies }) {
	policies.script = policies.connect = "'self' 'unsafe-inline'";
	// document.hidden here for compatibility with old web api
	await page.addInitScript(`
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			get: function() { return "hidden"; }
		});
		Object.defineProperty(document, "hidden", {
			configurable: true,
			get: function() { return true; }
		});
	`);
};

exports.hide = async function (page, settings) {
	if (settings.hide === false) return;
	page.addStyleTag({
		content: `html {
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
		}`});
};

exports.cookies = function (page, settings, req) {
	const { cookies = [] } = req;
	if (cookies.length == 0) return;
	const { allowedCookies } = settings;
	const list = [];
	const names = [];
	for (const name in cookies) {
		if (allowedCookies == null || allowedCookies.has(name)) {
			names.push(name);
			list.push({
				name,
				value: cookies[name],
				domain: settings.location.host,
				path: '/'
			});
		}
	}
	debug("settings cookies", names);
	return page.context().addCookies(list);
};

exports.png = function (page, settings, req, res) {
	settings.hide = false;
	const { policies } = settings;
	policies.font = policies.img = "'self' https: data:";
	policies.style = "'self' 'unsafe-inline' https:";

	page.on('idle', async () => {
		settings.output = await page.screenshot({
			animations: false,
			fullPage: true,
			scale: "css",
			type: "png",
			timeout: 5000
		});
		res.set('Content-Type', 'image/png');
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
		if (statuses) delete equivs.Status;
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

exports.console = async function (page, settings) {
	await page.addInitScript(() => {
		document.addEventListener("securitypolicyviolation", e => {
			if (e.blockedURI == "inline") {
				console.warn(
					`Policy violation: inline in ${e.sourceFile}:${e.lineNumber}`
				);
			}
		});
	});
	if (settings.console) page.on('console', msg => {
		const secPolRe = /^Refused to .+ because it violates the following Content Security Policy directive:/;
		const [type, level] = {
			warning: ['warn', 3],
			log: ['log', 2],
			error: ['error', 4],
			info: ['info', 1],
			trace: ['log', 2]
		}[msg.type()];
		if (type && (settings.console === true || settings.console <= level)) {
			const text = msg.text();
			if (type != "error" || secPolRe.test(text) == false) {
				// eslint-disable-next-line no-console
				console[type](text);
			}
		}
	});
};
