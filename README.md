express-dom
===========

Express middleware rendering web pages in a hosted web browser.

Uses [node-webkitgtk](https://github.com/kapouer/node-webkitgtk)
which supports a fallback to [jsdom](https://github.com/tmpvar/jsdom)
when the c++ bindings are not builded - in which case some features
are disabled like pdf/png output.

The webkitgtk bindings are slower to start, but faster and more resistant
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

All arguments are optional.

* dom(view, helper1, helper2, ...)  
  `view` is a buffer, a Readable stream, a string that starts with &lt;
  or a local file path, that are resolved to input data.  
  If empty, resolves to the pathname constructed from the current request and
  the 'views' app setting.  
  Helpers can be added or even replace the `view` parameter, and can return a
  promise. The last helper parses settings.view only if settings.input is null.  
  dom() returns a middleware that expect (req, res, next).  
  If no other methods are called, the middleware just sends the input data.  

* .prepare(opts, plugin1, plugin2, ...)  
  load the DOM but no embedded scripts are run, and no assets are loaded.  
  All arguments are optional. See below for description.  
  Function plugin argument(s) are appended to the default list of plugins,
  or to the list given in opts.plugins.

* .load(opts, plugin1, plugin2, ...)  
  load the DOM and run the scripts.  
  All arguments are optional. See below for description.  
  Function plugin argument(s) are appended to the default list of plugins,
  or to the list given in opts.plugins.

## Options

The global default values for these options can be changed using `dom.settings`.
Phase-dependant settings can be specified globally using `dom.settings.prepare`
or `dom.settings.load`.

Each dom middleware handler created using dom() has also a copy `dom().settings`
and each phase also copies the associated global settings.

dom.settings.prepare.plugins holds the default plugins for preparing a page:
- dom.plugins.noreq (disable all requests)
- dom.plugins.html

dom.settings.load.plugins holds the default plugins for loading a page:
- dom.plugins.nomedia (allow only file extensions empty, js,  or ending with ml or json)
- dom.plugins.redirect,
- dom.plugins.html

More plugins are provided, please check the source code.

Replace default list of plugins by setting the `plugins` option:
`dom('index').load({plugins: [dom.plugins.html]})`

Prepend plugins to the default list using additional arguments:
`dom(index).load({pool: {max:2}}, dom.plugins.mount)`

Note that 

`.load({plugins: [myplugin]})` is the same as `.load({plugins:[]}, myplugin)`.

More on plugins below.

* plugins  
  sets the list of plugins, can be a single function.

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
  boolean, console on stdout / stderr, or quiet

* runTimeout  
  milliseconds before a script run by a plugin is considered dead.

...more options are documented in `webkitgtk` module.


## Plugins and helpers

A helper can change view, location, input depending on request - would rarely
need to change the response, but can return a failed promise that will be
passed as next(err).

A plugin can listen to page events, change settings before the page is loaded,
define input/output, access request/response.

`function helper(settings, request, response) { ... }`
`function plugin(page, settings, request, response) { ... }`

* page  
  Plugins get a not yet loaded dom instance.

* settings  
  see above for general settings, and below for per-request settings.

* request, response  
  untampered express arguments

A plugin can return a promise, however pay attention that
`page.when(event, listener)` itself chain a listener;
the last 'idle' listener being the internal handler that decides
what to do with `settings.output`.

A few options are added to settings:

* settings.view  
  only for helpers

* settings.location  
  parsed url that will be used to set document location;  
  and defaults to the current request url.

* settings.input  
  the data obtained from the view or the view itself if it was given as data.

* settings.output  
  If `output !== false`, express-dom writes or pipe it to the response.  
  A plugin can set response status, `output` and let other plugins change it,
  or can directly handle response and set `output` to false (or do nothing).


## Plugins tricks

It is possible to leverage the hosted browser (webkitgtk or jsdom) options to:

* load cookies in it

* execute a script with arguments, before page scripts, using  
  ```settings.script = {
  	fn: function(arg1, ...) {},
  	args: [arg1, ...]
  };```

* add additional request filters  
  ```settings.filters.push(function() {
  	if (this.uri == "/test"; this.cancel = true;
  })```

* change a setting before page is loaded


## Examples

Here a script tag is added on the DOM before the page is loaded:

```js
var app = require('express')();
var dom = require('express-dom');

dom.settings.display = "99"; // optional, here we already had a xvfb server

app.get('*.html',
	dom() // use static file as input
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
More can be found in examples/ directory.


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

If NODE_ENV environment variable is not "production", and if `console` option
is not set, server-side browser console is logged to stdout / stderr.

To debug web pages,
`DEVELOP=1 node app.js`

This disables loading of the page on server,
and add *appended* load plugins to prepare plugins.


## License

MIT License, see LICENSE file.

