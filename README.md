express-dom
===========

Express middleware rendering web pages in a hosted web browser.

Works with [node-webkitgtk](https://github.com/kapouer/node-webkitgtk),
which falls back to jsdom in case webkitgtk bindings are not buildable.

# Demo

This is an example of a service that renders a given url, remove all scripts,
and change all src, href attributes to their absolute versions:

http://html.eda.sarl/?url=http://material-ui.com/

(result is cached)

# Synopsis

```js
var app = require('express')();
var dom = require('express-dom');

app.set('statics', __dirname + '/public');
app.get('*.*',
	express.static(app.get('statics')),
	function(req, res, next) {
		console.info("File not found", req.path);
		res.sendStatus(404);
	}
);
app.get('/mypage.html', dom.preload('mypage').use('insertion', linkInsertPlugin));
app.get('/mypage', dom.load('mypage').use('absolutize', absoluteLinksPlugin));
```

# Example

See sample application in example/ dir.

# API

* dom.preload(static file | html string | buffer, opts)  
  loads the argument into a DOM, without loading any of its assets.  
  When all plugins are done, serializes the DOM and send it to the response.  
  returns a middleware function.

* dom.load(static file | html string | buffer, opts)  
  loads the argument in a DOM and let scripts from the same domain run.  
  When all plugins are done, and `idle` event (see webkitgtk) is reached,
  serializes the DOM and send it to the response.  
  returns a middleware function.

* dom.settings  
  object passed to webkitgtk init(settings) function, of particular
  interest are the `display` and `debug` options. See *webkitgtk* docs.  
  It can also set webkitgtk instances pool settings, see *generic-pool* docs.

* .use(<name>, plugin), .unuse(name | function)
  Where plugin(page) and page is a webkitgtk instance.  
  An optional name can be given, for book keeping.  
  Chainable helper that adds or remove a plugin from .plugins array.  
  The two methods and the array are available on the middleware function,
  and on the two global scopes dom.load, dom.build.

The options passed to dom.load or dom.build are directly passed to the
.preload or .load functions of webkitgtk:
- images are not loaded automatically, disable with {images: true}
- document is not rendered, disable with {style: "" }
- stylesheets are not loaded, disable with .unuse('nostylesheets') called
on mw to disable it for that request, or dom.build to disable it globally.


# handling redirections

When a web page loads, one of its script can set the document location to a
new url.
Express-dom handles this by simply:
- forbidding the redirection
- sending 302 <newurl> to the response

This behavior covers most use-cases of isomorphic web pages.


# Usage

```js
dom.author(aGlobalAuthorPlugin);

app.get('/mypage', dom.load('myview').use(function(page) {
	page.on('request', function(req) {
		// do not wait for socket.io xhr requests responses to emit idle
		if (req.uri.indexOf('socket.io') > 0) req.ignore = true;
	});
	page.wait('ready').run(function(param, done) {
	  // this runs in the browser
	  var allimages = document.querySelectorAll('img');
	  Array.prototype.slice.call(allimages).forEach(function(node) {
			node.setAttribute('data-src', node.src);
			node.src = null;
		});
		done(null, allimages.length);
	}, "someconfig", function(err, countImages) {
	  // this runs in the node process
	  done(err);
	});
}));
```

# Debugging

It should be possible to display the webkitgtk inspector (if the bindings are
available of course): set environment variable INSPECTOR to something not empty,
like `INSPECTOR=1 node app.js`, which in turn sets `dom.settings.debug` to true.


# Use cases

The wiki discusses some use cases for building isomorphic web pages.


# License

MIT License, see LICENSE file.

