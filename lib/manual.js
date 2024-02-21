const { PassThrough } = require('node:stream');

exports.ManualRequest = class ManualRequest {
	headers = { 'Content-Type': 'text/html' };
	status = 200;
	constructor(req) {
		if (typeof req == "string") {
			req = { url: req };
		} else if (req.body) {
			this.body = req.body;
		}
		const loc = new URL(req.url);
		this.headers.host = loc.host;
		this.protocol = loc.protocol.slice(0, -1); // remove trailing colon
		this.url = loc.pathname + loc.search;
		this.path = loc.pathname;
	}
	get(key) {
		return this.headers[key];
	}
};

exports.ManualResponse = class ManualResponse extends PassThrough {
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
	get(header) {
		return this.headers[header.toLowerCase()];
	}
	set(headers, val) {
		if (typeof headers == "object") {
			for (const [key, str] of Object.entries(headers)) {
				this.headers[key.toLowerCase()] = str;
			}
		} else if (typeof headers == "string") {
			this.headers[headers.toLowerCase()] = val;
		}
	}
	attachment(str) {
		let header = 'attachment';
		if (str) header += '; filename="' + str + '"';
		this.set('content-disposition', header);
	}
	append(header, val) {
		const prev = this.get(header);
		if (prev) val = prev + ', ' + val;
		this.set(header, val);
	}
	type(str) {
		this.set('content-type', str);
	}
};
