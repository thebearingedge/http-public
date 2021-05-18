import {
  request,
  Server as HttpServer,
  IncomingMessage as Req,
  ServerResponse as Res
} from 'http'
import { Socket } from 'net'
import { pipeline } from 'stream'
import { TunnelAgent } from './tunnel-agent'
import { noop, isUndefined, getHostname, getRequestHead } from './util'

type ServerOptions = {
  host?: string
}

export const createServer = (options: ServerOptions = {}): HttpServer => {

  const server = new HttpServer()
  const agents = new Map<string, TunnelAgent>()
  const { host: proxyHost = 'localhost' } = options

  server.on('request', (req: Req, res: Res) => {
    const host = getHostname(req.headers.host)
    if (isUndefined(host)) {
      res.writeHead(400).end()
      return
    }
    if (host === proxyHost) {
      onClientRequest(req, res)
      return
    }
    onRemoteRequest(host, req, res)
  })

  server.on('upgrade', (req: Req, socket: Socket) => {
    const host = getHostname(req.headers.host)
    if (isUndefined(host)) {
      socket.destroy()
      return
    }
    if (host === proxyHost) {
      onClientUpgrade(req, socket)
      return
    }
    onRemoteUpgrade(host, req, socket)
  })

  const closeServer = server.close

  server.close = (onClose: () => void) => {
    agents.forEach((agent, host) => {
      agents.delete(host)
      agent.destroy()
    })
    return closeServer.call(server, onClose)
  }

  return server

  function onClientRequest(req: Req, res: Res): void {
    const host = getHostname(req.headers['x-tunnel-host'])
    if (isUndefined(host)) {
      res.writeHead(400).end()
      return
    }
    if (agents.has(host)) {
      res.writeHead(409).end()
      return
    }
    agents.set(host, new TunnelAgent())
    res.writeHead(201).end()
  }

  function onRemoteRequest(host: string, req: Req, res: Res): void {
    const agent = agents.get(host)
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

  function onClientUpgrade(req: Req, socket: Socket): void {
    if (req.headers.upgrade !== '@http-public/tunnel') {
      socket.destroy()
      return
    }
    const host = getHostname(req.headers['x-tunnel-host'])
    if (isUndefined(host)) {
      socket.destroy()
      return
    }
    const agent = agents.get(host)
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

  function onRemoteUpgrade(host: string, req: Req, socket: Socket): void {
    const agent = agents.get(host)
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
      const tunnel = _tunnel as Socket
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
