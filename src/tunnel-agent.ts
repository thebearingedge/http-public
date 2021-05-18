import { Socket } from 'net'
import { Agent, AgentOptions } from 'http'
import { isUndefined } from './util'

export type OnConnection = {
  (err: Error | null, socket?: Socket): void
}

export class TunnelAgent extends Agent {

  private tunnels: Socket[]
  private tunnelQueue: Socket[]
  private connectionQueue: OnConnection[]

  constructor(options: AgentOptions = {}) {
    super({ ...options, keepAlive: true, maxFreeSockets: 1 })
    this.tunnels = []
    this.tunnelQueue = []
    this.connectionQueue = []
  }

  onClientAck(socket: Socket) {
    return (data: Buffer) => {
      if (data.toString() !== '\x00') {
        socket.destroy()
        return
      }
      const onConnection = this.connectionQueue.shift()
      if (isUndefined(onConnection)) {
        this.tunnelQueue.push(socket)
        return
      }
      setImmediate(onConnection, null, socket)
    }
  }

  onSocketClose(socket: Socket) {
    return () => {
      socket.destroy()
      this.tunnels = this.tunnels.filter(tunnel => tunnel !== socket)
      this.tunnelQueue = this.tunnelQueue.filter(tunnel => tunnel !== socket)
    }
  }

  onSocketError(socket: Socket) {
    return () => {
      socket.emit('close')
    }
  }

  createConnection(_: any, onConnection: OnConnection): void {
    const socket = this.tunnelQueue.shift()
    if (isUndefined(socket)) {
      this.connectionQueue.push(onConnection)
      return
    }
    setImmediate(onConnection, null, socket)
  }

  registerTunnel(socket: Socket): void {
    socket.once('data', this.onClientAck(socket))
    socket.once('error', this.onSocketError(socket))
    socket.once('end', this.onSocketClose(socket))
    socket.once('close', this.onSocketClose(socket))
    this.tunnels.push(socket)
  }

  destroy(): void {
    this.tunnels.forEach(socket => socket.destroy())
    this.connectionQueue.forEach(onConnection => {
      onConnection(new Error('agent closed'))
    })
    this.tunnels = []
    this.tunnelQueue = []
    this.connectionQueue = []
    super.destroy()
  }

}
