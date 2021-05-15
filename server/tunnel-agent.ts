import EventEmitter from 'events'
import { Socket as TcpSocket } from 'net'
import { Agent, AgentOptions } from 'http'
import { isUndefined } from './util'

type OnConnection = {
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
    this.tunnels = this.tunnels.filter(_socket => _socket !== socket)
  }

  private readonly handleSocketError = (socket: TcpSocket) => (): void => {
    socket.destroy()
  }

  private readonly handleClose = (): void => {
    this.tunnels.forEach(socket => socket.destroy())
    this.connectionCallbacks.forEach(onConnection => {
      onConnection(new Error('agent closed'))
    })
    this.tunnels = []
    this.connectionCallbacks = []
    this.destroy()
  }

  private readonly handleTunnel = (socket: TcpSocket): void => {
    socket.once('close', this.handleSocketClose(socket))
    socket.once('error', this.handleSocketError(socket))
    const onConnection = this.connectionCallbacks.shift()
    if (isUndefined(onConnection)) {
      this.tunnels.push(socket)
      return
    }
    setImmediate(onConnection, null, socket)
  }

  createConnection(_: unknown, onConnection: OnConnection): void {
    const socket = this.tunnels.shift()
    if (isUndefined(socket)) {
      this.connectionCallbacks.push(onConnection)
      return
    }
    setImmediate(onConnection, null, socket)
  }

}
