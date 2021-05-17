import EventEmitter from 'events'
import { Socket as TcpSocket } from 'net'
import { Agent, AgentOptions } from 'http'
import { isUndefined } from './util'

export type OnConnection = {
  (err: Error | null, socket?: TcpSocket): void
}

export interface TunnelAgent extends EventEmitter, Agent {
  emit(event: 'close'): boolean
  emit(event: 'tunnel', socket: TcpSocket): boolean
}

export class TunnelAgent extends Agent {

  private tunnels: TcpSocket[]
  private tunnelQueue: TcpSocket[]
  private callbackQueue: OnConnection[]

  constructor(options: AgentOptions = {}) {
    super({ ...options, keepAlive: true, maxFreeSockets: 1 })
    this.tunnels = []
    this.tunnelQueue = []
    this.callbackQueue = []
    this.on('close', this.handleClose)
    this.on('tunnel', this.handleTunnel)
  }

  private readonly handleSocketClose = (socket: TcpSocket) => (): void => {
    socket.destroy()
    this.tunnels = this.tunnels.filter(tunnel => tunnel !== socket)
    this.tunnelQueue = this.tunnelQueue.filter(tunnel => tunnel !== socket)
  }

  private readonly handleSocketError = (socket: TcpSocket) => (): void => {
    socket.emit('close')
  }

  private readonly handleClose = (): void => {
    this.tunnels.forEach(socket => socket.destroy())
    this.callbackQueue.forEach(onConnection => {
      onConnection(new Error('agent closed'))
    })
    this.destroy()
    this.tunnels = []
    this.tunnelQueue = []
    this.callbackQueue = []
  }

  private readonly handleTunnel = (socket: TcpSocket): void => {
    socket.once('error', this.handleSocketError(socket))
    socket.once('close', this.handleSocketClose(socket))
    this.tunnels.push(socket)
    const handleClientAck = (data: Buffer): void => {
      if (String(data) !== '\0') {
        socket.destroy()
        return
      }
      socket.off('data', handleClientAck)
      const onConnection = this.callbackQueue.shift()
      if (isUndefined(onConnection)) {
        this.tunnelQueue.push(socket)
        return
      }
      setImmediate(onConnection, null, socket)
    }
    socket.on('data', handleClientAck)
  }

  createConnection(_: unknown, onConnection: OnConnection): void {
    const socket = this.tunnelQueue.shift()
    if (isUndefined(socket)) {
      this.callbackQueue.push(onConnection)
      return
    }
    setImmediate(onConnection, null, socket)
  }

}
