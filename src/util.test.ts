import { Socket } from 'net'
import { Readable } from 'stream'
import { Server as HttpServer } from 'http'
import { Server as WebSocketServer } from 'ws'

export const createLocalServer = (): HttpServer => {

  const server = new HttpServer()
  const connections: Set<Socket> = new Set()

  server.on('connection', socket => {
    socket.once('close', () => connections.delete(socket))
    connections.add(socket)
  })

  server.on('request', (req, res) => {
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

  new WebSocketServer({ server }).on('connection', ws => {
    ws.send('success!')
  })

  const closeServer = server.close

  server.close = (callback?: (err?: Error) => void) => {
    connections.forEach(socket => {
      connections.delete(socket)
      socket.destroy()
    })
    return closeServer.call(server, callback)
  }

  return server
}
