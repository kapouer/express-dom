# changes

## Version 8

- inner requests are now made using a standard HTTP request header,
  and no longer uses ?develop query parameter. Proxies must support Vary.
- separation between configuration of routes and requests
- and other api changes...

### Version 8.10.0

- Dom.executable defaults to /usr/bin/chromium
