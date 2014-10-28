express-dom
===========

The basic idea is that all the web page is built on client browser,
but we want servers to be able to produce indexable, readable without javascript,
documents (in html but also png, pdf formats).

`express-dom` is a simple, secure, fast, and extensible way of building
html pages on server, with client code.

# Synopsys

```js
var app = require('express')();
var dom = require('express-dom');

app.get('/mypage', dom('myview'));
```


# API

dom.use(middleware) return dom
dom(view) return instance
instance.open() loads the view into DOM, return instance
instance.use(middleware) chains middleware, return instance

dom.open(view) is the same as dom(view).open()

when open() is omitted, it is implicitely called
`dom(view).use(mw)` is equivalent to `dom(view).use(mw).open()`

middleware(req, res, next) where req.page is the (webkitgtk) client.
when use(mw).open(), mw can set req.page.options, which will be used to load
the client page:
page.load(req.url, page.options)
when open().use(mw), mw can act upon req.page and call itself res.send.

If res.send is not called (this implies that `next` is called instead)
the last dom middleware output the page's inner html.


# Middleware

```js
app.get('/mypage', dom('myview').open().use(function(req, res, next) {
	req.page.run(function(done) {
		// manipulate the DOM. Mind that this function must be serializable,
		// in particular its parent scope will be the window object in the page
		$("img").forEach(function(node) {
			node.setAttribute('data-src', node.src);
			node.src = null;
		});
	}, function(err, obj) {
		// calls last dom middleware, which in turn calls res.send with the page html string
		next(err);
	});
}));
```


# Plugins

`dom.use(myplugin)` declares that `myplugin(req, res, next)` is going to be
called as soon as an uninitialized view is available for the current request.

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

app.get('/mypage', dom.open('myview').use(procrastify));
app.get('/mypage.png', dom.open('myview').use(function(page, next) {
	req.page.png(res);
}));
app.get('/mypage.tar.gz', dom.open('myview').use(archive));

```


# MVC done right

* Model  
  the HTTP Backend, which is called only authentication and by XHR requests made
  from inside the web pages.

* View  
	the HTML/CSS chosen by server to be rendered to the client.  
	In particular, there is no server code to develop for any given view, only client code.

* Controller  
	JavaScript on client.

This architecture works all right as long as your tools allow this workflow:

1. open view
2. modify view
3. serialize view
4. cache and transmit to clients
5. deserialize view
6. update view

