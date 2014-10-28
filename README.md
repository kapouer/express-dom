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
app.get('/mypage', dom('myview'));
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

Pages represent browser instances (and are webkitgtk views for now).

* dom(view name or url)  
	create an handler instance that will use the view or url to load the initial
	web page that is going to be modified.

* dom.use(mw)  
	where `mw(handler, req, res, next)` or `mw(page, next)` if `mw.length == 2`  
	sets up a plugin that will be called before every page loads its content.

* handler.use(mw)  
  sets up a plugin that will be called before or after this page loads its content,
	depending on the position of the call w.r.t. handler.open()

* handler.open()  
	tells to actually load the content into the page.

* handler.page  
	the actual browser page instance (a `webkitgtk` instance).

handler.open can be omitted, it is implied after the last call to handler.use.


# Usage

```js
dom.use(expressDomMinify);

app.get('/mypage', dom('myview').use(routePlugin).open().use(function(page, next) {
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
dom.use(minify);
app.get('/mypage', dom('myview'));
app.get('/myotherpage', dom('myotherview'));
```
is the same as
```js
app.get('/mypage', dom('myview').use(minify));
app.get('/myotherpage', dom('myotherview').use(minify));
```

Real world example

```js
var dom = require('express-dom');
var minify = require('express-dom-minify');
var procrastify = require('express-dom-procrastify');
var archive = require('express-dom-archive');

dom({display: '1024x768x24:99'}).use(minify);

app.get('/mypage', dom('myview').open().use(procrastify));
app.get('/mypage.png', dom('myview').open().use(function(handler, req, res, next) {
	handler.page.png(res);
}));
app.get('/mypage.tar.gz', dom('myview').open().use(archive));

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


# License

MIT License, see LICENSE file.

