exports.png = function (phase, req, res) {
	if (phase.online) {
		Object.assign(phase.policies, {
			img: "'self' https: data:",
			font: "'self' https: data:",
			style: "'self' 'unsafe-inline' https:"
		});
		phase.plugins.remove('html');
		phase.plugins.add('png');
	}
};
