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
  const server = new HttpServer()
  const tunnelAgents = new Map<string, TunnelAgent>()

  server.on('upgrade', (req: Req, socket: TcpSocket) => {
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
      const tunnelHost = getHostname(req.headers['x-tunnel-hostname'])
      if (isUndefined(tunnelHost)) {
        // x-tunnel-hostname header is required
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
        '\r\n',
        // persist the tunnel connection for this hostname
        () => agent.emit('tunnel', socket)
      )
      return
    }
    const agent = tunnelAgents.get(remoteHost)
    if (isUndefined(agent)) {
      // no tunnel agents are serving this hostname
      socket.end(
        'HTTP/1.1 404 Not Found\r\n' +
        'Connection: close\r\n' +
        '\r\n'
      )
      return
    }
    // get one of the agent's open connections
    agent.createConnection(null, (err, _tunnel) => {
      if (err != null) return socket.destroy()
      const tunnel = _tunnel as TcpSocket
      if (!socket.readable || !socket.writable) {
        tunnel.destroy()
        socket.destroy()
        return
      }
      pipeline(socket, tunnel, socket, noop)
      // forward the upgrade request through the tunnel
      let reqHead = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        reqHead += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`
      }
      reqHead += '\r\n'
      tunnel.write(reqHead)
    })
  })

  server.on('request', (req: Req, res: Res) => {
    const targetHost = getHostname(req.headers.host)
    if (isUndefined(targetHost)) {
      // host header is required
      res.writeHead(400).end()
      return
    }
    if (targetHost === proxyHost) {
      const remoteHost = getHostname(req.headers['x-tunnel-hostname'])
      if (isUndefined(remoteHost)) {
        // x-tunnel-hostname header is required
        res.writeHead(400).end()
        return
      }
      if (tunnelAgents.has(remoteHost)) {
        // this tunnel hostname is already taken
        res.writeHead(409).end()
        return
      }
      tunnelAgents.set(remoteHost, new TunnelAgent())
      res.writeHead(201).end()
      return
    }
    const agent = tunnelAgents.get(targetHost)
    if (isUndefined(agent)) {
      // no tunnel agents are serving this hostname
      res.writeHead(404).end()
      return
    }
    // forward the request through the client agent
    const { method, url, headers } = req
    const tunnelReqOptions = { method, url, headers, agent }
    const tunnelReq = request(tunnelReqOptions, tunnelRes => {
      res.writeHead(tunnelRes.statusCode!, tunnelRes.headers)
      pipeline(tunnelRes, res, noop)
    })
    pipeline(req, tunnelReq, noop)
  })

  const closeServer = server.close

  server.close = (handleClose: () => void) => {
    tunnelAgents.forEach((agent, remoteHost) => {
      agent.emit('close')
      tunnelAgents.delete(remoteHost)
    })
    return closeServer.call(server, handleClose)
  }

  return server
}
