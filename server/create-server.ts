import { Socket as TcpSocket } from 'net'
import { IncomingMessage as Req, request, Server as HttpServer, ServerResponse } from 'http'
import { Server as WebSocketServer } from 'ws'
import { LocalAgent } from './local-agent'

type ProxyServerOptions = {
  hostname: string
}

export const createServer = (options: ProxyServerOptions): HttpServer => {

  const { hostname: serverHostname } = options
  const localAgents = new Map<string, LocalAgent>()

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
      localAgents.set(remoteHostname, new LocalAgent(agentOptions))
      client.once('close', () => localAgents.delete(remoteHostname))
    })
  }

  const handleTunnelUpgrade = (req: Req, socket: TcpSocket): void => {
    const {
      'x-tunnel-id': tunnelId,
      'x-tunnel-host': tunnelHost
    } = req.headers
    if (!isString(tunnelId) || !isString(tunnelHost)) {
      // x-tunnel-id and x-tunnel-tunnel headers are required
      socket.destroy()
      return
    }
    const tunnelHostname = getHostname(tunnelHost)
    if (isUndefined(tunnelHostname)) {
      // x-tunnel-host is not valid
      socket.destroy()
      return
    }
    const agent = localAgents.get(tunnelHostname)
    if (isUndefined(agent)) {
      // no client listening
      socket.destroy()
      return
    }
    if (!agent.expectsTunnel(tunnelId)) {
      // unnecessary tunnel started
      socket.destroy()
      return
    }
    agent.emit(`tunnel-${tunnelId}`, socket)
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Connection: Upgrade\r\n' +
      'Upgrade: tunnel\r\n' +
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
      // a local client is connecting
      handleClientUpgrade(req, socket, head)
      return
    }
    // TODO: a remote client is upgrading
    // only tunnels and websockets allowed
    socket.destroy()
  })

  proxyServer.on('request', (proxyReq: Req, proxyRes: ServerResponse) => {
    const hostname = getHostname(proxyReq.headers.host)
    if (isUndefined(hostname)) {
      // host header is required
      proxyRes.writeHead(404).end()
      return
    }
    const agent = localAgents.get(hostname)
    if (isUndefined(agent)) {
      // no localAgents are serving this hostname
      proxyRes.writeHead(404).end()
      return
    }
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

const getHostname = (value: unknown): string | undefined => {
  if (!isString(value)) return
  try {
    return new URL(`http://${value}`).hostname
  } catch (err) {}
}

const isUndefined = (value: unknown): value is void => {
  return typeof value === 'undefined'
}

const isString = (value: unknown): value is string => {
  return typeof value === 'string'
}
