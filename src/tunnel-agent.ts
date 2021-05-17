import EventEmitter from 'events'
import { Socket as TcpSocket } from 'net'
import { Agent, AgentOptions } from 'http'
import { defer, isUndefined } from './util'

export type OnConnection = {
  (err: Error | null, socket?: TcpSocket): void
}

export interface TunnelAgent extends EventEmitter, Agent {}

export class TunnelAgent extends Agent {

  private tunnels: TcpSocket[]
  private connectionCallbacks: OnConnection[]

  constructor(options: AgentOptions = {}) {
    super({ ...options, keepAlive: true, maxFreeSockets: 1 })
    this.tunnels = []
    this.connectionCallbacks = []
    this.on('close', this.handleClose)
    this.on('tunnel', this.handleTunnel)
  }

  private readonly handleSocketClose = (socket: TcpSocket) => (): void => {
    socket.destroy()
    this.tunnels = this.tunnels.filter(_socket => _socket !== socket)
  }

  private readonly handleSocketError = (socket: TcpSocket) => (): void => {
    socket.emit('close')
  }

  private readonly handleClose = (): void => {
    this.tunnels.forEach(socket => socket.destroy())
    this.connectionCallbacks.forEach(onConnection => {
      onConnection(new Error('agent closed'))
    })
    this.destroy()
    this.tunnels = []
    this.connectionCallbacks = []
  }

  private readonly handleTunnel = (socket: TcpSocket): void => {
    socket.once('error', this.handleSocketError(socket))
    socket.once('close', this.handleSocketClose(socket))
    const onConnection = this.connectionCallbacks.shift()
    if (isUndefined(onConnection)) {
      this.tunnels.push(socket)
      return
    }
    defer(onConnection, null, socket)
  }

  createConnection(_: unknown, onConnection: OnConnection): void {
    const socket = this.tunnels.shift()
    if (isUndefined(socket)) {
      this.connectionCallbacks.push(onConnection)
      return
    }
    defer(onConnection, null, socket)
  }

}
