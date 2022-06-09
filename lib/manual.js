exports.ManualRequest = class ManualRequest {
	headers = {};
	constructor(url) {
		const loc = new URL(url);
		this.headers.host = loc.host;
		this.protocol = loc.protocol;
		this.url = loc.pathname + loc.search;
		this.path = loc.pathname;
	}
	get(key) {
		return this.headers[key];
	}
};

exports.ManualResponse = class ManualResponse {
	statusCode = 200;
	sendStatus(code) {
		this.statusCode = 200;
	}
	send(str) {
		this.body = str;
	}
};
