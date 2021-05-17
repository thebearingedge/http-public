import {
  request,
  Server as HttpServer,
  IncomingMessage as Req,
  ServerResponse as Res
} from 'http'
import { pipeline } from 'stream'
import { Socket as TcpSocket } from 'net'
import { TunnelAgent } from './tunnel-agent'
import { noop, isUndefined, getHostname, getRequestHead } from './util'

type ProxyServerOptions = {
  hostname?: string
}

export const createServer = (options: ProxyServerOptions = {}): HttpServer => {

  const server = new HttpServer()
  const tunnelAgents = new Map<string, TunnelAgent>()
  const { hostname: proxyHostname = 'localhost' } = options

  server.on('request', (req: Req, res: Res) => {
    const hostname = getHostname(req.headers.host)
    if (isUndefined(hostname)) {
      res.writeHead(400).end()
      return
    }
    if (hostname === proxyHostname) {
      handleClientRequest(req, res)
      return
    }
    handleProxyRequest(hostname, req, res)
  })

  server.on('upgrade', (req: Req, socket: TcpSocket) => {
    const hostname = getHostname(req.headers.host)
    if (isUndefined(hostname)) {
      socket.destroy()
      return
    }
    if (hostname === proxyHostname) {
      handleClientUpgrade(req, socket)
      return
    }
    handleProxyUpgrade(hostname, req, socket)
  })

  const closeServer = server.close

  server.close = (handleClose: () => void) => {
    tunnelAgents.forEach((agent, hostname) => {
      tunnelAgents.delete(hostname)
      agent.destroy()
    })
    return closeServer.call(server, handleClose)
  }

  return server

  function handleClientRequest(req: Req, res: Res): void {
    const hostname = getHostname(req.headers['x-tunnel-hostname'])
    if (isUndefined(hostname)) {
      res.writeHead(400).end()
      return
    }
    if (tunnelAgents.has(hostname)) {
      res.writeHead(409).end()
      return
    }
    tunnelAgents.set(hostname, new TunnelAgent())
    res.writeHead(201).end()
  }

  function handleProxyRequest(hostname: string, req: Req, res: Res): void {
    const agent = tunnelAgents.get(hostname)
    if (isUndefined(agent)) {
      res.writeHead(404).end()
      return
    }
    const { method, url, headers } = req
    const tunnelReqOptions = { method, url, headers, agent }
    const tunnelReq = request(tunnelReqOptions, tunnelRes => {
      res.writeHead(tunnelRes.statusCode!, tunnelRes.rawHeaders)
      pipeline([tunnelRes, res], noop)
    })
    tunnelReq.once('error', () => {
      if (res.headersSent) {
        res.destroy()
        return
      }
      res.writeHead(502).end()
      tunnelReq.destroy()
    })
    pipeline([req, tunnelReq], noop)
  }

  function handleClientUpgrade(req: Req, socket: TcpSocket): void {
    if (req.headers.upgrade !== '@http-public/tunnel') {
      socket.destroy()
      return
    }
    const hostname = getHostname(req.headers['x-tunnel-hostname'])
    if (isUndefined(hostname)) {
      socket.destroy()
      return
    }
    const agent = tunnelAgents.get(hostname)
    if (isUndefined(agent)) {
      socket.destroy()
      return
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Connection: upgrade\r\n' +
      'upgrade: @http-public/tunnel\r\n' +
      '\r\n'
    )
    agent.registerTunnel(socket)
  }

  function handleProxyUpgrade(hostname: string, req: Req, socket: TcpSocket): void {
    const agent = tunnelAgents.get(hostname)
    if (isUndefined(agent)) {
      socket.end(
        'HTTP/1.1 404 Not Found\r\n' +
        'Connection: close\r\n' +
        '\r\n'
      )
      return
    }
    agent.createConnection(null, (err, _tunnel) => {
      /* c8 ignore next */
      if (err != null) return socket.destroy()
      const tunnel = _tunnel as TcpSocket
      if (!socket.readable || !socket.writable) {
        tunnel.destroy()
        socket.destroy()
        return
      }
      pipeline([socket, tunnel, socket], noop)
      const reqHead = getRequestHead(req)
      tunnel.write(reqHead)
    })
  }

}
