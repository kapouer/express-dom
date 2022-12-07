module.exports = class Phase {

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

	#absoluteURL({ protocol, headers, url }) {
		if (protocol == "about:") {
			return new URL(`about:${url}`);
		} else {
			return new URL(`${protocol}://${headers.host}${url}`);
		}
	}

	#cspHeader(csp) {
		return Object.entries(csp).map(([key, val]) => {
			if (!['sandbox', 'form-action'].includes(key)) {
				key += '-src';
			}
			return `${key} ${val}`;
		}).join('; ');
	}

	headers() {
		if (this.policies) {
			const csp = this.#cspHeader(this.policies);
			if (csp) return {
				'Content-Security-Policy': csp
			};
		}
	}
};
