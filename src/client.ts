import { request as httpRequest, STATUS_CODES } from 'http'
import { request as httpsRequest } from 'https'
import { TunnelCluster } from './tunnel-cluster'
import { once, getPortNumber } from './util'

type ClientOptions = {
  remote: URL
  local: URL
  token: string
  subdomain: string
  connections: number
  log: boolean
}

type OnCreate = {
  (err: Error | null, client?: TunnelCluster): void
}

export const createClient = (options: ClientOptions, callback: OnCreate): void => {

  const {
    remote, local, token, subdomain, connections
  } = options

  const { protocol: localProtocol, hostname: localHostname } = local
  const localPort = getPortNumber(local)
  const { protocol: remoteProtocol, hostname: remoteHostname } = remote
  const remotePort = getPortNumber(remote)

  if ((localProtocol !== 'http:' && localProtocol !== 'https:') ||
      (remoteProtocol !== 'http:' && remoteProtocol !== 'https:')) {
    throw new Error('url protocols must be "http:" or "https:"')
  }

  const request = remoteProtocol === 'http:'
    ? httpRequest
    : httpsRequest

  const done = once(callback)

  const clientReqOptions = {
    url: remote,
    headers: {
      'x-tunnel-token': token,
      'x-tunnel-host': `${subdomain}.${remote.hostname}`
    }
  }

  const clientReq = request(clientReqOptions)
    .on('error', done)
    .on('response', res => {
      if (res.statusCode !== 201) {
        const statusText = STATUS_CODES[res.statusCode!]
        done(new Error(
        `remote server responded with status "${res.statusCode} ${statusText}"`
        ))
        return
      }
      done(null, new TunnelCluster({
        remoteProtocol,
        remoteHostname,
        remotePort,
        localProtocol,
        localHostname,
        localPort,
        token,
        subdomain,
        connections
      }))
    })

  clientReq.end()

}
