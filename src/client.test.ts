import { AddressInfo } from 'net'
import { randomBytes } from 'crypto'
import { Server as HttpServer } from 'http'
import mitm from 'mitm'
import { expect } from 'chai'
import { createServer } from './server'
import { createClient } from './client'
import { noop, isUndefined, CONNECTIONS } from './util'
import { createLocalServer } from './util.test'
import { TunnelCluster } from './tunnel-cluster'

describe('client', () => {

  const host = 'localhost'
  const subdomain = 'test'
  const token = randomBytes(8).toString('base64')

  let proxyPort: number
  let proxyServer: HttpServer
  let localPort: number
  let localServer: HttpServer
  let client: TunnelCluster
  let spy: ReturnType<typeof mitm>

  beforeEach('start servers', done => {
    proxyServer = createServer({ host, token }).listen(0, host, () => {
      ({ port: proxyPort } = proxyServer.address() as AddressInfo)
      localServer = createLocalServer().listen(0, host, () => {
        ({ port: localPort } = localServer.address() as AddressInfo)
        done()
      })
    })
  })

  afterEach('stop servers', done => {
    if (!isUndefined(spy)) spy.disable()
    if (!isUndefined(client)) client.destroy()
    localServer.close(() => proxyServer.close(done))
  })

  describe('creation', () => {

    beforeEach(() => { spy = mitm() })

    it('requires an http(s) proxy protocol', done => {
      const proxyUrl = new URL(`fake://${host}:${proxyPort}`)
      const localUrl = new URL(`http://${host}:${localPort}`)
      createClient({ token, subdomain, proxyUrl, localUrl }, err => {
        const message = 'url protocols must be "http:" or "https:"'
        expect(err).to.have.property('message', message)
        done()
      })
    })

    it('requires an http(s) local protocol', done => {
      const proxyUrl = new URL(`http://${host}:${localPort}`)
      const localUrl = new URL(`fake://${host}:${proxyPort}`)
      createClient({ token, subdomain, proxyUrl, localUrl }, err => {
        const message = 'url protocols must be "http:" or "https:"'
        expect(err).to.have.property('message', message)
        done()
      })
    })

    it('handles subdomain conflicts', done => {
      spy.on('request', (_, res) => res.writeHead(409).end())
      const proxyUrl = new URL(`http://${host}:${localPort}`)
      const localUrl = new URL(`http://${host}:${proxyPort}`)
      createClient({ token, subdomain, proxyUrl, localUrl }, err => {
        const message = 'proxy server responded with status "409 Conflict"'
        expect(err).to.have.property('message', message)
        done()
      })
    })

    it('connects to http proxies', done => {
      spy.on('request', (_, res) => res.writeHead(201).end())
      const proxyUrl = new URL(`http://${host}:${localPort}`)
      const localUrl = new URL(`http://${host}:${proxyPort}`)
      createClient({ token, subdomain, proxyUrl, localUrl }, (err, client) => {
        expect(err).to.equal(null)
        expect(client).to.be.an.instanceOf(TunnelCluster)
        done()
      })
    })

    it('connects to https proxies', done => {
      spy.on('request', (_, res) => res.writeHead(201).end())
      const proxyUrl = new URL(`https://${host}:${proxyPort}`)
      const localUrl = new URL(`https://${host}:${localPort}`)
      createClient({ token, subdomain, proxyUrl, localUrl }, (err, client) => {
        expect(err).to.equal(null)
        expect(client).to.be.an.instanceOf(TunnelCluster)
        done()
      })
    })

  })

  describe('connection', () => {

    it('opens 10 connections', done => {
      let openSockets = 0
      const totalSockets = 20
      localServer.on('connection', () => {
        if (++openSockets < totalSockets) return
        done()
      })
      const proxyUrl = new URL(`http://${host}:${proxyPort}`)
      const localUrl = new URL(`http://${host}:${localPort}`)
      const options = { token, subdomain, proxyUrl, localUrl }
      createClient(options, (err, _client) => {
        expect(err).to.equal(null)
        client = _client!
        client.connect()
        client.on('connection', () => {
          if (++openSockets < totalSockets) return
          done()
        })
      })
    })

    it('opens a configurable number of connections', done => {
      let openSockets = 0
      const totalSockets = CONNECTIONS * 2
      localServer.on('connection', () => {
        if (++openSockets < totalSockets) return
        done()
      })
      const proxyUrl = new URL(`http://${host}:${proxyPort}`)
      const localUrl = new URL(`http://${host}:${localPort}`)
      const connections = totalSockets / 2
      const options = { token, subdomain, proxyUrl, localUrl, connections }
      createClient(options, (err, _client) => {
        expect(err).to.equal(null)
        client = _client!
        client.connect()
        client.on('connection', () => {
          if (++openSockets < totalSockets) return
          done()
        })
      })
    })

    it('emits the public url when connections are opened', done => {
      const proxyUrl = new URL(`http://${host}:${proxyPort}`)
      const localUrl = new URL(`http://${host}:${localPort}`)
      const options = { token, subdomain, proxyUrl, localUrl, connections: 1 }
      createClient(options, (err, _client) => {
        expect(err).to.equal(null)
        client = _client!
        client.connect()
        client.on('online', publicUrl => {
          expect(publicUrl.href).to.equal(`http://${subdomain}.${host}:${proxyPort}/`)
          done()
        })
      })
    })

    it('reopens closed connections', done => {
      let reconnects = 0
      localServer.on('connection', socket => {
        if (reconnects++ !== 1) return socket.destroy()
        done()
      })
      const proxyUrl = new URL(`http://${host}:${proxyPort}`)
      const localUrl = new URL(`http://${host}:${localPort}`)
      const options = { token, subdomain, proxyUrl, localUrl, connections: 1 }
      createClient(options, (err, _client) => {
        expect(err).to.equal(null)
        client = _client!
        client.connect()
      })
    })

    it('defaults to port 80 for http', done => {
      const proxyUrl = new URL(`http://${host}:${proxyPort}`)
      const localUrl = new URL(`http://${host}`)
      const options = { token, subdomain, proxyUrl, localUrl, connections: 1 }
      spy = mitm()
      spy.on('connect', (socket, options) => {
        if (options.port === proxyPort) return socket.bypass()
        expect(options.port).to.equal(80)
        done()
      })
      createClient(options, (err, _client) => {
        expect(err).to.equal(null)
        client = _client!
        client.on('error', noop)
        client.connect()
      })
    })

    it('defaults to port 443 for https', done => {
      const proxyUrl = new URL(`http://${host}:${proxyPort}`)
      const localUrl = new URL(`https://${host}`)
      const options = { token, subdomain, proxyUrl, localUrl, connections: 1 }
      spy = mitm()
      spy.on('connect', (socket, options) => {
        if (options.port === proxyPort) return socket.bypass()
        expect(options.port).to.equal(443)
        done()
      })
      createClient(options, (err, _client) => {
        expect(err).to.equal(null)
        client = _client!
        client.on('error', noop)
        client.connect()
      })
    })

  })

})
