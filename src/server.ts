import {
  request,
  Server as HttpServer,
  IncomingMessage as Req,
  ServerResponse as Res,
  RequestOptions
} from 'http'
import { Socket } from 'net'
import { pipeline } from 'stream'
import { randomBytes } from 'crypto'
import { TunnelAgent } from './tunnel-agent'
import { head, noop, isUndefined, getHostname, getRequestHead } from './util'

type ServerOptions = {
  host: string
  token: string
}

export const createServer = (options: ServerOptions): HttpServer => {

  const server = new HttpServer()
  const agents = new Map<string, [null | string, TunnelAgent]>()

  const { host: proxyHost, token } = options

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
    onProxyRequest(host, req, res)
  })

  server.on('upgrade', (req: Req, socket: Socket) => {
    const host = getHostname(req.headers.host)
    if (isUndefined(host)) {
      socket.end(head`
        HTTP/1.1 400 Bad Request
        Connection: close
      `)
      return
    }
    if (host === proxyHost) {
      onClientUpgrade(req, socket)
      return
    }
    onProxyUpgrade(host, req, socket)
  })

  const closeServer = server.close

  server.close = (onClose: (err?: Error) => void) => {
    agents.forEach(([, agent], host) => {
      agents.delete(host)
      agent.destroy()
    })
    return closeServer.call(server, onClose)
  }

  return server

  function onClientRequest(req: Req, res: Res): void {
    const tokenHeader = req.headers['x-tunnel-token']
    if (isUndefined(tokenHeader) || tokenHeader !== token) {
      res.writeHead(403).end()
      return
    }
    const host = getHostname(req.headers['x-tunnel-host'])
    if (isUndefined(host)) {
      res.writeHead(400).end()
      return
    }
    if (agents.has(host)) {
      res.writeHead(409).end()
      return
    }
    const agent = new TunnelAgent()
    agents.set(host, [null, agent])
    randomBytes(8, (_, bytes) => {
      const key = bytes.toString('base64')
      agents.set(host, [key, agent])
      agent.once('timeout', () => agents.delete(host))
      res.writeHead(201, { 'x-tunnel-key': key }).end()
    })
  }

  function onProxyRequest(host: string, req: Req, res: Res): void {
    const [, agent] = agents.get(host) ?? []
    if (isUndefined(agent)) {
      res.writeHead(404).end()
      return
    }
    const { method, url: path, rawHeaders: headers } = req
    const tunnelReqOptions = {
      method, path, headers, agent
    } as unknown as RequestOptions
    const tunnelReq = request(tunnelReqOptions, tunnelRes => {
      res.writeHead(tunnelRes.statusCode!, tunnelRes.rawHeaders)
      pipeline(tunnelRes, res, noop)
    })
    tunnelReq.once('error', () => {
      res.writeHead(502).end()
      tunnelReq.destroy()
    })
    pipeline(req, tunnelReq, noop)
  }

  function onClientUpgrade(req: Req, socket: Socket): void {
    const host = getHostname(req.headers['x-tunnel-host'])
    if (isUndefined(host)) {
      socket.end(head`
        HTTP/1.1 400 Bad Request
        Connection: close
      `)
      return
    }
    const { upgrade } = req.headers
    if (upgrade !== '@http-public/tunnel') {
      socket.end(head`
        HTTP/1.1 400 Bad Request
        Connection: close
      `)
      return
    }
    const [key, agent] = agents.get(host) ?? []
    if (isUndefined(agent)) {
      socket.end(head`
        HTTP/1.1 404 Not Found
        Connection: close
      `)
      return
    }
    const { 'x-tunnel-key': tunnelKey } = req.headers
    if (tunnelKey !== key) {
      socket.end(head`
        HTTP/1.1 404 Not Found
        Connection: close
      `)
      return
    }
    socket.write(head`
      HTTP/1.1 101 Switching Protocols
      Connection: upgrade
      Upgrade: @http-public/tunnel
    `)
    agent.registerTunnel(socket)
  }

  function onProxyUpgrade(host: string, req: Req, socket: Socket): void {
    const [, agent] = agents.get(host) ?? []
    if (isUndefined(agent)) {
      socket.end(head`
        HTTP/1.1 404 Not Found
        Connection: close
      `)
      return
    }
    agent.createConnection(null, (err, tunnel) => {
      if (err != null) {
        socket.end(head`
          HTTP/1.1 404 Not Found
          Connection: close
        `)
        return
      }
      if (!socket.writable || !socket.readable) {
        socket.destroy()
        tunnel!.destroy()
        return
      }
      pipeline(socket, tunnel!, socket, noop)
      const reqHead = getRequestHead(req)
      tunnel!.write(reqHead)
    })
  }

}
