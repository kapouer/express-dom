// if using webkitgtk native, run this example with `xfvb-run -a node append.js`
// a script tag is appended to head before the page is loaded

var express = require('express');
var app = express();
var dom = require('..');

app.set('views', 'public');
app.get('*.js', express.static('public'));

app.get('*.html',
	dom() // use static file as input
	.prepare(function(page) {
		// async event
		page.when('ready', function() {
			return page.run(function(src) {
					document.head.insertAdjacentHTML(
						'beforeend',
						`<script src="${src}"></script>`
					);
				},
				['append.js'] // parameters are passed as arguments
			);						 // never forget to call back
		});
	}) 					// load DOM without assets, do not run inline scripts either
	.load()			// load DOM and render
);

server = app.listen(process.env.PORT, function(err) {
	if (err) console.error(err);
	var port = server.address().port;
	console.log(`
		Call http://localhost:${port}/append.html
		to get see it change the dom using a plugin and the script inside append.html
	`);
});

