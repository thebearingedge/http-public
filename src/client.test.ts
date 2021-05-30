import { AddressInfo } from 'net'
import { randomBytes } from 'crypto'
import { Server as HttpServer } from 'http'
import mitm from 'mitm'
import { expect } from 'chai'
import { CONNECTIONS } from './constants'
import { createServer } from './server'
import { createClient } from './client'
import { isUndefined, noop } from './util'
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
      createClient({ token, subdomain, proxyUrl, localUrl }, (err, _, client) => {
        expect(err).to.equal(null)
        expect(client).to.be.an.instanceOf(TunnelCluster)
        done()
      })
    })

    it('connects to https proxies', done => {
      spy.on('request', (_, res) => res.writeHead(201).end())
      const proxyUrl = new URL(`https://${host}:${proxyPort}`)
      const localUrl = new URL(`https://${host}:${localPort}`)
      createClient({ token, subdomain, proxyUrl, localUrl }, (err, _, client) => {
        expect(err).to.equal(null)
        expect(client).to.be.an.instanceOf(TunnelCluster)
        done()
      })
    })

    it('emits the public url', done => {
      spy.on('request', (_, res) => res.writeHead(201).end())
      const proxyUrl = new URL(`http://${host}:${proxyPort}`)
      const localUrl = new URL(`http://${host}:${localPort}`)
      const options = { token, subdomain, proxyUrl, localUrl }
      createClient(options, (err, publicUrl) => {
        expect(err).to.equal(null)
        const href = `http://${subdomain}.${host}:${proxyPort}/`
        expect(publicUrl?.href).to.equal(href)
        done()
      })
    })

  })

  describe('connection', () => {

    it(`opens ${CONNECTIONS} connections by default`, done => {
      let opened = 0
      const total = CONNECTIONS * 2
      localServer.on('connection', () => {
        if (++opened < total) return
        client.destroy()
        done()
      })
      const proxyUrl = new URL(`http://${host}:${proxyPort}`)
      const localUrl = new URL(`http://${host}:${localPort}`)
      const options = { token, subdomain, proxyUrl, localUrl }
      createClient(options, (err, _, cluster) => {
        expect(err).to.equal(null)
        client = cluster!
        client.on('error', noop)
        client.on('connection', () => {
          if (++opened < total) return
          client.destroy()
          done()
        })
        client.connect()
      })
    })

    it('opens a configurable number of connections', done => {
      let opened = 0
      const connections = 5
      const total = connections * 2
      localServer.on('connection', () => {
        if (++opened < total) return
        client.destroy()
        done()
      })
      const proxyUrl = new URL(`http://${host}:${proxyPort}`)
      const localUrl = new URL(`http://${host}:${localPort}`)
      const options = { token, subdomain, proxyUrl, localUrl, connections }
      createClient(options, (err, _, cluster) => {
        expect(err).to.equal(null)
        client = cluster!
        client.on('error', noop)
        client.on('connection', () => {
          if (++opened < total) return
          client.destroy()
          done()
        })
        client.connect()
      })
    })

    it('emits an errors on broken tunnels', done => {
      const proxyUrl = new URL(`http://${host}:${proxyPort}`)
      const localUrl = new URL(`http://${host}:${localPort}`)
      const options = { token, subdomain, proxyUrl, localUrl, connections: 1 }
      createClient(options, (err, _, _client) => {
        expect(err).to.equal(null)
        client = _client!
        client.on('error', err => {
          expect(err).to.have.property('message', 'oops')
          client.destroy()
          done()
        })
        client.once('connection', socket => {
          socket.destroy(new Error('oops'))
        })
        client.connect()
      })
    })

    it('reopens closed connections', done => {
      let opened = 0
      const connections = 1
      const total = connections * 4
      localServer.on('connection', socket => {
        if (++opened < total) return socket.destroy()
        done()
      })
      const proxyUrl = new URL(`http://${host}:${proxyPort}`)
      const localUrl = new URL(`http://${host}:${localPort}`)
      const options = { token, subdomain, proxyUrl, localUrl, connections }
      createClient(options, (err, _, _client) => {
        expect(err).to.equal(null)
        client = _client!
        client.on('error', noop)
        client.on('connection', () => {
          if (++opened < total) return
          done()
        })
        client.connect()
      })
    })

    it('defaults to port 80 for local http', done => {
      let opened = 0
      const connections = 1
      const total = connections * 2
      const ports = new Set()
      const proxyUrl = new URL(`http://${host}:${proxyPort}`)
      const localUrl = new URL(`http://${host}`)
      const options = { token, subdomain, proxyUrl, localUrl, connections }
      spy = mitm()
      spy.on('connect', (socket, { port }) => {
        ports.add(port)
        if (port === proxyPort) return socket.bypass()
        if (++opened < total) return
        expect([...ports]).to.include(80)
        done()
      })
      createClient(options, (err, _, _client) => {
        expect(err).to.equal(null)
        client = _client!
        client.on('error', noop)
        client.on('connection', socket => {
          ports.add(socket.remoteAddress)
          if (++opened < total) return
          expect([...ports]).to.include(80)
          done()
        })
        client.connect()
      })
    })

    it('defaults to local port 443 for local https', done => {
      let opened = 0
      const connections = 1
      const total = connections * 2
      const ports = new Set()
      const proxyUrl = new URL(`http://${host}:${proxyPort}`)
      const localUrl = new URL(`https://${host}`)
      const options = { token, subdomain, proxyUrl, localUrl, connections }
      spy = mitm()
      spy.on('connect', (socket, { port }) => {
        ports.add(port)
        if (port === proxyPort) return socket.bypass()
        if (++opened < total) return
        expect([...ports]).to.include(443)
        done()
      })
      createClient(options, (err, _, _client) => {
        expect(err).to.equal(null)
        client = _client!
        client.on('error', noop)
        client.on('connection', socket => {
          ports.add(socket.remotePort)
          if (++opened < total) return
          expect([...ports]).to.include(443)
          done()
        })
        client.connect()
      })
    })

  })

})
