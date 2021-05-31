import EventEmitter from 'events'
import { pipeline } from 'stream'
import { Socket, connect as netConnect } from 'net'
import { TLSSocket, connect as tlsConnect } from 'tls'
import { request as httpRequest } from 'http'
import { request as httpsRequest } from 'https'
import { CLIENT_ACK } from './constants'
import { getPortNumber } from './util'

export interface TunnelCluster extends EventEmitter {
  emit(event: 'error', err: Error): boolean
  emit(event: 'connection', socket: Socket): boolean
  on(event: 'error', onError: (err: Error) => void): this
  on(event: 'connection', onConnection: (socket: Socket) => void): this
  once(event: 'error', onError: (err: Error) => void): this
  once(event: 'connection', onConnection: (socket: Socket) => void): this
}

type TunnelClusterOptions = {
  proxyUrl: URL
  localUrl: URL
  key: string
  domain: string
  request: typeof httpRequest | typeof httpsRequest
  connections: number
}

export class TunnelCluster extends EventEmitter {

  private destroyed: boolean
  private readonly options: TunnelClusterOptions
  private readonly tunnels: Set<Socket | TLSSocket>

  constructor(options: TunnelClusterOptions) {
    super()
    this.options = options
    this.destroyed = false
    this.tunnels = new Set()
  }

  private open(): void {

    const { proxyUrl, key, domain, request } = this.options

    const tunnelReqOptions = {
      headers: {
        connection: 'upgrade',
        upgrade: '@http-public/tunnel',
        'x-tunnel-key': key,
        'x-tunnel-host': domain
      }
    }

    const tunnelReq = request(proxyUrl, tunnelReqOptions)

    const onError = (err: Error): boolean => this.emit('error', err)

    tunnelReq.on('upgrade', (_, proxy) => {

      proxy.pause()
      tunnelReq.off('error', onError)

      const { localUrl } = this.options
      const { hostname: host } = localUrl
      const port = getPortNumber(localUrl)
      const local = localUrl.protocol === 'http:'
        ? netConnect({ host, port })
        : tlsConnect({ host, port, rejectUnauthorized: false })

      local.on('connect', () => {
        local.off('error', onError)
        const tunnel = pipeline(proxy, local, proxy, err => {
          this.tunnels.delete(tunnel)
          if (err != null) onError(err)
          if (this.destroyed) return
          this.open()
        })
        this.tunnels.add(tunnel)
        tunnel.write(CLIENT_ACK)
        this.emit('connection', tunnel)
      })

      local.on('error', onError)
    })

    tunnelReq.on('error', onError)
    tunnelReq.end()

  }

  connect(): void {
    let { connections } = this.options
    while (connections-- > 0) this.open()
  }

  destroy(): void {
    this.destroyed = true
    this.tunnels.forEach(tunnel => {
      tunnel.destroy()
      this.tunnels.delete(tunnel)
    })
  }

}
