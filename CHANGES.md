# Breaking changes

## Version 8

Inner requests are now made using a HTTP request header:

- no longer uses ?develop query parameter
- sets Vary: <dom.header.name> in response headers.
