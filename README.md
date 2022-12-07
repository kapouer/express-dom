# express-dom

Express middleware for (pre)rendering web pages with [playwright](https://playwright.dev/docs/api/).

## Synopsis

```js
const express = require('express');
const app = express();
const dom = require('express-dom');

app.get('*.html', dom(), express.static('public/'));
```

or for quick rendering outside express:

```js
const { statusCode, body } = await dom()(url);
```

A page is requested by a browser for three purposes:

- offline: hidden offline web page changed by outside scripts
- online: hidden online web page built by its own scripts
- visible: show the web page to the user

The offline phase is done only on the server, while the online phase is typical prerendering and can be done on the server or the user browser.

Configuration functions can setup a handler instance, valid for all requests on that handler.

Routers can change settings depending on the current request.

Plugins can change page settings before it is loaded, and can run scripts when the page is 'idle'.

A phase is skipped if it has no registered plugins.

The 'idle' event is emitted on the `page` after DOMContentLoaded, and after requests have settled.

If phase setting `track` is true, the idle event also waits for async operations:

- loading of script/link nodes
- DOMContentLoaded listeners
- fetch, xhr calls
- timeouts
- animation frame requests
- microtasks

The listeners of that event are themselves run serially.

Other use cases might require a custom plugin to decide when page prerendering is finished.

## Options

dom holds some global settings:

- browser: the playwright channel to use, defaults to 'chrome'
- pageMax: number of open pages per browser
- pageUse: number of uses before recycling browser
- debug: show browser, disables timeout. Also set by `PWDEBUG=1`.
- defaults: per-instance settings
- plugins: map of plugins functions
- online, offline: per-phase settings defaults

Middleware settings:

- log: boolean, or level (info, log, warn, error)
- timeout: async resources timeout
- scale: changes window.devicePixelRatio
- cookies (used only with cookies plugin)

Handler properties:

- online, offline, visible: custom phase settings, takes precedence

Phase settings:

- policies: object for configuring Content-Security-Policies
- enabled: boolean
- track: boolean
- styles: list of css strings
- scripts: list of [function, arg?] pairs
- plugins: list (set) of names

Default offline settings:

- enabled: false
- track: false
- plugins: console, hidden, html
- policies: default: "'none'"

Default online settings:

- enabled: true
- track: true
- plugins: console, hidden, cookies, referer, redirect, html
- policies:
  - default: "'none'"
  - script: "'self' 'unsafe-inline'"
  - connect: "'self'"

Mind that policies of the requesting phase are obtained from settings of the responding phase: route handler cannot change policies of current phase.

## Route settings

Route-dependent configuration can be done by passing to `dom()`:

- an object with `{ online, offline, visible }` settings
- a function accepting a `handler` instance as argument

## Phase settings

Configuration depending on the route and the phase can be set using a router function accepting (phase, req, res) as argument.

```js
dom().route((phase, req, res) => {
  // change phase.settings.plugins depending on req and phase.online/offline/visible
})
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

- `dom().route(dom.routers.png)` to setup png rendering
- see also [express-dom-pdf plugin](https://github.com/kapouer/express-dom-pdf)

## Page settings and plugins

Plugins are asynchronous functions, executed in order.

```js
dom.plugins.fragment = async (page, settings, req, res) => {
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
dom.online.plugins.delete('html').add('fragment').add('html');
app.get('*.html', dom(), express.static(app.get('views')));
```

`page` is a playwright page instance, with additional
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

- media
  Sets `media` options, see [playwright doc](https://playwright.dev/docs/api/class-page#page-emulate-media).

- cookies
  If `settings.cookies` is true, copy all cookies,
  else only copy cookies with names in this Set.
  Defaults to an empty Set.

- equivs
  Parse `meta[http-equiv]` tags and set response headers accordingly.
  Supports http-equiv="Status".

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

express-dom installs playwright-core and expects a system-installed chrome browser to be available.

## License

MIT License, see LICENSE file.
