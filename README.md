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
app.get('/mypage', dom('myview').edit(minify).use(absolutify));
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

Three objects: dom, route handlers, pages.

A page is (url, html string) loaded in a browser instance.
Middlewares can modify the page's DOM in two different ways:

1. editor - only the DOM is loaded - no scripts and no external resources
   page.run() is available and can be used to modify the html before actually
   loading the page.
2. user - the html obtained from previous step is loaded as a web page
   and middleware is called somewhere between loading and interactive states.


* dom(view name or url, options)  
  create an handler instance that will use the view or url to load the initial
  web page that is going to be modified.  
  Options are passed to the user webkitgtk instance, and can be modified by
  user plugins. The editor instance has no configurable options.

* dom.edit(mw), dom.use(mw)  
  where `mw(handler, req, res, next)` or `mw(page, next)` if `mw.length == 2`  
  it adds middlewares that will be installed on every handlers.

* dom.edits, dom.uses  
  the arrays populated by previous methods.

* handler.use(mw)  
  adds a user middleware.

* handler.edit(mw)  
  adds an editor middleware  
  if there are none, the DOM is directly loaded as user.

* handler.edits, handler.uses  
  the arrays populated by previous methods.

* handler.page  
  the actual browser page instance (a `webkitgtk` instance).

* handler.options  
  the user page loading options (see `webkitgtk` load options).

By default, only *.js files from the same domain (in a broad sense) are
loaded.
To load any *.js files, simply set `options.allow = "all";`.
To load any files, just remove the first middleware in handler.uses.


# Usage

```js
dom.use(expressDomMinify);

app.get('/mypage', dom('myview').use(function(page, next) {
	page.run(function(done) {
		// manipulate the DOM. Mind that this function must be serializable,
		// in particular its parent scope will be the window object in the page
		$("img").forEach(function(node) {
			node.setAttribute('data-src', node.src);
			node.src = null;
		});
	}, function(err, obj) {
		// proceed to usual html outpu
		next(err);
	});
}));
```


```js
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

dom({display: '1024x768x24:99'}).edit(minify);

app.get('/mypage', dom('myview').use(procrastify));
app.get('/mypage.png', dom('myview').use(function(h, req, res, next) {
	h.page.png(res);
}));
app.get('/mypage.tar.gz', dom('myview').use(archive));

```


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

1. open page
2. run page in express-dom
3. output to string
4. cache and transmit to clients
5. run page in client
6. update page with new data received in the client


# Authentication and autorizations

In this kind of MVC, authentication is done as usual by interacting with
the HTTP backend, a user session is established and a session cookie can
be obtained by the client.



# License

MIT License, see LICENSE file.

