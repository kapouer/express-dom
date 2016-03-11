express-dom
===========

Express middleware (pre)rendering web pages in a hosted web browser.

Uses [node-webkitgtk](https://github.com/kapouer/node-webkitgtk)
which supports a fallback to [jsdom](https://github.com/tmpvar/jsdom)
when the c++ bindings are not builded - in which case some features
are disabled like pdf/png output.


## Synopsis

The simplest example for web page rendering is:

```js
var app = require('express')();
var dom = require('express-dom');

app.get('*.html', dom().load());

```

## Methods

All arguments are optional, see sections below.

* dom(view, helper1, helper2, ...)  
  `view` is resolved by a default helper, see below.  
  If empty, resolves to the current request express view file path.  
  Additional helper functions can return a promise, see below.  

* prepare(opts, plugin1, plugin2, ...)  
  Set options and/or plugins for DOM loading without running embedded
  scripts not loading resources.  
  Plugins are appended to the list of plugins (opts.plugins or default list).

* load(opts, plugin1, plugin2, ...)  
  Set options and/or plugins for DOM loading and runs embedded scripts;
  does not load resources by default.  
  Plugins are appended to the list of plugins (opts.plugins or default list).

These methods return an express middleware; they do nothing before the
middleware is actually called by express.


## Input and output

Custom helpers are run before the final helper, which resolves `settings.view`
into `settings.input` if not already done by a custom helper. Input is then
loaded into DOM by prepare or load methods, with `settings.location` as the
document location.

`view` can be a buffer, a readable stream, a string that starts with `<`,
or a local file path, or a remote url, or a parsed url object.

If it is a parsed url object, it is passed as argument for `http.request`,
so more options can be added to it.

If no input data can be resolved:
- if no prepare or load calls are done, the response is 501 Not Implemented
- else the response is 404 Not Found

The final express-dom handler does not send a response if
`settings.output === false`. If prepare or load methods weren't called,
output is equal to `settings.input`. See plugins source for examples.


## Options

The global default values for these options can be changed using `dom.settings`.
Phase-dependant settings can be specified globally using `dom.settings.prepare`
or `dom.settings.load`.

Each dom middleware handler created using dom() has also a copy `dom().settings`
and each phase also copies the associated global settings.

dom.settings.helpers holds the default helpers:
- dom.helpers.view

dom.settings.prepare.plugins holds the default plugins for preparing a page:
- dom.plugins.hide (display none, animate none)
- dom.plugins.noreq (disable all requests)
- dom.plugins.html

dom.settings.load.plugins holds the default plugins for loading a page:
- dom.plugins.hide
- dom.plugins.nomedia (allow only file extensions empty, js,  or ending with ml or json)
- dom.plugins.prerender (sets visibilityState)
- dom.plugins.redirect
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

A helper can change view, location, input, settings and call prepare or load,
depending on request.

It should avoid ending the response, and should instead return
`Promise.reject(val)`, which in turn calls `next(val)`, deferring the response
to the next middleware, route, or error handler.

A plugin can listen to page events, change settings before the page is loaded,
define input/output, access request/response.

`function helper(mw, settings, request, response) { ... }`
`function plugin(page, settings, request, response) { ... }`

* mw  
  the current dom middleware, like the one returned by `dom()`.  
  Exposes `prepare` and `load` methods.

* page  
  Plugins get a not yet loaded dom instance.

* settings  
  see above for general settings, and below for per-request settings.

* request, response  
  untampered express arguments

A plugin can return a promise if it needs to chain following plugins.

The page object is an emitter with two interfaces: the standard, synchronous,
`on`/`once` methods; and an asynchronous listener method `when`.  
Plugins can use `page.when('idle', function listener(cb) {})` method to ensure
their listener is executed asynchronously with respect to other plugins.

The last 'idle' listener being the internal handler that decides what to do
with `settings.output` as described above.

In a future version, `page.idle` will simply be a promise.

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


## Bundled plugins

This is a limited list of plugins, some are used by default:

* referrer  
  populates document.referrer using request.get('referrer')

* prerender  
  sets visibilityState to prerender, see below

* redirect  
  catch navigation and use it for redirection, see below

* noreq  
  blocks all requests

* hide  
  hides page and disable css transitions, animations

* png  
  outputs a screenshot of the rendered DOM (requires native webkitgtk)

More can be found in source code.

See also
[express-dom-pdf plugin](https://github.com/kapouer/express-dom-pdf)
which also shows that a helper can configure plugins by writing
`settings.load = {plugins: [mypluginA, mypluginB]};`.


## How client code can tell if it is being run on a hosted browser ?

The prerender plugin ensures that: `document.visibilityState == "prerender"`.

And it does no more than that.

It is enabled by default when using load(), and can be removed if needed.

See also:
* [Page visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
* [Load event handling when visible](https://github.com/kapouer/window-page/commit/49ec9ff0)

That last module is a facility for building pages on client which behaves well
with the notion of idempotent web page building and server prerendering, also
coined "isomorphic page rendering".


## Redirection when document.location is set on client

This behavior is implemented by the dom.plugins.redirect plugin.

When a web page loads, one of its script can set document.location.

When this happens, it triggers this behavior:
- location does not change to newLocation, and the page is simply unloaded
- res.redirect(302, newLocation) is called

This allows all the website routes to be defined by client code - the server
application just knows about static files, views, api, and auth - and how to
prerender web pages.

Important: due to current limitations in native webkitgtk, it is strongly
advised not to load an iframe when prerendering - it is confused with a location
change and triggers a redirect, something that is obviously undesirable.


## Debugging

Start with
`DEBUG=express-dom node app.js`

If NODE_ENV environment variable is not "production", and if `console` option
is not set, server-side browser console is logged to stdout / stderr.

To debug web pages,
`DEVELOP=1 node app.js`

This disables loading of the page on server,
and add *appended* load plugins to prepare plugins.


## Backends

The webkitgtk native bindings are slower to start, but faster and more resilient
on heavy loads, while jsdom is way faster to start, but eats more memory and
is slower, less stable on heavy loads. A planned feature is to allow switching
from one backend to the other easily.

Currently the jsdom backend is bundled into webkitgtk module, this might change
in future releases.


## License

MIT License, see LICENSE file.

