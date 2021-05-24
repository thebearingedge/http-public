import { request as httpRequest, STATUS_CODES } from 'http'
import { request as httpsRequest } from 'https'
import { Client } from './tunnel-cluster'
import { once } from './util'

type ClientOptions = {
  proxyUrl: URL
  localUrl: URL
  token: string
  subdomain: string
  connections: number
  log: boolean
}

type OnCreate = {
  (err: Error | null, client?: Client): void
}

export const createClient = (options: ClientOptions, callback: OnCreate): void => {

  const done = once(callback)

  const { proxyUrl, localUrl, token, subdomain, connections } = options

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
    url: proxyUrl,
    headers: {
      'x-tunnel-token': token,
      'x-tunnel-host': `${subdomain}.${proxyUrl.hostname}`
    }
  }

  const clientReq = request(clientReqOptions)

  clientReq.on('error', done)

  clientReq.on('response', res => {
    if (res.statusCode !== 201) {
      const statusText = STATUS_CODES[res.statusCode!]
      const err = new Error(
        `proxy server responded with status "${res.statusCode} ${statusText}"`
      )
      done(err)
      return
    }
    const client = new Client({
      proxyUrl,
      localUrl,
      token,
      subdomain,
      connections
    })
    done(null, client)
  })

  clientReq.end()

}