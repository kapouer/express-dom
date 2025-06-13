# express-dom

Express middleware for (pre)rendering web pages using real browsers.

## Synopsis

```js
const express = require('express');
const app = express();
const dom = require('express-dom');

app.get('*.html', dom(), express.static('public/'));
```

To do rendering outside express middleware:

```js
// obj can be a url string, or an IncomingMessage,
// or an object with { url, status?, headers?, body? } properties
// status defaults to 200, headers to { Content-Type: 'text/html' }

const res = await dom()(obj);
const { statusCode, headers, body } = res;
```

A page is requested by a browser for three purposes:

- offline: hidden offline web page changed by outside scripts.
  This phase can't fetch resources and doesn't run page own scripts.
- online: hidden online web page built by its own scripts. Typical prerendering,
  can be done on the server, or delegated to the user browser.
- visible: fully rendered page, usually happens on the user browser,
  or on server for pdf/png rendering. See also express-dom-pdf.

Each phase has its own set of plugins, named after the `plugins` settings map.

Plugins can change page settings before the page is loaded,
and can run scripts when the page is 'idle'.

A phase is skipped if it has no registered plugins.

The 'idle' event is emitted on the `page` instance after DOMContentLoaded,
and after requests have settled and custom or default tracker has resolved.

The listeners of the 'idle' event are asynchronous and run serially.

## Options

dom.defaults holds defaults settings, see source code.

Mind that policies of the requesting phase are obtained from settings of the responding phase: route handler cannot change policies of current phase.

CSP names that end with `-src` can be written without that suffix.

## tracker

The tracker is experimental, it is best to use a custom tracker.

Set `[phase].track` setting to a custom async function that resolves when the page is ready.

If phase setting `track` is true, the default tracker waits for async operations:

- loading of script/link nodes
- DOMContentLoaded listeners
- fetch, xhr calls
- timeouts (capped by page timeout)
- animation frame requests
- microtasks

When `track` is false, the idle event just wait for first batch of files to be loaded.

## Changing settings

Change `dom.defaults` for all instances and phases, otherwise,
pass an object to `dom(opts)` that will be merged with the defaults.

It is also possible to pass a function to `dom(mycustomconfig)` that
will receive the `(opts, { plugins, routers })` as argument.

## Phase settings

Configuration depending on the route and the phase can be set using a router function accepting (phase, req, res) as argument.

```js
dom().route((phase, req, res) => {
  // change phase.settings.plugins depending on req and phase.online/offline/visible
}) // returns the express middleware
```

phase has the following properties:

- visible, online, offline: booleans, purpose of the requesting phase
- settings: current phase settings
- policies: requesting phase policies
- location: parse url of the current phase

```js
app.get('*.html', dom().route((phase, req, res) => {
  if (phase.visible && req.query.url) {
    // overwrite default location
    location.href = req.query.url;
  } else if (phase.online) {
    res.type('html');
    res.send('<html><script src="asset.js"></script></html>');
  }
}));
```

- `dom().route(dom.defaults.routers.png)` to setup png rendering
- see also [express-dom-pdf plugin](https://github.com/kapouer/express-dom-pdf)

## Page settings and plugins

Plugins are asynchronous functions, executed in order.

```js
dom.defaults.plugins.fragment = async (page, settings, req, res) => {
  settings.timeout = 30000;
  page.on('idle', async () => {
    const html = await page.evaluate(sel => {
      return document.querySelector(sel)?.outerHTML;
    }, req.query.fragment);
    if (html) {
      res.type('html');
      res.send(html);
    } else {
      // html plugin will send page content
    }
  });
};
dom.defaults.online.plugins.delete('html').add('fragment').add('html');
app.get('*.html', dom(), express.static(app.get('views')));
```

`page` is a puppeteer page instance, with additional
`page.location`, a URL instance that can be modified
synchronously.

## Bundled plugins

This is a limited list of plugins, some are used by default:

- console
  Report browser console to node console.
  Depends on settings.log value.

- hidden
  Force `document.visibilityState == "hidden"`.
  Adds user stylesheet to keep rendering to minimum;
  Honors `settings.hidden` boolean, if set by a previous plugin.

- cookies
  If online `settings.online.cookies` is true, copy all cookies,
  else only copy cookies with names in this Set.
  Defaults to an empty Set.

- equivs
  Parse `meta[http-equiv]` tags and set response headers accordingly.
  Supports http-equiv="Status".
  Removes the meta nodes, except when the names are listed in the
  `settings.equivs` array.

- languages
  Pass current request `Accept-Language` to page route headers.
  Sets `Content-Language` to the lang attribute found on documentElement.

- preloads
  Parse `link[rel=preload]` tags and set 'Link' response header.

- referrer, referer
  Sets headers.referer to express req.get('referrer')

- redirect
  catch navigation requests and instead sends a 302 redirection

## Compatibility with caching proxies

express-dom currently uses `Sec-Purpose` request header, and set `Vary: Sec-Purpose` response headers, so all proxies should be okay with that.

## Logs

- `DEBUG=express-dom`

## Backend

express-dom installs puppeteer-core.

It is best to install chromium and firefox (on linux, using the package manager).

## License

MIT License, see LICENSE file.
