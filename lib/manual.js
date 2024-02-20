exports.ManualRequest = class ManualRequest {
	headers = {};
	constructor(req) {
		const loc = new URL(url);
		this.headers.host = loc.host;
		this.protocol = loc.protocol.slice(0, -1); // remove trailing colon
		this.url = loc.pathname + loc.search;
		this.path = loc.pathname;
	}
	get(key) {
		return this.headers[key];
	}
};

exports.ManualResponse = class ManualResponse {
	statusCode = 200;
	headers = {};
	sendStatus(code) {
		this.statusCode = code;
	}
	status(code) {
		this.statusCode = code;
	}
	send(str) {
		if (typeof str == "number") {
			this.status(str);
		} else {
			this.body = str;
		}
	}
	vary(header) {
	}
	set(headers, val) {
		if (typeof headers == "object") Object.assign(this.headers, headers);
		else if (typeof headers == "string") this.headers[headers] = val;
	}
};
