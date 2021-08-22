# http-public

Route HTTP traffic from the public internet. Great for web hooks.

[![Github Actions Test Status](https://github.com/thebearingedge/http-public/workflows/Test/badge.svg?branch=master)](https://github.com/thebearingedge/http-public/actions?query=workflow%3ATest+branch%3Amaster)
[![Codecov Coverage Percentage](https://codecov.io/gh/thebearingedge/http-public/branch/master/graph/badge.svg)](https://codecov.io/gh/thebearingedge/http-public)
![npm package](https://img.shields.io/npm/v/http-public)

`http-public` is a barebones knock-off of apps like [`localtunnel`](https://localtunnel.github.io/www/), [`ngrok`](https://ngrok.com/), or [`expose`](https://beyondco.de/docs/expose/introduction).

## Installation

```shell
npm install -D http-public
```

## Execution

```shell
npx http-public <args...>
```

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

Simple, self-hosted HTTP tunneling.

## Features

- Demo an app running on your computer.
- Self-hosted. Set it up on your own VPS.
- Supports HTTP messages and Web Sockets.
- Supports different subdomains for different apps.
- Use as few production dependencies as possible. Only includes [`commander`](https://www.npmjs.com/package/commander) for the CLI.

## Limitations

- The server does not proxy raw TCP connections. Everything is done via HTTP requests and connection upgrades.
- The server does not support HTTPS, you have to put it behind something like Nginx or Caddy.
- No random subdomain generation. You just get a `409 Conflict` if you try to use the same subdomain for two different apps.
- The client does not have any elegant logging. It only prints errors if they occur. PRs welcome.

## How it Works

### Server

Once the server is started, keep it running with something like `pm2`, `forever`, `supervisor`, or whatever and leave it alone. If you are using HTTPS (and you should), then you'll need to set up Nginx or Caddy in front of it and set up a wildcard TLS certificate that covers your domain name as well as the subdomains you'll be serving your individual local apps from. I've included [an example Nginx config](https://github.com/thebearingedge/http-public/blob/master/nginx.example.conf) in the source repository.

The server handles four different types of requests.

- Client requests from the CLI to set up new "tunnel agents". This adds a known subdomain to the server.
- Client upgrades from the CLI to open up tunnel connections. These connections forward public traffic to your local machine.
- Proxy requests. These are normal HTTP requests coming from some remote visitor to your local app.
- Proxy upgrades. These are probably Web Socket connections coming from some remote visitor to your local app.

Once a client registers a new subdomain, it has 10 seconds to open up some tunnel connections. Once all tunnel connections for a subdomain have been closed for 10 seconds, the subdomain is freed to be used again. If a client session ends, it effectively has to wait 10 seconds before reclaiming the same subdomain.

### Client

The client "authenticates" with the server by including an access token when it tries to reserve a subdomain.

After the subdomain is successfully reserved, it starts opening long-lived connections with the server and piping those connections to your local app.

You are given your public link to your local app.

```shell
http-public https://my.site.com http://localhost:3000 -t <your server token> -n demo

# http-public proxy listening at https://demo.my.site.com/
```

As tunnel connections close, the client reopens them to keep the connection pool filled.
