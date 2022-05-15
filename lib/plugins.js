const debug = require('debug')('express-dom');

exports.types = function types(page, settings) {
	settings.filters.push(request => {
		return settings.types.has(request.resourceType());
	});
};

exports.domain = function cors(page, settings) {
	const { domain } = settings;
	if (domain == "none") settings.filters.push(() => false);
	else if (domain == "same") settings.filters.push(request => {
		const pageUrl = new URL(page.url());
		const url = new URL(request.url());
		return pageUrl.hostname == url.hostname;
	});
};

exports.absolute = function absolute(page) {
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

exports.mount = function mount(page) {
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

exports.html = async function(page, settings, request, response) {
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

exports.referrer = function(page, settings, req) {
	const referrer = req.get('Referer');
	if (referrer) page.route(settings.location.toString(), async (route, request) => {
		const headers = await request.allHeaders();
		route.continue({
			headers: {
				...headers,
				referrer
			}
		});
	});
};

exports.prerender = async function(page, settings) {
	await page.addInitScript(`
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			get: function() { return "prerender"; }
		});
	`);
};

exports.hide = async function hide(page, settings) {
	if (settings.hide === false) return;
	await page.addInitScript(`
		Object.defineProperty(document, "hidden", {
			configurable: true,
			get: function() { return true; }
		});
	`);
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
	settings.types.delete('stylesheet');
	settings.types.delete('image');
	settings.types.delete('font');
};

exports.cookies = function cookies(page, settings, request) {
	const { cookies } = request;
	const { allowedCookies } = settings;
	const list = [];
	const names = [];
	for (const name in cookies) {
		if (allowedCookies == null || allowedCookies.has(name)) {
			names.push(name);
			cookies.push({ name, value: cookies[name] });
		}
	}
	debug("settings cookies", names);
	return page.context().addCookies(list);
};

exports.png = function png(page, settings, request, response) {
	settings.hide = false;
	settings.types.add('image');
	settings.types.add('stylesheet');
	settings.types.add('font');

	page.on('idle', async () => {
		settings.output = await page.screenshot({
			animations: false,
			fullPage: true,
			scale: "css",
			type: "png",
			timeout: 5000
		});
		response.set('Content-Type', 'image/png');
	});
};

exports.httpequivs = function(page, settings, request, response) {
	page.on('idle', async () => {
		const equivs = await page.evaluate(() => {
			const equivs = {};
			for (const node of document.querySelectorAll('head > meta[http-equiv]')) {
				const list = (node.content || '').split(',');
				let vals = equivs[node.httpEquiv];
				if (!vals) vals = equivs[node.httpEquiv] = new Set();
				for (const str of list) {
					if (vals.includes(str) == false) vals.add(str);
				}
				node.remove();
			}
			return equivs;
		});
		if (equivs.Status?.length) {
			delete equivs.Status;
			const code = parseInt(status.pop());
			// the list of authorized Status codes
			if (!Number.isNaN(code) && [200, 301, 302, 400, 401, 403, 404, 451, 500].indexOf(code) >= 0) {
				response.status(code);
			} else {
				// eslint-disable-next-line no-console
				console.warn("express-dom got http-equiv Status with invalid value", status);
			}
		}
		for (const [name, equiv] of Object.entries(equivs)) {
			let vals = response.get(name);
			if (!vals) {
				vals = new Set();
			} else if (typeof vals == "string") {
				vals = new Set([vals]);
			}
			for (const str of equiv) {
				vals.add(str);
			}
			response.set(name, Array.from(vals).join(','));
		}
	});
};

exports.httplinkpreload = function(page, settings, request, response) {
	page.on('idle', async () => {
		const links = await page.evaluate(() => {
			const loc = document.location;
			return Array.from(
				document.querySelectorAll('link[href][rel="stylesheet"],script[src]')
			).map((node) => {
				const url = new URL(node.href || node.src, loc);
				const remote = url.host != loc.host;
				return {
					as: node.nodeName == "LINK" ? "style" : "script",
					href: remote ? url.href : url.pathname + url.search,
					remote: remote,
					crossOrigin: node.crossOrigin
				};
			});
		});
		if (links.length) response.append('Link', links.map((obj) => {
			const nopush = obj.remote ? ';nopush' : '';
			const crossOrigin = obj.crossOrigin ? ';crossorigin=' + obj.crossOrigin : '';
			return `<${obj.href}>;rel=preload;as=${obj.as}` + nopush + crossOrigin;
		}).join(','));
	});
};

