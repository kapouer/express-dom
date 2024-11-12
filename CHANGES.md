# changes

## Version 8

- inner requests are now made using a standard HTTP request header,
  and no longer uses ?develop query parameter. Proxies must support Vary.
- separation between configuration of routes and requests
- and other api changes...

### Version 8.10.0

- Dom.executable defaults to /usr/bin/chromium

### Version 8.10.1

- Dom.executable can be set to a custom value.
  Otherwise, when null, it uses available chromium or google-chrome in that order.

### Version 8.11.0

Support "manual" modes.

### Version 8.12.0

Drops browser-pool in favor of a simpler pooling solution.

Switch to new headless chrome.

### Version 8.13.0

Fix ManualRequest handler. Now expects an object with url and headers: { host },
or an absolute url.

### Version 8.14.0

- Plugins can now change headers of page response.
- Use that to fix languages plugin.
