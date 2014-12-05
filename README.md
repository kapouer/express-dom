express-dom
===========

Extensible web page builder proxy with client browser environment for express.

1. design an empty web page that builds itself using javascript and backends,
   in a full browser environment.
2. express-dom acts as a proxy that runs the page in a browser and returns
   the formed html to user agents.
3. combine with plugins to optimize, modify, get error reports, convert to pdf
   or png, cache and synchronize using websockets, and more...


# Synopsis

```js
var app = require('express')();
var dom = require('express-dom');
app.get('/mypage', dom('myview').author(minify).use(absolutify));
```

# Gotchas

* allows transformation of any legacy website on the fly - public or admin, like
ad-hoc improvement of any existing CMS.

* User authentication and permissions are managed by backends (typically by a
users backend).

* Server code can be written for a given web page route, but the right way is
to only write client code that runs in the browser web page.

* The server mainly deals with choosing which url loads which initial html, 
which plugins are activated on a given route, and in which format the web page
is outputed (html, pdf, png).

* The proxy doesn't destroy web pages that have xhr or ws connections open,
in a configurable limit. This allows instantaneous updates of generated content,
and efficient hot caching.


# API

The API is chainable.

Three objects: route handlers, plugins, pages.

A page is (url, html string) loaded in a browser instance.
Plugins can modify the page's DOM in two different ways:

1. author - only the DOM is loaded - no scripts and no external resources
   page.run() is available and can be used to modify the html before actually
   loading the page.
2. user - the html obtained from previous step is loaded as a web page
   and the plugin is called as soon as the page starts populating its DOM.

* dom.settings  
  object passed to webkitgtk init(settings) function, of particular
  interest are the `display` and `debug` options. See *webkitgtk* docs.  
  It can also set webkitgtk instances pool settings, see *generic-pool* docs.

* dom(view name or url, options)  
  create an handler instance that will use the view or url to load the initial
  web page that is going to be modified.  
  Options are passed to the user webkitgtk instance, and can be modified by
  user plugins. The author instance has no configurable options.

* dom.author(plugin), dom.use(plugin)  
  where `plugin(handler, req, res)` returns immediately.  
  sets plugins on all future handler instances.

* dom.authors, dom.users  
  the arrays populated by previous methods.

* handler.use(plugin)  
  adds a user plugin.

* handler.author(plugin)  
  adds an author plugin  
  if there are none, the DOM is directly loaded as user.

* handler.authors, handler.users  
  the arrays populated by previous methods.

* handler.page  
  the actual browser page instance (a `webkitgtk` instance).

* handler.options  
  the user page loading options (see `webkitgtk` load options).

Important: plugins make use of webkitgtk API to change the page.

They return immediately, but the final plugin that actually outputs something
to express response is supposed to be called on 'ready' or 'idle' page events.

By default, only *.js files from the same domain (in a broad sense) are
loaded.


# Usage

```js
dom.use(expressDomMinify);

app.get('/mypage', dom('myview').use(function(h) {
	h.page.wait('ready').run(function(done) {
		// manipulate the DOM. Mind that this function must be serializable,
		// in particular its parent scope will be the window object in the page
		$("img").forEach(function(node) {
			node.setAttribute('data-src', node.src);
			node.src = null;
		});
	});
}));
```


```js
dom.settings.display = 99;
dom.use(translate);
app.get('/mypage', dom('myview'));
app.get('/myotherpage', dom('myotherview'));
```
is the same as
```js
app.get('/mypage', dom('myview').use(translate));
app.get('/myotherpage', dom('myotherview').use(translate));
```

Real world example

```js
var dom = require('express-dom');
var minify = require('express-dom-minify');
var procrastify = require('express-dom-procrastify');
var archive = require('express-dom-archive');

dom.author(minify);

app.get('/mypage', dom('myview').use(procrastify));
app.get('/mypage.png', dom('myview').use(function(h, req, res) {
	h.page.wait('idle').png(res);
}));
app.get('/mypage.tar.gz', dom('myview').use(archive));

```

# Plugins

Some plugins are available by default in dom.plugins, others as separate
node modules.
Note that `dom.plugins.nomedia` is enabled by default - it should be removed
when calling page.png, page.pdf, or when acting upon any request that is not
html or javascript.


# Debugging

To show a webview with inspector, set environment variable DEBUG to something
not empty, like `DEBUG=1 node app.js`, to set `dom.settings.debug` to true.


# MVC done right

* Model  
  the HTTP Backends, called by authentication and XHR requests made
  from inside the web pages.

* View  
	HTML, CSS, and JS that populates the view are all running on the web page.  
	Only client code.

* Controller  
	The logic that binds routes to views and plugins, manages how output is
	cached, send messages to views and so on.

This architecture works all right as long as your tools allow this workflow:

0. load initial html
1. install js modules, make global DOM modifications
2. cache resulting model
3. load model
4. run it
5. output to string
6. cache and transmit to clients
7. run page in client
8. update page with new data received in the client


# Authentication and autorizations

In this kind of MVC, authentication is done as usual by interacting with
the HTTP backend, a user session is established and a session cookie can
be obtained by the client.


# License

MIT License, see LICENSE file.

