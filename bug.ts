import assert from 'assert'
import { pipeline } from 'stream'
import { Socket, connect, AddressInfo } from 'net'
import { request, Server, IncomingMessage, ServerResponse } from 'http'

type Servers = {
  proxyServer: Server
  localServer: Server
}

type TunnelCallback = (tunnel: Socket) => void

const noop = (..._: any[]): void => {}

startServers(({ proxyServer, localServer }) => {

  const { port: proxyPort } = proxyServer.address() as AddressInfo
  const { port: localPort } = localServer.address() as AddressInfo

  const localSocket = connect({ port: localPort })
  const remoteReq = request({ port: proxyPort }, remoteRes => {
    remoteRes.resume()
    remoteRes.on('end', () => {
      assert.strictEqual(remoteRes.statusCode!, 418)
      process.stdout.write('success\n' + new Date().toString() + '\n')
      process.exit(0)
    })
  })
  remoteReq.end()
  const clientReqOptions = {
    port: proxyPort,
    headers: {
      connection: 'upgrade',
      upgrade: 'tunnel'
    }
  }
  const clientReq = request(clientReqOptions)
  clientReq.once('upgrade', (_, clientSocket) => {
    const stream = pipeline([clientSocket, localSocket, clientSocket], noop)
    stream.write('\x00')
  })
  clientReq.end()
})

function startServers(done: (servers: Servers) => void): void {

  const proxyServer = new Server()
  const localServer = new Server((_, res) => {
    res.writeHead(418).end()
  })

  const requestQueue: TunnelCallback[] = []

  proxyServer.on('upgrade', (_: IncomingMessage, client: Socket) => {
    client.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Connection: Upgrade\r\n' +
      'Upgrade: tunnel\r\n' +
      '\r\n'
    )
    client.once('data', (data: Buffer) => {
      assert.strictEqual(data.toString(), '\x00')
      const onTunnel = requestQueue.shift()!
      setImmediate(onTunnel, client)
    })
  })

  proxyServer.on('request', (proxyReq: IncomingMessage, proxyRes: ServerResponse) => {
    requestQueue.push((client: Socket) => {
      const { method, url, headers } = proxyReq
      const tunneledReqOptions = {
        method,
        url,
        headers,
        createConnection: () => client
      }
      const tunneledReq = request(tunneledReqOptions, tunneledRes => {
        proxyRes.writeHead(tunneledRes.statusCode!, tunneledRes.rawHeaders)
        pipeline([tunneledRes, proxyRes], noop)
      })
      pipeline([proxyReq, tunneledReq], noop)
    })
  })

  proxyServer.listen(0, '127.0.0.1', () => {
    localServer.listen(0, '127.0.0.1', () => {
      done({ proxyServer, localServer })
    })
  })

}
