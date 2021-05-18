import { Socket as TcpSocket } from 'net'
import { Agent, AgentOptions } from 'http'
import { isUndefined } from './util'

export type OnConnection = {
  (err: Error | null, socket?: TcpSocket): void
}

export class TunnelAgent extends Agent {

  private tunnels: TcpSocket[]
  private tunnelQueue: TcpSocket[]
  private connectionQueue: OnConnection[]

  constructor(options: AgentOptions = {}) {
    super({ ...options, keepAlive: true, maxFreeSockets: 1 })
    this.tunnels = []
    this.tunnelQueue = []
    this.connectionQueue = []
  }

  private readonly handleClientAck = (socket: TcpSocket) => (data: Buffer): void => {
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

  private readonly handleSocketClose = (socket: TcpSocket) => (): void => {
    socket.destroy()
    this.tunnels = this.tunnels.filter(tunnel => tunnel !== socket)
    this.tunnelQueue = this.tunnelQueue.filter(tunnel => tunnel !== socket)
  }

  private readonly handleSocketError = (socket: TcpSocket) => (): void => {
    socket.emit('close')
  }

  createConnection(_: any, onConnection: OnConnection): void {
    const socket = this.tunnelQueue.shift()
    if (isUndefined(socket)) {
      this.connectionQueue.push(onConnection)
      return
    }
    setImmediate(onConnection, null, socket)
  }

  registerTunnel(socket: TcpSocket): void {
    socket.once('data', this.handleClientAck(socket))
    socket.once('error', this.handleSocketError(socket))
    socket.once('end', this.handleSocketClose(socket))
    socket.once('close', this.handleSocketClose(socket))
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
