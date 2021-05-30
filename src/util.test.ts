import { Socket } from 'net'
import { Readable } from 'stream'
import { Server as HttpServer } from 'http'
import { Server as WebSocketServer } from 'ws'

export const createLocalServer = (): HttpServer => {
  const connections: Set<Socket> = new Set()
  const localServer = new HttpServer((req, res) => {
    if (req.url === '/broken') {
      req.destroy()
      return
    }
    if (req.url === '/streaming') {
      const data = Readable.from(async function * () {
        while (true) yield 'data'
      }())
      data.pipe(res)
      return
    }
    res.end()
  })
  localServer.on('connection', socket => connections.add(socket))
  const localWebSocketServer = new WebSocketServer({ server: localServer })
  localWebSocketServer.on('connection', ws => ws.send('success!'))
  const closeServer = localServer.close
  localServer.close = (callback?: ((err?: Error) => void)) => {
    connections.forEach(socket => socket.end())
    return closeServer.call(localServer, callback)
  }
  return localServer
}
