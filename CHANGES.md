# Changes

## Version 8.16.0

Use req.host instead of req.headers.host.

This might break some things, however it shouldn't, and it's better at supporting proxies and X-Forwarded-Host.

## Version 8.15.0

Better short name detection for CSP policies object.
One case use the long name without risks.

## Version 8.14.3

equivs: better support for comma-separated fields, and for arrays of headers.

## Version 8.14.2

equivs keeps meta node when the name is listed in the `equivs` option array.

## Version 8.14.1

Revert partially the change in ManualRequest.
Supports an absolute url, or an object with headers: {host}, or an object
with { url, body }.

## Version 8.14.0

- Plugins can now change headers of page response.
- Use that to fix languages plugin.

## Version 8.13.0

Fix ManualRequest handler. Now expects an object with url and headers: { host },
or an absolute url.

## Version 8.12.0

Drops browser-pool in favor of a simpler pooling solution.

Switch to new headless chrome.

## Version 8.11.0

Support "manual" modes.

## Version 8.10.1

- Dom.executable can be set to a custom value.
  Otherwise, when null, it uses available chromium or google-chrome in that order.

## Version 8.10.0

- Dom.executable defaults to /usr/bin/chromium

## Version 8.0.0

- inner requests are now made using a standard HTTP request header,
  and no longer uses ?develop query parameter. Proxies must support Vary.
- separation between configuration of routes and requests
- and other api changes...






















