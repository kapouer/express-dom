const stream = require('stream');
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

exports.html = function html(page, settings, request, response) {
	page.when('idle', () => {
		debug("html plugin idle");
		if (settings.output == null) return page.html().then((str) => {
			settings.output = str;
		});
	});
};

exports.redirect = function redirect(page, settings, request, response) {
	page.once('navigate', (uri) => {
		response.status(302);
		response.set('Location', uri);
	});
};

exports.referrer = function referrer(page, settings, request) {
	const ref = request.get('Referer') || "";
	settings.scripts.push({
		fn: function(ref) {
			Object.defineProperty(document, "referrer", {
				configurable: true,
				get: function() { return ref; }
			});
		},
		args: [ref]
	});
};

exports.noreq = function noreq(page, settings) {
	settings.allow = "none";
	settings['auto-load-images'] = false;
};

exports.prerender = function prerender(page, settings) {
	settings.scripts.push(() => {
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			get: function() { return "prerender"; }
		});
		Object.defineProperty(document, "hidden", {
			configurable: true,
			get: function() { return true; }
		});
	});
};

exports.hide = function hide(page, settings) {
	// also avoid transitions
	settings.style = `
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
		}`;
};

exports.nomedia = function nomedia(page, settings) {
	settings['auto-load-images'] = false;
	settings.filters.push(function() {
		if (this.uri.startsWith("data:")) return;
		const path = (new URL(this.uri, document.location)).pathname;
		if (!path) return;
		const basename = path.split("/").pop();
		if (!basename) return;
		const parts = basename.split(".");
		if (parts.length <= 1) return;
		const ext = parts.pop().toLowerCase();
		if (ext.endsWith("json")) return;
		if (ext.endsWith("ml")) return;
		if (ext == "js" || ext == "mjs") return;
		this.cancel = true;
	});
};

exports.cookies = function(whitelist) {
	return function cookies(page, settings, request) {
		let cookies = request.cookies || {};
		let keys = Object.keys(cookies);
		if (whitelist) keys = keys.filter((name) => {
			return whitelist[name];
		});
		debug("settings cookies", keys);
		cookies = keys.map((name) => {
			return name + ' = ' + cookies[name] + "; Path=/";
		});
		if (!cookies.length) return;
		settings.cookies = cookies;
	};
};

exports.png = function png(page, settings, request, response) {
	settings['auto-load-images'] = true;
	settings.style = null;
	const pass = new stream.PassThrough();
	page.when('idle', () => {
		return page.png(pass);
	}).then(() => {
		response.set('Content-Type', 'image/png');
		settings.output = pass;
	});
};

exports.httpequivs = function httpequivs(page, settings, request, response) {
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

exports.httplinkpreload = function httplinkpreload(page, settings, request, response) {
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

