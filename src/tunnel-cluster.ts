import EventEmitter from 'events'
import { request as httpRequest } from 'http'
import { request as httpsRequest } from 'https'
import { connect as tlsConnect } from 'tls'
import { connect as netConnect, Socket } from 'net'
import { WebProtocol } from './util'

export interface TunnelCluster extends EventEmitter {
  emit(event: 'request'): boolean
  on(event: 'request', onRequest: (info: string) => void): this
}

type LocalSocket = Socket

type RemoteSocket = Socket

type TunnelClusterOptions = {
  remoteProtocol: WebProtocol
  remoteHostname: string
  remotePort: number
  localProtocol: WebProtocol
  localHostname: string
  localPort: number
  token: string
  subdomain: string
  connections: number
}

export class TunnelCluster extends EventEmitter {

  private readonly options: TunnelClusterOptions
  private readonly tunnels: Map<LocalSocket, RemoteSocket>

  constructor(options: TunnelClusterOptions) {
    super()
    this.options = options
    this.tunnels = new Map()
  }

  connect(): void {

  }

}
