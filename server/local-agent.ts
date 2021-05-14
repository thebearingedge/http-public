import EventEmitter from 'events'
import { Socket as TcpSocket } from 'net'
import { Agent, AgentOptions } from 'http'
import { v4 as uuid } from 'uuid'
import WebSocket from 'ws'

type OnConnection = {
  (err: Error | null, socket?: TcpSocket): void
}

type ControllerAgentOptions = AgentOptions & {
  client: WebSocket
  remoteHostname: string
}

export interface LocalAgent extends EventEmitter, Agent {}

export class LocalAgent extends Agent {

  private readonly remoteHostname: string
  private readonly client: WebSocket
  private readonly requested: Set<string>
  private readonly connecting: Map<string, TcpSocket>

  constructor(options: ControllerAgentOptions) {
    const { remoteHostname, client, ...agentOptions } = options
    super({ ...agentOptions, keepAlive: true, maxFreeSockets: 1 })
    this.remoteHostname = remoteHostname
    this.client = client
    this.requested = new Set()
    this.connecting = new Map()
    this.client.once('close', () => this.destroy())
  }

  createConnection(_: unknown, callback: OnConnection): void {
    const { remoteHostname, client } = this
    const tunnelId = uuid()
    const message = JSON.stringify({
      event: 'tunnel_connection_requested',
      payload: { tunnelId, remoteHostname }
    })

    const handleTunnelConnecting = (socket: TcpSocket): void => {
      this.requested.delete(tunnelId)
      this.connecting.set(tunnelId, socket)
    }

    const handleTunnelEstablished = (message: string): void => {
      const { event, payload } = JSON.parse(message)
      if (event !== 'tunnel_connection_established' ||
          payload.tunnelId !== tunnelId) {
        return
      }
      this.client.off('message', handleTunnelEstablished)
      const socket = this.connecting.get(tunnelId)!
      this.connecting.delete(tunnelId)
      callback(null, socket)
    }

    this.requested.add(tunnelId)
    this.once(`tunnel-${tunnelId}`, handleTunnelConnecting)
    this.client.on('message', handleTunnelEstablished)
    client.send(message)

  }

  expectsTunnel(tunnelId: string): boolean {
    return this.requested.has(tunnelId)
  }

}
