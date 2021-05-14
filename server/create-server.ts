import {
  request,
  Server as HttpServer,
  IncomingMessage as Req,
  ServerResponse as Res
} from 'http'
import { Socket as TcpSocket } from 'net'
import { Server as WebSocketServer } from 'ws'
import { ClientAgent } from './client-agent'
import { isString, isUndefined, getHostname } from './util'

type ProxyServerOptions = {
  hostname: string
}

export const createServer = (options: ProxyServerOptions): HttpServer => {

  const { hostname: serverHostname } = options
  const clientAgents = new Map<string, ClientAgent>()

  const proxyServer = new HttpServer()
  const controlServer = new WebSocketServer({ noServer: true })

  const handleClientUpgrade = (req: Req, socket: TcpSocket, head: Buffer): void => {
    const remoteHostname = getHostname(req.headers['x-remote-hostname'])
    if (isUndefined(remoteHostname)) {
      // x-remote-hostname header is required
      socket.destroy()
      return
    }
    controlServer.handleUpgrade(req, socket, head, client => {
      const agentOptions = { remoteHostname, client }
      clientAgents.set(remoteHostname, new ClientAgent(agentOptions))
      client.once('close', () => clientAgents.delete(remoteHostname))
    })
  }

  const handleTunnelUpgrade = (req: Req, socket: TcpSocket): void => {
    const {
      'x-tunnel-id': tunnelId,
      'x-tunnel-hostname': tunnelHost
    } = req.headers
    if (!isString(tunnelId) || !isString(tunnelHost)) {
      // x-tunnel-id and x-tunnel-hostname headers are required
      socket.destroy()
      return
    }
    const tunnelHostname = getHostname(tunnelHost)
    if (isUndefined(tunnelHostname)) {
      // x-tunnel-hostname is not valid
      socket.destroy()
      return
    }
    const agent = clientAgents.get(tunnelHostname)
    if (isUndefined(agent)) {
      // no client listening
      socket.destroy()
      return
    }
    if (!agent.expectsTunnel(tunnelId)) {
      // unexpected tunnel opened
      socket.destroy()
      return
    }
    agent.emit(`tunnel-${tunnelId}`, socket)
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Connection: Upgrade\r\n' +
      'Upgrade: @http-public/tunnel\r\n' +
      '\r\n'
    )
  }

  proxyServer.on('upgrade', (req: Req, socket: TcpSocket, head: Buffer) => {
    const reqHostname = getHostname(req.headers.host)
    if (isUndefined(reqHostname)) {
      // host header is required
      socket.destroy()
      return
    }
    if (req.headers.upgrade === '@http-public/tunnel') {
      handleTunnelUpgrade(req, socket)
      return
    }
    if (reqHostname === serverHostname) {
      // a local client is connecting to the proxy server
      handleClientUpgrade(req, socket, head)
      return
    }
    // TODO: a remote client is upgrading with a proxied server
    socket.destroy()
  })

  proxyServer.on('request', (proxyReq: Req, proxyRes: Res) => {
    const hostname = getHostname(proxyReq.headers.host)
    if (isUndefined(hostname)) {
      // host header is required
      proxyRes.writeHead(400).end()
      return
    }
    const agent = clientAgents.get(hostname)
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
      remoteRes.pipe(proxyRes)
    })
    proxyReq.pipe(remoteReq)
  })

  return proxyServer
}
