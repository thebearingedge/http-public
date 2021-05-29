import EventEmitter from 'events'
import { Stream, pipeline } from 'stream'
import { connect as tlsConnect } from 'tls'
import { connect as netConnect } from 'net'
import { request as httpRequest } from 'http'
import { request as httpsRequest } from 'https'
import { CLIENT_ACK, getPortNumber } from './util'

export interface TunnelCluster extends EventEmitter {
  emit(event: 'request'): boolean
  emit(event: 'error', err: Error): boolean
  on(event: 'request', onRequest: (info: string) => void): this
  on(event: 'error', onError: (err: Error) => void): this
}

type TunnelClusterOptions = {
  proxyUrl: URL
  localUrl: URL
  token: string
  subdomain: string
  connections: number
}

export class Client extends EventEmitter {

  private readonly options: TunnelClusterOptions
  private readonly tunnels: Set<Stream>

  constructor(options: TunnelClusterOptions) {
    super()
    this.options = options
    this.tunnels = new Set()
  }

  private open(): void {

    const { proxyUrl, token, subdomain } = this.options

    const request = proxyUrl.protocol === 'http:'
      ? httpRequest
      : httpsRequest

    const tunnelReqOptions = {
      headers: {
        connection: 'upgrade',
        upgrade: '@http-public/tunnel',
        'x-tunnel-token': token,
        'x-tunnel-host': `${subdomain}.${proxyUrl.hostname}`
      }
    }

    const tunnelReq = request(proxyUrl, tunnelReqOptions)

    tunnelReq.on('upgrade', (_, remote) => {

      remote.pause()

      const { localUrl } = this.options
      const port = getPortNumber(localUrl)
      const { hostname: host } = localUrl
      const local = localUrl.protocol === 'http:'
        ? netConnect({ host, port })
        : tlsConnect({ host, port, rejectUnauthorized: false })

      local.on('connect', () => {
        const stream = pipeline(remote, local, remote, err => {
          if (err != null) this.emit('error', err)
          this.tunnels.delete(stream)
          local.destroy()
          remote.destroy()
          this.open()
        })
        this.tunnels.add(stream)
        stream.write(CLIENT_ACK)
      })
    })

    tunnelReq.end()

  }

  connect(): void {
    let { connections } = this.options
    while (connections-- > 0) this.open()
  }

}
