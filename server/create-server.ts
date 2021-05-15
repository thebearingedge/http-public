import {
  request,
  Server as HttpServer,
  IncomingMessage as Req,
  ServerResponse as Res
} from 'http'
import { pipeline } from 'stream'
import { Socket as TcpSocket } from 'net'
import { TunnelAgent } from './tunnel-agent'
import { noop, getHostname, isUndefined } from './util'

type ProxyServerOptions = {
  hostname: string
}

export const createServer = (options: ProxyServerOptions): HttpServer => {

  const { hostname: proxyHost } = options
  const proxyServer = new HttpServer()
  const tunnelAgents = new Map<string, TunnelAgent>()

  proxyServer.on('close', () => {
    tunnelAgents.forEach(agent => agent.emit('close'))
  })

  proxyServer.on('upgrade', (req: Req, socket: TcpSocket) => {
    const remoteHost = getHostname(req.headers.host)
    if (isUndefined(remoteHost)) {
      // host header is required
      socket.destroy()
      return
    }
    if (remoteHost === proxyHost) {
      // a tunnel is being opened
      if (req.headers.upgrade !== '@http-public/tunnel') {
        // protocol not supported
        socket.destroy()
        return
      }
      const tunnelHost = getHostname(req.headers['@http-public/tunnel'])
      if (isUndefined(tunnelHost)) {
        // @http-public/tunnel header is required
        socket.destroy()
        return
      }
      const agent = tunnelAgents.get(tunnelHost)
      if (isUndefined(agent)) {
        // no tunnel agents are serving this hostname
        socket.destroy()
        return
      }
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Connection: Upgrade\r\n' +
        'Upgrade: @http-public/tunnel\r\n' +
        '\r\n'
      )
      // persist the tunnel connection for this hostname
      agent.emit('tunnel', socket)
      return
    }
    const agent = tunnelAgents.get(remoteHost)
    if (isUndefined(agent)) {
      // no tunnel agents are serving this hostname
      socket.destroy()
      return
    }
    // get one of the agent's open connections
    agent.createConnection(null, (err, _tunnel) => {
      if (err !== null) return socket.destroy()
      const tunnel = _tunnel as TcpSocket
      if (!socket.readable || !socket.writable) {
        tunnel.destroy()
        socket.destroy()
        return
      }
      pipeline(socket, tunnel, noop)
      pipeline(tunnel, socket, noop)
      // forward the upgrade request through the tunnel
      const reqMessage = [
        `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`,
        ...req.rawHeaders.map(([key, value]) => `${key}: ${value}\r\n`),
        '\r\n'
      ].join('')
      tunnel.write(reqMessage)
    })
  })

  proxyServer.on('request', (proxyReq: Req, proxyRes: Res) => {
    const targetHost = getHostname(proxyReq.headers.host)
    if (isUndefined(targetHost)) {
      // host header is required
      proxyRes.writeHead(400).end()
      return
    }
    if (targetHost === proxyHost) {
      const remoteHost = getHostname(proxyReq.headers['@http-public/tunnel'])
      if (isUndefined(remoteHost)) {
        // @http-public/tunnel header is required
        proxyRes.writeHead(400).end()
        return
      }
      if (tunnelAgents.has(remoteHost)) {
        // this remote hostname is already taken
        proxyRes.writeHead(409).end()
        return
      }
      tunnelAgents.set(remoteHost, new TunnelAgent())
      proxyRes.end()
      return
    }
    const agent = tunnelAgents.get(targetHost)
    if (isUndefined(agent)) {
      // no tunnel agents are serving this hostname
      proxyRes.writeHead(404).end()
      return
    }
    // forward the request through the client agent
    const { method, url, headers } = proxyReq
    const remoteReqOptions = { method, url, headers, agent }
    const remoteReq = request(remoteReqOptions, remoteRes => {
      proxyRes.writeHead(remoteRes.statusCode!, remoteRes.headers)
      pipeline(remoteRes, proxyRes, noop)
    })
    pipeline(proxyReq, remoteReq, noop)
  })

  return proxyServer
}
