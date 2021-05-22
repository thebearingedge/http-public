import { Socket } from 'net'
import EventEmitter from 'events'
import { Agent, AgentOptions } from 'http'
import { isUndefined, CLIENT_ACK, IDLE_TIMEOUT } from './util'

export type OnConnection = {
  (err: Error | null, socket?: Socket): void
}

export type AgentOverrides = 'keepAlive' | 'maxFreeSockets'

export type TunnelAgentOptions = Omit<AgentOptions, AgentOverrides>

export interface TunnelAgent extends Agent, EventEmitter {
  on(event: 'timeout', onTimeout: (this: TunnelAgent) => void): this
  emit(event: 'timeout'): boolean
}

export class TunnelAgent extends Agent {

  private closed: boolean
  private tunnels: Socket[]
  private tunnelQueue: Socket[]
  private requestQueue: OnConnection[]
  private idleTimeout?: NodeJS.Timeout

  constructor(options: TunnelAgentOptions = {}) {
    super({ ...options, keepAlive: true, maxFreeSockets: 1 })
    this.closed = false
    this.tunnels = []
    this.tunnelQueue = []
    this.requestQueue = []
    this.idleTimeout = setTimeout(this.onIdleTimeout, IDLE_TIMEOUT).unref()
  }

  onIdleTimeout = (): void => {
    this.emit('timeout')
    this.destroy()
  }

  clearIdleTimeout(): void {
    if (!isUndefined(this.idleTimeout)) {
      clearTimeout(this.idleTimeout)
      this.idleTimeout = undefined
    }
  }

  onClientAck(socket: Socket) {
    // don't use the socket right away
    // wait for the client to be ready
    return (data: Buffer) => {
      if (data.toString() !== CLIENT_ACK) {
        socket.destroy(new Error('bad client ack'))
        return
      }
      this.clearIdleTimeout()
      const onConnection = this.requestQueue.shift()
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
      if (!this.closed && this.tunnels.length === 0) {
        this.idleTimeout = setTimeout(this.onIdleTimeout, IDLE_TIMEOUT).unref()
      }
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
      this.requestQueue.push(onConnection)
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

  destroy = (): void => {
    this.closed = true
    this.clearIdleTimeout()
    this.tunnels.forEach(socket => socket.destroy())
    this.requestQueue.forEach(onConnection => {
      onConnection(new Error('agent closed'))
    })
    this.tunnels = []
    this.tunnelQueue = []
    this.requestQueue = []
    super.destroy()
  }

}
