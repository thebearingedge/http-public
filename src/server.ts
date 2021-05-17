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
  hostname: string
}

export const createServer = (options: ProxyServerOptions): HttpServer => {

  const server = new HttpServer()
  const { hostname: serverHostname } = options
  const tunnelAgents = new Map<string, TunnelAgent>()

  server.on('request', (req: Req, res: Res) => {
    const hostname = getHostname(req.headers.host)
    if (isUndefined(hostname)) {
      res.writeHead(400).end()
      return
    }
    if (hostname === serverHostname) {
      handleClientRequest(req, res)
      return
    }
    handleRemoteRequest(hostname, req, res)
  })

  server.on('upgrade', (req: Req, socket: TcpSocket) => {
    const hostname = getHostname(req.headers.host)
    if (isUndefined(hostname)) {
      socket.destroy()
      return
    }
    if (hostname === serverHostname) {
      handleClientUpgrade(req, socket)
      return
    }
    handleRemoteUpgrade(hostname, req, socket)
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

  function handleClientRequest(req: Req, res: Res): void {
    const tunnelHostname = getHostname(req.headers['x-tunnel-hostname'])
    if (isUndefined(tunnelHostname)) {
      res.writeHead(400).end()
      return
    }
    if (tunnelAgents.has(tunnelHostname)) {
      res.writeHead(409).end()
      return
    }
    tunnelAgents.set(tunnelHostname, new TunnelAgent())
    res.writeHead(201).end()
  }

  function handleRemoteRequest(hostname: string, req: Req, res: Res): void {
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

  function handleRemoteUpgrade(remoteHost: string, req: Req, socket: TcpSocket): void {
    const agent = tunnelAgents.get(remoteHost)
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

  function handleClientUpgrade(req: Req, socket: TcpSocket): void {
    if (req.headers.upgrade !== '@http-public/tunnel') {
      socket.destroy()
      return
    }
    const tunnelHost = getHostname(req.headers['x-tunnel-hostname'])
    if (isUndefined(tunnelHost)) {
      socket.destroy()
      return
    }
    const agent = tunnelAgents.get(tunnelHost)
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
    agent.emit('tunnel', socket)
  }
}
