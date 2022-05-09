# express-dom

Express middleware (pre)rendering web pages in a hosted web browser.

Since version 6, uses [playwright](https://playwright.dev/docs/api/) as backend.

## Synopsis

The simplest example for web page rendering is:

```js
var app = require('express')();
var dom = require('express-dom');

app.get('*.html', dom().load());

```

Web pages can be built in two separate phases:

- prepare
  this loads the html view into a DOM that can be modified
  by prepare plugins, but does not run the view's scripts.
- load
  this loads and run the result of the prepared view the same as if it was
  loaded in a browser.

The *prepare* phase is supposed to setup the view with application parameters,
the *load* phase is supposed to prerender the view depending on the current
location.

## Methods

All arguments are optional, see below.

Return express middlewares:

- dom(view, helper1, helper2, ...)
  `view` is resolved by a default helper, see below.
  If empty, resolves to the current request express view file path.
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

The global default values for these options can be changed using `dom.settings`.
Phase-dependant settings can be specified globally using `dom.settings.prepare`
or `dom.settings.load`.

Each dom middleware handler created using dom() keeps its own copy of `settings`,
and each request is processed with its own copy as well.

dom.settings.helpers holds the default helpers:

- dom.helpers.view
- dom.helpers.prioritize (increments `settings.priority` if request is xhr)

dom.settings.prepare.plugins holds the default plugins for preparing a page:

- dom.plugins.types
- dom.plugins.hide
- dom.plugins.none
- dom.plugins.html

dom.settings.load.plugins holds the default plugins for loading a page:

- dom.plugins.types
- dom.plugins.hide
- dom.plugins.prerender
- dom.plugins.redirect
- dom.plugins.html

More plugins are provided, please check the source code.

Replace default list of plugins by setting the `plugins` option:
`dom('index').load({plugins: ['html']})`

Prepend plugins to the default list using additional arguments:
`dom('index').load({pool: {max:2}}, 'mount')`

More on plugins below.

Pool options are defined through global settings `dom.pool`

- pool.max
  the maximum number of instances in the pool, per priority.
  By default, two pools will exist when using `prioritize` helper.
- pool.maxloads
  destroys pages that have loaded more than maxloads times (default 100)

Default page initialization options can be set in `dom.settings`

- stall: time before idle event ignores an async resource
- timeout: time before an async resource times out
- verbose: console on stdout / stderr

## Plugins and helpers

A helper can change view, location, input, settings and call prepare or load,
depending on request.

The settings object received by the helper is used as defaults for the settings
object received by plugins.

It should avoid ending the response, and should instead throw an error.

A plugin can listen to page events, change settings before the page is loaded,
define input/output, access request/response.

`function helper(mw, settings, req, res) { ... }`
`function plugin(page, settings, req, res) { ... }`

- mw
  the current dom middleware, like the one returned by `dom()`.
  Exposes `prepare` and `load` methods.

- page
  Plugins get a not yet loaded playwright page instance.
  Use `page.on('idle', fn)` to run an *asynchronous* listener.
  This idle event is emitted using a special promise-aware method,
  not the standard synchronous emitter.

- settings
  see above for default settings, and below for per-request settings.

- req, res
  usual express middleware arguments

Plugins can be asynchronous as well.

One output plugin will have to set `settings.output`, see below.

A few options are added to settings:

- settings.view
  only for helpers

- settings.views (string or array)
  the root public dir(s) for the default helper plugin
  defaults to app.get('views')

- settings.location
  whatwg url, will be used to set document location;
  and defaults to the current request url.

- settings.location.headers
  additional headers.
  In particular, cookie can be found here, if any.
  An helper can do `settings.view = settings.location` to pass request to another url.

- settings.input
  the data obtained from the view or the view itself if it was given as data.

- settings.output
  If `output !== false`, express-dom writes or pipe it to the response.
  A plugin can set response status, `output` and let other plugins change it,
  or can directly handle response and set `output` to false (or do nothing).

- settings.filters
  Array of filter: request => bool functions.
  If a filter returns *false*, the request is aborted.

- settings.priority (integer, default 0)
  This defines separate pools (and queues) for allocating instances.
  Used in conjonction with `prioritize` helper (installed by default), it helps
  avoiding deadlocks when a page needs other pages during its prerending.

- settings.prepare.disable
  Disable prepare phase.
  Can be set per request (by helper),
  or as default.

- settings.load.disable
  Disable load phase. Only the prepare phase will run.
  Can be set per request (by a prepare plugin or helper),
  or as default (dom.settings.develop sets dom.settings.load.disable).

## Bundled plugins

This is a limited list of plugins, some are used by default:

- referrer
  populates document.referrer using request.get('referrer')

- prerender
  `document.visibilityState == 'prerender'`

- redirect
  catch navigation and use it for redirection, see below

- types
  filter requests by settings.types Set.

- none
  blocks all requests

- hide
  ensures `document.hidden == true`;
  adds user stylesheet to keep rendering to minimum;
  aborts stylesheet, image, font loading;
  can be disabled using `settings.hide = false`.

- png
  outputs a screenshot of the rendered DOM

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
