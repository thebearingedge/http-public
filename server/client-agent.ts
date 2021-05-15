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
  private awaitingConnections: OnConnection[]

  constructor(options: AgentOptions = {}) {
    super({ ...options, keepAlive: true, maxFreeSockets: 1 })
    this.tunnels = []
    this.awaitingConnections = []
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
    this.awaitingConnections.forEach(onConnection => {
      onConnection(new Error('agent closed'))
    })
    this.tunnels = []
    this.awaitingConnections = []
    this.destroy()
  }

  private readonly handleTunnel = (socket: TcpSocket): void => {
    socket.once('close', this.handleSocketClose(socket))
    socket.once('error', this.handleSocketError(socket))
    const onConnection = this.awaitingConnections.shift()
    if (isUndefined(onConnection)) {
      this.tunnels.push(socket)
      return
    }
    setImmediate(onConnection, null, socket)
  }

  createConnection(_: unknown, onConnection: OnConnection): void {
    const socket = this.tunnels.shift()
    if (isUndefined(socket)) {
      this.awaitingConnections.push(onConnection)
      return
    }
    setImmediate(onConnection, null, socket)
  }

}
