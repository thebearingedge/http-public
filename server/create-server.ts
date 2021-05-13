import { Socket } from 'net'
import { Server, IncomingMessage, ServerResponse, request } from 'http'

type TunnelOptions = {
  hostname?: string
}

export function createServer(options: TunnelOptions = {}): Server {
  const { hostname: serverHostname = 'localhost' } = options
  const httpServer = new Server()
  const remotes = new Map<string, Socket>()

  httpServer.on('connect', (req: IncomingMessage, socket: Socket) => {

  })

  httpServer.on('upgrade', (req: IncomingMessage, socket: Socket) => {
    const targetHostname = getHostname(req.headers.host)
    if (targetHostname === '') {
      socket.destroy()
      return
    }
    if (targetHostname === serverHostname) {
      if (req.headers.upgrade !== 'tunnel') {
        socket.destroy()
        return
      }
      if (remotes.has(targetHostname)) {
        socket.destroy()
        return
      }
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Connection: upgrade\r\n' +
        'Upgrade: tunnel\r\n' +
        '\r\n',
        () => remotes.set(targetHostname, socket)
      )
      return
    }
    const remote = remotes.get(targetHostname)
    if (typeof remote === 'undefined') {
      socket.destroy()
      return
    }
    const head = [
      `${req.method!} ${req.url!} HTTP/${req.httpVersion}`,
      ...req.rawHeaders.map(([key, value]) => `${key}: ${value}`),
      '\r\n'
    ].join('\r\n')
  })

  httpServer.on('request', (publicReq: IncomingMessage, publicRes: ServerResponse) => {
    const hostname = getHostname(publicReq.headers.host)
    if (hostname === '') {
      publicRes.writeHead(400)
      publicRes.end('invalid host header')
      return
    }
    const socket = remotes.get(hostname)
    if (typeof socket === 'undefined') {
      publicRes.statusCode = 404
      publicRes.end()
      return
    }
    const { url: path, method, headers } = publicReq
    const createConnection = (): Socket => socket
    const tunnelReqOptions = { method, path, headers, createConnection }
    const tunnelReq = request(tunnelReqOptions, tunnelRes => {
      const { statusCode, headers } = tunnelRes
      publicRes.writeHead(statusCode!, headers)
      tunnelRes.pipe(publicRes)
    })
    publicReq.pipe(tunnelReq)
  })

  return httpServer
}

function getHostname(hostHeader?: string): string {
  if (typeof hostHeader === 'undefined') return ''
  try {
    const { hostname } = new URL(`http://${hostHeader}`)
    return hostname
  } catch (err) {}
  return ''
}

// eslint-disable-next-line no-console
const log = (...data: any[]): void => console.log('Server -', ...data)
