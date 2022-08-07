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

Three phases are available to render a web page:

- source: the static file is returned by the server
- offline: all resources are blocked (even inline scripts),
  skipped unless `settings.offline.enabled = true`.
- online: resources are loaded on the page

Requests phases goes like this:

- client requests a url
- online phase requests next phase using a HTTP request header (dom.header.name)
- offline phase requests none phase
- next middleware sends the text file
- offline page is prerendered and sent
- online page is prerendered and sent

Plugins can change settings before the page is loaded,
and can run scripts when the page is 'idle'.

If using a caching proxy, it MUST support "Vary" http response headers.

A phase is skipped if it has no registered plugins.

The 'idle' event is emitted on the `page` after DOMContentLoaded,
and after requests have settled.

If phase setting `track` is true,
the idle event also waits for async operations:

- loading of script/link nodes
- DOMContentLoaded listeners
- fetch, xhr calls
- timeouts
- animation frame requests
- microtasks

The listeners of that event are themselves run serially.

For more subtle situations, a custom plugin can wait for a client promise to resolve.

## Options

dom holds some global settings:

- browser: the playwright channel to use, defaults to 'chrome'
- pageMax: number of open pages per browser
- pageUse: number of uses before recycling browser
- debug: show browser, disables timeout. Also set by `PWDEBUG=1`.
- defaults: per-instance settings
- plugins: map of plugins functions
- online, offline: per-phase settings defaults

Per-instance settings:

- log: boolean, or level (info, log, warn, error)
- timeout: async resources timeout
- scale: change page dpi
- cookies (used only with cookies plugin)

Phase settings (merged with instance settings):

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

## Helper

Per-route configuration can be set using an helper function:

```js
app.get('*.html', dom(({ phase, location, online, offline }, req, res) => {
  if (req.query.url) {
    // overwrite default location
    location.href = req.query.url;
  } else if (phase) {
    res.type('html');
    res.send('<html><script src="asset.js"></script></html>');
  }
}));
```

The source `phase` is non-null only when the client is the one doing prerendering.
It can be dom.header.on or dom.header.off.

## Plugins

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

- png
  style policy: `'self' 'unsafe-inline'`,
  font, img policies: `'self' https: data:`.
  Outputs a screenshot of the rendered DOM.

See also
[express-dom-pdf plugin](https://github.com/kapouer/express-dom-pdf)

## Logs

- `DEBUG=express-dom`

## Backend

The playwright backend is configured to use system-installed chrome.

## License

MIT License, see LICENSE file.
