import { pipeline } from 'stream'
import { request, Server as HttpServer } from 'http'
import { connect, AddressInfo, Socket as TcpSocket } from 'net'
import WebSocket, { Server as WebSocketServer } from 'ws'
import { expect } from 'chai'
import { noop } from './util'
import { createServer } from './server'

describe('server', () => {

  let proxyPort: number
  let proxyServer: HttpServer
  let localPort: number
  let localServer: HttpServer
  let localSocket: TcpSocket
  let localWebSocketServer: WebSocketServer

  beforeEach('start servers', done => {
    proxyServer = createServer().listen(0, 'localhost', () => {
      ({ port: proxyPort } = proxyServer.address() as AddressInfo)
      localServer = new HttpServer((_, res) => res.end())
      localWebSocketServer = new WebSocketServer({ server: localServer })
      localWebSocketServer.on('connection', ws => ws.send('success!'))
      localServer.listen(0, 'localhost', () => {
        ({ port: localPort } = localServer.address() as AddressInfo)
        localSocket = connect({ port: localPort })
        localSocket.once('connect', done)
      })
    })
  })

  afterEach('stop servers', done => {
    localSocket.destroy()
    localServer.close(() => proxyServer.close(done))
  })

  describe('on request', () => {

    describe('for all requests', () => {

      it('requires a host header', done => {
        const socket = connect({ port: proxyPort })
        socket.once('error', done)
        socket.once('data', data => {
          expect(data.toString()).to.match(/^HTTP\/1\.1 400 Bad Request/)
          done()
        })
        socket.end('GET / HTTP/1.1\r\n\r\n')
      })

    })

    describe('for remote requests', () => {

      context('when no agent is serving the hostname', () => {

        it('responds with a 404 error', done => {
          const reqOptions = {
            port: proxyPort,
            headers: {
              host: 'unknown.localhost'
            }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 404)
            done()
          })
          req.end()
        })

      })

      context('when no tunnels are available for the hostname', () => {

        beforeEach('create a tunnel agent', done => {
          const reqOptions = {
            port: proxyPort,
            headers: {
              'x-tunnel-host': 'new.localhost'
            }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 201)
            done()
          })
          req.end()
        })

        it('enqueues the request', done => {
          const remoteReqOptions = {
            port: proxyPort,
            headers: {
              host: 'new.localhost'
            }
          }
          const remoteReq = request(remoteReqOptions, res => {
            expect(res).to.have.property('statusCode', 200)
            done()
          })
          remoteReq.once('socket', () => {
            const tunnelReqOptions = {
              port: proxyPort,
              headers: {
                connection: 'upgrade',
                upgrade: '@http-public/tunnel',
                'x-tunnel-host': 'new.localhost'
              }
            }
            const tunnelReq = request(tunnelReqOptions)
            tunnelReq.once('upgrade', (_, tunnel) => {
              tunnel.write('\x00')
              pipeline([tunnel, localSocket, tunnel], noop)
            })
            tunnelReq.end()
          })
          remoteReq.end()
        })

      })

      context('when a tunnel connection is available for the hostname', () => {

        beforeEach('create a tunnel agent and tunnel', done => {
          const clientReqOptions = {
            port: proxyPort,
            headers: {
              'x-tunnel-host': 'new.localhost'
            }
          }
          const clientReq = request(clientReqOptions, res => {
            expect(res).to.have.property('statusCode', 201)
            const tunnelReqOptions = {
              port: proxyPort,
              headers: {
                connection: 'upgrade',
                upgrade: '@http-public/tunnel',
                'x-tunnel-host': 'new.localhost'
              }
            }
            const tunnelReq = request(tunnelReqOptions)
            tunnelReq.once('upgrade', (_, tunnel) => {
              tunnel.write('\x00')
              pipeline([tunnel, localSocket, tunnel], noop)
              done()
            })
            tunnelReq.end()
          })
          clientReq.end()
        })

        it('forwards the remote request to the local server', done => {
          const reqOptions = {
            port: proxyPort,
            headers: {
              host: 'new.localhost'
            }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 200)
            done()
          })
          req.end()
        })

      })

      context('when a tunnel connection breaks', () => {

        context('and headers have not been transferred', () => {

          it('responds with a 502 error')

        })

        context('and headers have been transferred', () => {

          it('terminates the request')

        })

      })

    })

    describe('for client requests', () => {

      context('when the x-tunnel-host header is not set', () => {

        it('responds with a 400 error', done => {
          const reqOptions = {
            port: proxyPort
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 400)
            done()
          })
          req.end()
        })

      })

      context('when the x-tunnel-host header is not valid', () => {

        it('responds with a 400 error', done => {
          const reqOptions = {
            port: proxyPort,
            headers: {
              'x-tunnel-host': '@'
            }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 400)
            done()
          })
          req.end()
        })

      })

      context('when the tunnel hostname is available', () => {

        it('responds with a 201 success', done => {
          const reqOptions = {
            port: proxyPort,
            headers: {
              'x-tunnel-host': 'new.localhost'
            }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 201)
            done()
          })
          req.end()
        })

      })

      context('when the tunnel hostname is occupied', () => {

        beforeEach('create a tunnel agent', done => {
          const reqOptions = {
            port: proxyPort,
            headers: { 'x-tunnel-host': 'new.localhost' }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 201)
            done()
          })
          req.end()
        })

        it('responds with a 409 error', done => {
          const reqOptions = {
            port: proxyPort,
            headers: { 'x-tunnel-host': 'new.localhost' }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 409)
            done()
          })
          req.end()
        })

      })

    })

  })

  describe('on upgrade', () => {

    describe('for all upgrades', () => {

      it('requires a host header', done => {
        const socket = connect({ port: proxyPort })
        socket.once('end', done)
        socket.once('error', done)
        socket.write(
          'GET / HTTP/1.1\r\n' +
          'Connection: Upgrade\r\n' +
          'Upgrade: anything\r\n\r\n'
        )
      })

    })

    describe('for client upgrades', () => {

      context('when the uprade header is not @http-public/tunnel', () => {

        it('hangs up the socket connection', done => {
          const reqOptions = {
            port: proxyPort,
            headers: {
              connection: 'upgrade',
              upgrade: 'unsupported'
            }
          }
          const req = request(reqOptions).once('error', err => {
            expect(err).to.be.an('error', 'socket hang up')
            done()
          })
          req.end()
        })

      })

      context('when the x-tunnel-host header is not set', () => {

        it('hangs up the socket connection', done => {
          const reqOptions = {
            port: proxyPort,
            headers: {
              connection: 'upgrade',
              upgrade: '@http-public/tunnel'
            }
          }
          const req = request(reqOptions).once('error', err => {
            expect(err).to.be.an('error', 'socket hang up')
            done()
          })
          req.end()
        })

      })

      context('when no agent is serving the hostname', () => {

        it('hangs up the socket connection', done => {
          const reqOptions = {
            port: proxyPort,
            headers: {
              connection: 'upgrade',
              upgrade: '@http-public/tunnel',
              'x-tunnel-host': 'unknown.localhost'
            }
          }
          const req = request(reqOptions).once('error', err => {
            expect(err).to.be.an('error', 'socket hang up')
            done()
          })
          req.end()
        })

      })

      context('when an agent is serving the hostname', () => {

        beforeEach('create a tunnel agent', done => {
          const reqOptions = {
            port: proxyPort,
            headers: {
              'x-tunnel-host': 'new.localhost'
            }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 201)
            done()
          })
          req.end()
        })

        it('upgrades the socket connection', done => {
          const reqOptions = {
            port: proxyPort,
            headers: {
              connection: 'upgrade',
              upgrade: '@http-public/tunnel',
              'x-tunnel-host': 'new.localhost'
            }
          }
          const req = request(reqOptions).once('upgrade', (_, tunnel) => {
            tunnel.end('\x00', done)
          })
          req.end()
        })

      })

    })

    describe('for remote upgrades', () => {

      context('when no agent is serving the hostname', () => {

        it('responds with a 404 error', done => {
          const reqOptions = {
            port: proxyPort,
            headers: {
              host: 'unknown.localhost',
              connection: 'upgrade',
              upgrade: 'anything'
            }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 404)
            res.destroy()
            done()
          })
          req.end()
        })

      })

      context('when no tunnels are available for the hostname', () => {

        beforeEach('create a tunnel agent', done => {
          const reqOptions = {
            port: proxyPort,
            headers: {
              'x-tunnel-host': 'new.localhost'
            }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 201)
            done()
          })
          req.end()
        })

        it('enqueues the upgrade', done => {
          const webSocket = new WebSocket(`ws://localhost:${proxyPort}`, {
            headers: {
              host: 'new.localhost'
            }
          })
          webSocket.once('message', data => {
            expect(data.toString()).to.equal('success!')
            done()
          })
          webSocket.once('error', done)
          const tunnelReqOptions = {
            port: proxyPort,
            headers: {
              connection: 'upgrade',
              upgrade: '@http-public/tunnel',
              'x-tunnel-host': 'new.localhost'
            }
          }
          const tunnelReq = request(tunnelReqOptions)
          tunnelReq.once('upgrade', (_, tunnel) => {
            tunnel.write('\x00')
            pipeline([tunnel, localSocket, tunnel], noop)
          })
          tunnelReq.end()
        })

      })

      context('when a tunnel connection is available for the hostname', () => {

        beforeEach('create a tunnel agent and tunnel', done => {
          const clientReqOptions = {
            port: proxyPort,
            headers: {
              'x-tunnel-host': 'new.localhost'
            }
          }
          const clientReq = request(clientReqOptions, res => {
            expect(res).to.have.property('statusCode', 201)
            const tunnelReqOptions = {
              port: proxyPort,
              headers: {
                connection: 'upgrade',
                upgrade: '@http-public/tunnel',
                'x-tunnel-host': 'new.localhost'
              }
            }
            const tunnelReq = request(tunnelReqOptions)
            tunnelReq.once('upgrade', (_, tunnel) => {
              tunnel.write('\x00')
              pipeline([tunnel, localSocket, tunnel], noop)
              done()
            })
            tunnelReq.end()
          })
          clientReq.end()
        })

        it('proxies the upgraded connection', done => {
          const webSocket = new WebSocket(`ws://localhost:${proxyPort}`, {
            headers: {
              host: 'new.localhost'
            }
          })
          webSocket.on('message', data => {
            expect(String(data)).to.equal('success!')
            done()
          })
        })

      })

      context('when the remote connection breaks', () => {

        it('destroys the tunnel')

      })

    })

  })

})
