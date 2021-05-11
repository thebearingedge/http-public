import { Server as WebSocketServer } from 'ws'

// eslint-disable-next-line no-console
const log = (...data: any[]): void => console.log('Server:', ...data)

const server = new WebSocketServer({ port: 3000 })

server.on('connection', socket => {
  log('connection received')
  socket.on('message', data => {
    log('received:', data)
  })
})
