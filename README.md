# http-public

Forward HTTP traffic from the public Internet to `localhost`.

[![Github Actions Test Status](https://github.com/thebearingedge/http-public/workflows/Test/badge.svg?branch=master)](https://github.com/thebearingedge/http-public/actions?query=workflow%3ATest+branch%3Amaster)
[![Codecov Coverage Percentage](https://codecov.io/gh/thebearingedge/http-public/branch/master/graph/badge.svg?token=NJIGDAoq7D)](https://codecov.io/gh/thebearingedge/http-public)

`http-public` is a tunneling app like [`localtunnel`](https://localtunnel.github.io/www/), [`ngrok`](https://ngrok.com/), or [`expose`](https://beyondco.de/docs/expose/introduction). You should probably use one of those instead. I personally recommend `expose` as it is the most robust and polished (free) experience.

### `http-public server --help`

```plain
Usage: http-public server|s [options]

start a public tunnel server

Options:
  -t, --token <token>      access token required for clients
  -n, --host <name>        hostname of the server (default: "localhost")
  -a, --address <address>  ip address to listen on (default: "127.0.0.1")
  -p, --port <port>        port number to listen on (default: "1111")
  -h, --help               display help for command
```

### `http-public client --help`

```plain
Usage: http-public client|c [options] <proxy> [local]

start a local tunnel client

Arguments:
  proxy                      public server origin
                             example: https://tunnel.my.site
  local                      local server origin
                             default: http://localhost:3000

Options:
  -t, --token <token>        access token for the tunnel server
  -n, --subdomain <name>     subdomain for the tunnel
  -c, --connections <count>  number of connections to open (default: "10")
  -h, --help                 display help for command
```

## Motivation

This project scratched a few itches for me:

- Learn a bit more about [Streams](https://nodejs.org/api/stream.html).
- Learn a bit more about [HTTP](https://nodejs.org/api/http.html) over [TCP](https://nodejs.org/api/net.html).
- Learn a bit more about [Web Sockets](https://en.wikipedia.org/wiki/WebSocket) over HTTP and what the hell [`Connection: Upgrade`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Upgrade) and [`101 Switching Protocols`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/101) actually meant.
- Write some TypeScript.
- Use as few production dependencies as possible. I only included [`commander`](https://www.npmjs.com/package/commander) for the CLI.

## Features

- Demo an app running on your computer.
- Self-hosted. Set it up on your own VPS.
- Supports HTTP messages and Web Sockets.
- Supports different subdomains

## Limitations

- The server does not proxy raw TCP connections. Everything is done via HTTP requests and connection upgrades.
- The server does not support HTTPS, you have to put it behind something like Nginx or Caddy.
- The client does not have any elegant logging. It only prints errors if they occur.
- No random subdomain generation. You just get a `409 Conflict` if you try to use the same subdomain for two different apps.
