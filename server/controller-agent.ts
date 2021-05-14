import EventEmitter from 'events'
import { Socket as TcpSocket } from 'net'
import { Agent, AgentOptions } from 'http'
import { v4 as uuid } from 'uuid'
import WebSocket from 'ws'

type OnConnection = {
  (err: Error | null, socket?: TcpSocket): void
}

type ControllerAgentOptions = AgentOptions & {
  remoteHostname: string
  controlSocket: WebSocket
}

export interface ControllerAgent extends EventEmitter, Agent {}

export class ControllerAgent extends Agent {

  private readonly remoteHostname: string
  private readonly controlSocket: WebSocket
  private readonly awaiting: Set<string>
  private readonly connecting: Map<string, TcpSocket>

  constructor(options: ControllerAgentOptions) {
    const { remoteHostname, controlSocket, ...agentOptions } = options
    super({ ...agentOptions, keepAlive: true, maxFreeSockets: 1 })
    this.remoteHostname = remoteHostname
    this.awaiting = new Set()
    this.connecting = new Map()
    this.controlSocket = controlSocket
    controlSocket.once('close', () => this.destroy())
  }

  createConnection(_: unknown, callback: OnConnection): void {
    const { remoteHostname, controlSocket } = this
    const tunnelId = uuid()
    const message = JSON.stringify({
      event: 'client_connection_requested',
      payload: { tunnelId, remoteHostname }
    })

    const handleTunnelOpened = (tunnel: TcpSocket): void => {
      this.awaiting.delete(tunnelId)
      this.connecting.set(tunnelId, tunnel)
    }

    const handleTunnelConnected = (data: string): void => {
      const { event, payload } = JSON.parse(data)
      if (event !== 'client_connection_established' ||
          payload.tunnelId !== tunnelId) {
        return
      }
      this.controlSocket.off('message', handleTunnelConnected)
      const tunnel = this.connecting.get(payload.tunnelId)!
      this.connecting.delete(tunnelId)
      callback(null, tunnel)
    }

    this.once(`tunnel-${tunnelId}`, handleTunnelOpened)
    this.controlSocket.on('message', handleTunnelConnected)
    this.awaiting.add(tunnelId)
    controlSocket.send(message)
  }

  expectsTunnel(tunnelId: string): boolean {
    return this.awaiting.has(tunnelId)
  }

}
