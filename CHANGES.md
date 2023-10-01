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
