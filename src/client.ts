import { request as httpRequest, STATUS_CODES } from 'http'
import { request as httpsRequest } from 'https'
import { TunnelCluster } from './tunnel-cluster'
import { CONNECTIONS } from './constants'
import { once } from './util'

type ClientOptions = {
  proxyUrl: URL
  localUrl: URL
  token: string
  subdomain: string
  connections?: number
}

type OnCreate = {
  (err: Error | null, client?: TunnelCluster): void
}

export const createClient = (options: ClientOptions, callback: OnCreate): void => {

  const done = once(callback)

  const {
    proxyUrl, localUrl, token, subdomain, connections = CONNECTIONS
  } = options

  const { protocol: localProtocol } = localUrl
  const { protocol: proxyProtocol } = proxyUrl

  if ((localProtocol !== 'http:' && localProtocol !== 'https:') ||
      (proxyProtocol !== 'http:' && proxyProtocol !== 'https:')) {
    const err = new Error('url protocols must be "http:" or "https:"')
    setImmediate(done, err)
    return
  }

  const request = proxyProtocol === 'http:'
    ? httpRequest
    : httpsRequest

  const clientReqOptions = {
    headers: {
      'x-tunnel-token': token,
      'x-tunnel-host': `${subdomain}.${proxyUrl.hostname}`
    }
  }

  const clientReq = request(proxyUrl, clientReqOptions, res => {
    if (res.statusCode !== 201) {
      const statusText = STATUS_CODES[res.statusCode!]
      const err = new Error(
        `proxy server responded with status "${res.statusCode} ${statusText}"`
      )
      done(err)
      return
    }
    const client = new TunnelCluster({
      proxyUrl,
      localUrl,
      token,
      subdomain,
      connections
    })
    done(null, client)
  })

  clientReq.on('error', done)
  clientReq.end()

}
