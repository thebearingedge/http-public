import EventEmitter from 'events'
import { Stream, pipeline } from 'stream'
import { connect as tlsConnect } from 'tls'
import { connect as netConnect } from 'net'
import { request as httpRequest } from 'http'
import { request as httpsRequest } from 'https'
import { CLIENT_ACK, getPortNumber } from './util'

export interface TunnelCluster extends EventEmitter {
  emit(event: 'error', err: Error): boolean
  emit(event: 'connect', url: URL): boolean
  on(event: 'error', onError: (err: Error) => void): this
  on(event: 'connect', onConnect: (url: URL) => void): this
}

type TunnelClusterOptions = {
  proxyUrl: URL
  localUrl: URL
  token: string
  subdomain: string
  connections: number
}

export class TunnelCluster extends EventEmitter {

  private readonly options: TunnelClusterOptions
  private readonly tunnels: Set<Stream>

  constructor(options: TunnelClusterOptions) {
    super()
    this.options = options
    this.tunnels = new Set()
  }

  private open(): void {

    const { proxyUrl, token, subdomain } = this.options
    const domain = `${subdomain}.${proxyUrl.hostname}`

    const request = proxyUrl.protocol === 'http:'
      ? httpRequest
      : httpsRequest

    const tunnelReqOptions = {
      headers: {
        connection: 'upgrade',
        upgrade: '@http-public/tunnel',
        'x-tunnel-token': token,
        'x-tunnel-host': domain
      }
    }

    const tunnelReq = request(proxyUrl, tunnelReqOptions)

    tunnelReq.on('upgrade', (_, proxy) => {
      proxy.pause()
      const { localUrl, connections } = this.options
      const { hostname: host } = localUrl
      const port = getPortNumber(localUrl)
      const local = localUrl.protocol === 'http:'
        ? netConnect({ host, port })
        : tlsConnect({ host, port, rejectUnauthorized: false })
      local.on('connect', () => {
        const tunnel = pipeline(proxy, local, proxy, err => {
          if (err != null) this.emit('error', err)
          this.tunnels.delete(tunnel)
          this.open()
        })
        tunnel.write(CLIENT_ACK)
        this.tunnels.add(tunnel)
        if (this.tunnels.size === connections) {
          const publicUrl = new URL('', proxyUrl)
          publicUrl.hostname = domain
          this.emit('connect', publicUrl)
        }
      })
    })

    tunnelReq.end()

  }

  connect(): void {
    let { connections } = this.options
    while (connections-- > 0) this.open()
  }

}
