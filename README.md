# express-dom

Express middleware (pre)rendering web pages in a hosted web browser.

Since version 6, uses [playwright](https://playwright.dev/docs/api/) as backend.

## Synopsis

The simplest example for web page rendering is:

```js
const app = require('express')();
const dom = require('express-dom');

app.get('*.html', dom().load());

```

There are two (optional) phases to prerender a web page:

- prepare
  loads the page in browser, does not load or run any resources.
  Useful for applying plugins to an html template.
- load
  loads the prepared page in browser, only load and run scripts.

Both methods wait for the page to settle async operations:

- script/link nodes
- DOMContentLoaded (async) listeners
- fetch, xhr calls
- promises
- microtasks
- timeouts
- animation frame requests

Once all that is done, an "idle" event is emitted,
with a custom async-aware emitter so listeners setup by
plugins can run in order.

This "idle" event tracking works quite well in many cases,
but cannot work with scripts that don't properly
handle promise rejections. One cannot guess how an async
tree ends.

## Methods

All arguments are optional, see below.

Return express middlewares:

- dom(helper1, helper2, ...)
  The default helper resolves to the current request express view file path.
  Additional helper functions can return a promise, see below.

- dom(...).prepare(opts, plugin1, plugin2, ...)
  Set options and/or plugins for DOM loading without running embedded
  scripts not loading resources.
  Plugins are appended to the list of plugins (opts.plugins or default list).
  Prepare is meant to modify the DOM from server-side.

- dom(...).load(opts, plugin1, plugin2, ...)
  Set options and/or plugins for DOM loading and runs embedded scripts;
  does not load resources by default.
  Plugins are appended to the list of plugins (opts.plugins or default list).
  Load is meant to modify the DOM using client scripts.

A special form is available for rendering outside express:

```js
const { status, body } = await dom(...).load(...)(url);
```

## Input and output

Custom helpers are run before the final helper, which resolves `settings.view`
into `settings.input` if not already done by a custom helper. Input is then
loaded into DOM by prepare or load methods, with `settings.location` as the
document location.

`view` can be a buffer, a readable stream, a string that starts with `<`,
or a local file path, or a remote url, or a parsed url object.

If it is a parsed url object, it is passed as argument for `request()`,
so more options can be added to it.

If it resolves as a remote url (string or parsed), the statusCode of the
remote url will set the statusCode of the current response.

If no input data can be resolved:

- if no prepare or load calls are done, the response is 501 Not Implemented
- else the response is 404 Not Found

The final express-dom handler does not send a response if
`settings.output === false`. If prepare or load methods weren't called,
output is equal to `settings.input`. See plugins source for examples.

## Options

dom.helpers, dom.plugins are maps.

dom.settings holds some global, immutable configurations:

- browser: the playwright channel to use, defaults to locally-installed 'chrome'
- pageMax: number of open pages per browser
- pageUse: number of uses before recycling browser
- timeout: async resources timeout
- debug: show browser
- verbose: show console logs, errors

and instance settings:

- helpers: list of helpers names
           defaults to 'view'
- prepare: list of plugins for prepare, disabled if empty
           defaults to 'hide', 'html'
- load: list of plugins for load, disabled if empty
           defaults to 'hide', 'prerender', 'redirect', 'html'

## Helpers and Plugins

`async helper(mw, settings, req, res) { ... }`
A helper can change these settings depending on current request:

- input
- location
- prepare/load plugins

It should avoid ending the response, and should instead throw an error.

`async function plugin(page, settings, req, res) { ... }`
A plugin can change the page instance before it starts loading.

- mw
  the current dom middleware, like the one returned by `dom()`,
  so `mw.prepare` and `mw.load` are callable.

- page
  Use `page.on('idle', fn)` to run asynchronous listeners.

- settings (see below)

- req, res
  usual express middleware arguments

One output plugin will have to set `settings.output`, see below.

A few options are added to settings:

- view
  supports: url string, location, express view name,
  string starting with "<", buffer, stream.
  Only used by helpers.

- views (string or array)
  the root public dir(s) for the default helper plugin
  defaults to app.get('views')
  Only used by helpers.

- location
  whatwg url, will be used to set document location;
  and defaults to the current request url.

- headers
  additional page request headers set by plugins.

- input
  the data obtained from the view or the view itself if it was given as data.

- output
  If `output !== false`, express-dom writes or pipe it to the response.
  A plugin can set response status, `output` and let other plugins change it,
  or can directly handle response and set `output` to false (or do nothing).

- filters
  Array of filter: request => bool functions.
  If a filter returns *false*, the request is aborted.

- policies
  map of Content-Security-Policy Fetch directives (without -src suffix).
  Defaults to `{ default: "'none'" }`.

- priority (integer, default 0)
  This defines separate pools (and queues) for allocating instances.
  Used in conjonction with `prioritize` helper (installed by default), it helps
  avoiding deadlocks when a page needs other pages during its prerending.

- prepare.disable
  Disable prepare phase.
  Can be set per request (by helper),
  or as default.

- load.disable
  Disable load phase. Only the prepare phase will run.
  Can be set per request (by a prepare plugin or helper),
  or as default (dom.settings.develop sets dom.settings.load.disable).

## Bundled plugins

This is a limited list of plugins, some are used by default:

- referrer
  Sets headers.referer to express req.get('referrer')

- prerender
  Force `document.visibilityState == "hidden"`
  sets policies for script and connect to `'self' 'unsafe-inline'`.

- redirect
  catch navigation and use it for redirection, see below

- hide
  adds user stylesheet to keep rendering to minimum;
  Honors `settings.hide` boolean, if set by a previous plugin.

- png
  sets policies for script, connect, style to 'self' 'unsafe-inline',
  and policies for font, img to `'self' https: data:`.
  outputs a screenshot of the rendered DOM.

- cookies
  Allows cookies listed in `settings.allowCookies` Set,
  or all cookies if no such setting exists.

- develop
  sets `settings.load.disable = true` if `query.develop` is defined.

More can be found in source code.

See also
[express-dom-pdf plugin](https://github.com/kapouer/express-dom-pdf)
which also shows that a helper can configure plugins by writing
`mw.load({plugins: [mypluginA, mypluginB]});`.

## Redirection on navigation

dom.plugins.redirect listens to navigate events and emits
`res.redirect(302, location)` accordingly.

## Logs and debug

Useful env vars to know:

- `DEBUG=express-dom`
- `PWDEBUG=1`

## Backend

The playwright backend is configured to use system-installed chrome.

## License

MIT License, see LICENSE file.
