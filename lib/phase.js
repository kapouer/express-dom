module.exports = class Phase {
	static SrcPolicies = new Set([
		'child',
		'connect',
		'default',
		'fenced-frame',
		'font',
		'frame',
		'img',
		'manifest',
		'media',
		'object',
		'script',
		'style',
		'worker'
	]);

	constructor(handler, req) {
		this.handler = handler;
		this.location = this.#absoluteURL(req);
		const headerVal = req.get(handler.constructor.header);
		this.online = headerVal == handler.online.header;
		this.offline = headerVal == handler.offline.header;
		this.visible = !this.online && !this.offline;
		const { visible, online, offline } = this.handler;

		let polset;
		this.settings = {};

		if (this.visible) {
			polset = visible;
			if (online.enabled && online.plugins.size) {
				this.settings = online;
			} else if (offline.enabled && offline.plugins.size) {
				this.settings = offline;
			}
		} else if (this.online) {
			polset = online;
			if (offline.enabled && offline.plugins.size) {
				this.settings = offline;
			}
		} else if (this.offline) {
			polset = offline;
		}
		this.policies = polset.policies;
	}

	#absoluteURL({ protocol, url, host }) {
		if (protocol == "about:") {
			return new URL(`about:${url}`);
		} else {
			return new URL(`${protocol}://${host}${url}`);
		}
	}

	#cspHeader(csp) {
		return Object.entries(csp).map(([key, val]) => {
			if (Phase.SrcPolicies.has(key)) {
				key += '-src';
			}
			return `${key} ${val}`;
		}).join('; ');
	}

	headers() {
		const obj = {};
		if (this.policies) {
			const csp = this.#cspHeader(this.policies);
			if (csp) obj["Content-Security-Policy"] = csp;
		}
		return obj;
	}
};
