import { request as httpRequest, STATUS_CODES } from 'http'
import { request as httpsRequest } from 'https'
import { TunnelCluster } from './tunnel-cluster'
import { CONNECTIONS } from './constants'

type ClientOptions = {
  proxyUrl: URL
  localUrl: URL
  token: string
  subdomain: string
  connections?: number
}

type OnCreate = {
  (err: Error | null, url?: URL, client?: TunnelCluster): void
}

export const createClient = (options: ClientOptions, callback: OnCreate): void => {

  const {
    proxyUrl, localUrl, token, subdomain, connections = CONNECTIONS
  } = options

  const { protocol: localProtocol } = localUrl
  const { protocol: proxyProtocol } = proxyUrl

  if ((localProtocol !== 'http:' && localProtocol !== 'https:') ||
      (proxyProtocol !== 'http:' && proxyProtocol !== 'https:')) {
    const err = new Error('url protocols must be "http:" or "https:"')
    setImmediate(callback, err)
    return
  }

  const domain = `${subdomain}.${proxyUrl.hostname}`

  const clientReqOptions = {
    headers: {
      'x-tunnel-token': token,
      'x-tunnel-host': domain
    }
  }

  const request = proxyProtocol === 'http:'
    ? httpRequest
    : httpsRequest

  const clientReq = request(proxyUrl, clientReqOptions, res => {

    if (res.statusCode !== 201) {
      const statusText = STATUS_CODES[res.statusCode!]
      const err = new Error(
        `proxy server responded with status "${res.statusCode} ${statusText}"`
      )
      callback(err)
      return
    }

    res.resume()

    const publicUrl = Object.assign(new URL(proxyUrl.href), {
      hostname: domain
    })
    const client = new TunnelCluster({
      proxyUrl,
      localUrl,
      token,
      domain,
      request,
      connections
    })

    res.on('end', () => callback(null, publicUrl, client))
  })

  clientReq.once('error', callback)
  clientReq.end()

}
