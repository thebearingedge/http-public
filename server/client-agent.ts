import EventEmitter from 'events'
import { Socket as TcpSocket } from 'net'
import { Agent, AgentOptions } from 'http'
import WebSocket from 'ws'
import { v4 as uuid } from 'uuid'

type ClientAgentOptions = AgentOptions & {
  client: WebSocket
  remoteHostname: string
}

type OnConnection = {
  (err: Error | null, socket?: TcpSocket): void
}

export interface ClientAgent extends EventEmitter, Agent {}

export class ClientAgent extends Agent {

  private readonly client: WebSocket
  private readonly remoteHostname: string
  private readonly connections: TcpSocket[]
  private readonly awaitingConnection: OnConnection[]
  private readonly requestedTunnels: Set<string>
  private readonly connectingTunnels: Map<string, TcpSocket>

  constructor(options: ClientAgentOptions) {
    const { client, remoteHostname, ...agentOptions } = options
    super({ ...agentOptions, keepAlive: true, maxFreeSockets: 1 })
    this.client = client
    this.remoteHostname = remoteHostname
    this.connections = []
    this.awaitingConnection = []
    this.requestedTunnels = new Set()
    this.connectingTunnels = new Map()
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
      this.requestedTunnels.delete(tunnelId)
      this.connectingTunnels.set(tunnelId, socket)
    }

    const handleTunnelEstablished = (message: string): void => {
      const { event, payload } = JSON.parse(message)
      if (event !== 'tunnel_connection_established' ||
          payload.tunnelId !== tunnelId) {
        return
      }
      this.client.off('message', handleTunnelEstablished)
      const socket = this.connectingTunnels.get(tunnelId)!
      this.connectingTunnels.delete(tunnelId)
      callback(null, socket)
    }

    this.requestedTunnels.add(tunnelId)
    this.once(`tunnel-${tunnelId}`, handleTunnelConnecting)
    this.client.on('message', handleTunnelEstablished)
    client.send(message)
  }

  expectsTunnel(tunnelId: string): boolean {
    return this.requestedTunnels.has(tunnelId)
  }

}
