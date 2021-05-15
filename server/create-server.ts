import {
  request,
  Server as HttpServer,
  IncomingMessage as Req,
  ServerResponse as Res
} from 'http'
import { pipeline } from 'stream'
import { Socket as TcpSocket } from 'net'
import { TunnelAgent } from './client-agent'
import { isUndefined, getHostname } from './util'

type ProxyServerOptions = {
  hostname: string
}

export const createServer = (options: ProxyServerOptions): HttpServer => {

  const { hostname: proxyHostname } = options
  const proxyServer = new HttpServer()
  const tunnelAgents = new Map<string, TunnelAgent>()

  proxyServer.on('close', () => {
    tunnelAgents.forEach(agent => agent.emit('close'))
  })

  proxyServer.on('upgrade', (req: Req, socket: TcpSocket) => {
    const remoteHostname = getHostname(req.headers.host)
    if (isUndefined(remoteHostname)) {
      // host header is required
      socket.destroy()
      return
    }
    if (remoteHostname === proxyHostname) {
      // a tunnel is being opened
      if (req.headers.upgrade !== '@http-public/tunnel') {
        // protocol not supported
        socket.destroy()
        return
      }
      const tunnelHostname = getHostname(req.headers['@http-public/tunnel'])
      if (isUndefined(tunnelHostname)) {
        // @http-public/tunnel header is required
        socket.destroy()
        return
      }
      const agent = tunnelAgents.get(tunnelHostname)
      if (isUndefined(agent)) {
        // no client agents are serving this hostname
        socket.destroy()
        return
      }
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Connection: Upgrade\r\n' +
        'Upgrade: @http-public/tunnel\r\n' +
        '\r\n'
      )
      agent.emit('tunnel', socket)
      return
    }
    const agent = tunnelAgents.get(remoteHostname)
    if (isUndefined(agent)) {
      // no client agents are serving this hostname
      socket.destroy()
      return
    }
    agent.createConnection(null, (err, _socket) => {
      if (err !== null) return socket.destroy()
      const tunnel = _socket as TcpSocket
      if (!socket.readable || !socket.writable) {
        tunnel.destroy()
        socket.destroy()
        return
      }
      pipeline(socket, tunnel)
      pipeline(tunnel, socket)
      const reqMessage = [
        `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`,
        ...req.rawHeaders.map(([key, value]) => `${key}: ${value}\r\n`),
        '\r\n'
      ].join('')
      tunnel.write(reqMessage)
    })
  })

  proxyServer.on('request', (proxyReq: Req, proxyRes: Res) => {
    const targetHostname = getHostname(proxyReq.headers.host)
    if (isUndefined(targetHostname)) {
      // host header is required
      proxyRes.writeHead(400).end()
      return
    }
    if (targetHostname === proxyHostname) {
      const remoteHostname = getHostname(proxyReq.headers['@http-public/tunnel'])
      if (isUndefined(remoteHostname)) {
        // @http-public/tunnel header is required
        proxyRes.writeHead(400).end()
        return
      }
      if (tunnelAgents.has(remoteHostname)) {
        // this remote hostname is already taken
        proxyRes.writeHead(409).end()
        return
      }
      tunnelAgents.set(remoteHostname, new TunnelAgent())
      proxyRes.end()
      return
    }
    const agent = tunnelAgents.get(targetHostname)
    if (isUndefined(agent)) {
      // no client agents are serving this hostname
      proxyRes.writeHead(404).end()
      return
    }
    // forward the request through the client agent
    const { method, url, headers } = proxyReq
    const remoteReqOptions = { method, url, headers, agent }
    const remoteReq = request(remoteReqOptions, remoteRes => {
      proxyRes.writeHead(remoteRes.statusCode!, remoteRes.headers)
      pipeline(remoteRes, proxyRes)
    })
    pipeline(proxyReq, remoteReq)
  })

  return proxyServer
}
