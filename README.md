express-dom
===========

Express middleware rendering web pages in a hosted web browser.

Uses [node-webkitgtk](https://github.com/kapouer/node-webkitgtk)
which supports a fallback to [jsdom](https://github.com/tmpvar/jsdom)
when the c++ bindings are not builded - in which case some features
are disabled like pdf/png output.

The webkitgtk bindings are slower to jumpstart, but faster and more resistant
on heavy loads, while jsdom is way faster to start, but eats more memory and
is slower, less stable on heavy loads. A planned feature is to allow switching
from one backend to the other easily.


## Synopsis

The simplest example for web page rendering is:

```js
var app = require('express')();
var dom = require('express-dom');

app.get('*.html', dom().load());

```

## Methods

* dom(input*)  
  a buffer, a Readable stream, a string that starts with &lt;, or a local file path.  
  If empty, uses current request to find local file path from app statics dir.  
  Returns a middleware that expect (req, res, next).  
  If no other methods are called, the middleware just sends that content.

* .prepare(opts?, plugin, ...)  
  load the DOM but no embedded scripts are run, and no assets are loaded.  
  All arguments are optional. See below for description.  
  Function plugin argument(s) are appended to the default list of plugins,
  or to the list given in opts.plugins.

* .load(opts?, plugin, ...)  
  load the DOM and run the scripts.  
  All arguments are optional. See below for description.  
  Function plugin argument(s) are appended to the default list of plugins,
  or to the list given in opts.plugins.

* dom.acquire(page, cb*)  
  global method, called internally, exposed for convenience.

* dom.release(page, cb*)  
  global method, called internally, exposed for convenience.  


## Options

The global default values for these options can be changed using `dom.settings`.
each dom middleware handler created using dom() has also a copy `dom().settings`.

* plugins  
  sets the list of plugins, can be a single function. See below.

* pool.max  
  the maximum number of instances in the pool

* pool.destroyTimeout  
  destroys pages that have not been used for that long milliseconds

* pool.idleTimeout  
  unloads pages that have not been used for that long milliseconds

Other options are passed directly to webkitgtk, like these ones:

* display  
  like X DISPLAY env variable

* stall  
  milliseconds before a resource is no more taken into account for idle event

* console  
  boolean, console on stdout or not

* runTimeout  
  milliseconds before a script run by a plugin is considered dead.

...more options are documented in `webkitgtk` module.


## Plugins

This is the default list of plugins:

```
plugins: [dom.plugins.nocss, dom.plugins.redirect, dom.plugins.html]

```

More plugins are provided, please check the source code.

It is possible to replace it entirely by setting the `plugins` option:
`dom('index').load({plugins: [dom.plugins.html]})`

or one can append plugins to the list using additional arguments:
`dom(index).load({pool: {max:2}}, dom.plugins.mount)`

A plugin is function that can do anything on the page instance, its settings
before it is loaded, and on the state object used to send the result to the
response:

`function myplugin(page, settings, state) { ... }`

The settings have the expected format above,
and the state is an object with the following keys:

* location  
  the current request url components (protocol, host, pathname, query)  
  Can be modified by plugins, `URL.format(state.location)` will be used as
  the document location.

* data  
  the response data, can be a buffer, a Readable stream, a string starting
  with &lt;, or a local file path.

* headers  
  the response headers, defaults to Content-Type: text/html.

* status  
  optional response status code


## Examples

Here a script tag is added on the DOM before the page is loaded:

```js
var app = require('express')();
var dom = require('express-dom');

dom.settings.display = "99"; // optional, here we already had a xvfb server

app.get(
	dom('index.html')		// initialize handler and set html source
	.prepare(function(page) {
		// async event
		page.when('ready', function(cb) {
			page.run(function(src) {
					document.head.insertAdjacentHTML('beforeend', `<script src="${src}"></script>`);
				},
				['/js/test.js'], // parameters are passed as arguments
				cb
			);						 // never forget to call back
		});
	}) 					// load DOM without assets, do not run inline scripts either
	.load()			// load DOM and render
);

```


Here a PDF is sent as output instead of HTML (requires webkitgtk bindings):

```js
var app = require('express')();
var dom = require('express-dom');

app.set('statics', 'public');

app.get(
	dom().load({plugins: dom.plugins.png})
);

```

Note that 

`.load({plugins: [myplugin]})` is the same as `.load({plugins:[]}, myplugin)`.


## Redirection when document.location is set from a script in the page

This behavior is implemented by the dom.plugins.redirect plugin.

When a web page loads, one of its script can set document.location.

When this happens, it triggers this behavior:
- location does not change to newLocation, and the page is simply unloaded
- res.redirect(302, newLocation) is called

This behavior covers most use-cases of isomorphic web pages, see
the wiki for more information.


## Debugging

Start with
`DEBUG=express-dom node app.js`

A non-empty DEBUG environment value will log browser console to stdout.

To debug the web page itself, settting environment variable `DEVELOP=1` will
disable .load() calls, meaning pages are not rendered, nor custom plugins applied.


## License

MIT License, see LICENSE file.

