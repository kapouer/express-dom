const stream = require('node:stream');
const { once } = require('node:events');
const debug = require('debug')('express-dom');

exports.absolute = function absolute(page) {
	page.when('ready', () => {
		return page.run(() => {
			const dloc = document.location;
			const base = dloc.protocol + '//' + dloc.host;
			function absolut(selector, att) {
				const list = document.querySelectorAll(selector);
				let node;
				for (let i = 0; i < list.length; i++) {
					node = list.item(i);
					const item = node.attributes.getNamedItem(att);
					if (!item) continue;
					const uloc = new URL(item.nodeValue, base);
					item.nodeValue = uloc.href;
				}
			}
			absolut('a', 'href');
			absolut('img', 'src');
			absolut('video', 'src');
			absolut('object', 'src');
			absolut('link', 'href');
			absolut('script', 'src');
			absolut('include', 'src');
		});
	});
};

exports.mount = function mount(page) {
	page.when('ready', () => {
		return page.run(() => {
			const dloc = document.location;
			const base = dloc.protocol + '//' + dloc.host;
			function mount(selector, att) {
				const list = document.querySelectorAll(selector);
				let node;
				for (let i = 0; i < list.length; i++) {
					node = list.item(i);
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
			mount('a', 'href');
			mount('img', 'src');
			mount('video', 'src');
			mount('object', 'src');
			mount('link', 'href');
			mount('script', 'src');
			mount('include', 'src');
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

exports.redirect = function (page, settings, request, response) {
	page.route(/.*/, (route, request) => {
		if (request.isNavigationRequest()) {
			response.status(302);
			response.set('Location', request.url());
			route.abort('aborted');
		} else {
			route.continue();
		}
	});
};

exports.referrer = function(page, settings, request) {
	const referrer = request.get('Referer') ?? "";
	if (referrer) page.route(settings.location.toString(), route => {
		route.continue({
			headers: {
				...request.headers(),
				referrer
			}
		});
	});
};

exports.noreq = function noreq(page, settings) {
	page.route(/.*/, route => {
		route.abort();
	});
};

exports.prerender = async function(page, settings) {
	// await page.addInitScript(`
	// 	Object.defineProperty(document, "visibilityState", {
	// 		configurable: true,
	// 		get: function() { return "prerender"; }
	// 	});
	// 	Object.defineProperty(document, "hidden", {
	// 		configurable: true,
	// 		get: function() { return true; }
	// 	});
	// `);
};

exports.hide = function hide(page, settings) {
	// also avoid transitions
	page.addStyleTag({
		content: `
		html {
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

exports.nomedia = function nomedia(page) {
	page.route(/.*/, (route, request) => {
		const accept = [
			"document",
			"script",
			"xhr",
			"fetch"
		].includes(request.resourceType());
		if (accept) {
			route.continue();
		} else {
			route.abort(404);
		}
	});
};

exports.cookies = function (whitelist) {
	return function cookies(page, settings, request) {
		const { cookies } = request;
		const list = [];
		const names = [];
		for (const name in cookies) {
			if (!whitelist || whitelist[name]) {
				names.push(name);
				cookies.push({ name, value: cookies[name] });
			}
		}
		debug("settings cookies", names);
		return page.context().addCookies(list);
	};
};

exports.png = function png(page, settings, request, response) {
	throw new Error("TODO");
	/*
	settings['auto-load-images'] = true;
	settings.style = null;
	const pass = new stream.PassThrough();
	page.when('idle', () => {
		return page.png(pass);
	}).then(() => {
		response.set('Content-Type', 'image/png');
		settings.output = pass;
	});
	*/
};
exports.httpequivs = function () { };
exports.httpequivs2 = function(page, settings, request, response) {
	page.when('idle', () => {
		return page.run(() => {
			const equivs = {};
			const nodes = Array.from(document.querySelectorAll('head > meta[http-equiv]'));
			nodes.forEach((node) => {
				const list = (node.content || '').split(',');
				let vals = equivs[node.httpEquiv];
				if (!vals) vals = equivs[node.httpEquiv] = [];
				list.forEach((str) => {
					if (vals.includes(str) == false) vals.push(str);
				});
				node.remove();
			});
			return equivs;
		}).then((equivs) => {
			let status = equivs.Status;
			if (status && status.length) {
				delete equivs.Status;
				status = status.pop();
				const code = parseInt(status);
				// the list of authorized Status codes
				if (!Number.isNaN(code) && [200, 301, 302, 400, 401, 403, 404, 451, 500].indexOf(code) >= 0) {
					response.status(code);
				} else {
					// eslint-disable-next-line no-console
					console.warn("express-dom got http-equiv Status with invalid value", status);
				}
			}
			Object.keys(equivs).forEach((name) => {
				let vals = response.get(name);
				if (!vals) vals = [];
				else if (!Array.isArray(vals)) vals = [vals];
				equivs[name].forEach((str) => {
					if (!vals.includes(str)) vals.push(str);
				});
				response.set(name, vals.join(','));
			});
		});
	});
};

exports.httplinkpreload = function () { };
exports.httplinkpreload2 = function(page, settings, request, response) {
	page.when('idle', () => {
		page.run(() => {
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
		}).then((links) => {
			if (links.length) response.append('Link', links.map((obj) => {
				const nopush = obj.remote ? ';nopush' : '';
				const crossOrigin = obj.crossOrigin ? ';crossorigin=' + obj.crossOrigin : '';
				return `<${obj.href}>;rel=preload;as=${obj.as}` + nopush + crossOrigin;
			}).join(','));
		});
	});
};

