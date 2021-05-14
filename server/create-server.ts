import { Socket as TcpSocket } from 'net'
import { IncomingMessage, request, Server as HttpServer } from 'http'
import { Server as WebSocketServer } from 'ws'
import { ControllerAgent } from './controller-agent'

type RemoteProxyOptions = {
  hostname: string
}

export const createServer = (options: RemoteProxyOptions): HttpServer => {
  const { hostname: serverHostname } = options
  const clients = new Map<string, ControllerAgent>()

  const httpServer = new HttpServer()
  const controlServer = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (req: IncomingMessage, socket: TcpSocket, head: Buffer) => {
    const hostname = getHostname(req.headers.host)
    if (hostname === '') {
      // hostname header is required
      socket.destroy()
      return
    }
    if (req.headers.upgrade === 'websocket') {
      if (hostname === serverHostname) {
        // a local client is connecting
        const { 'x-remote-hostname': remoteHostname } = req.headers
        if (!isString(remoteHostname)) {
          // x-remote-hostname header is required
          socket.destroy()
          return
        }
        controlServer.handleUpgrade(req, socket, head, controlSocket => {
          const agentOptions = { remoteHostname, controlSocket }
          clients.set(remoteHostname, new ControllerAgent(agentOptions))
          controlSocket.once('close', () => clients.delete(hostname))
        })
        return
      }
      // TODO: a remote client is connecting
      socket.destroy()
      return
    }
    if (req.headers.upgrade !== 'tunnel') {
      // only tunnels and websockets permitted
      socket.destroy()
      return
    }
    const {
      'x-tunnel-id': tunnelId,
      'x-tunnel-host': tunnelHost
    } = req.headers
    if (!isString(tunnelId) || !isString(tunnelHost)) {
      // x-tunnel-host and x-tunnel-id headers are required
      socket.destroy()
      return
    }

    const tunnelHostname = getHostname(tunnelHost)
    if (tunnelHostname === '') {
      // x-tunnel-host is not valid
      socket.destroy()
      return
    }
    const agent = clients.get(tunnelHostname)
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
  })

  httpServer.on('request', (req, res) => {
    const hostname = getHostname(req.headers.host)
    const agent = clients.get(hostname)
    if (isUndefined(agent)) {
      res.statusCode = 404
      res.end()
      return
    }
    const { method, url, headers } = req
    const reqOptions = { method, url, headers, agent }
    const cReq = request(reqOptions, cRes => {
      res.writeHead(cRes.statusCode, cRes.headers)
      cRes.pipe(res)
    })
    req.pipe(cReq)
  })

  return httpServer
}

function getHostname(hostHeader?: string): string {
  if (isUndefined(hostHeader)) return ''
  try {
    return new URL(`http://${hostHeader}`).hostname
  } catch (err) {}
  return ''
}

function isUndefined(value: unknown): value is void {
  return typeof value === 'undefined'
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}
