import { pipeline } from 'stream'
import { request, Server as HttpServer } from 'http'
import { connect, AddressInfo, Socket as TcpSocket } from 'net'
import { expect } from 'chai'
import { noop } from './util'
import { createServer } from './create-server'

const LOCALHOST = '127.0.0.1'

describe('createServer', () => {

  let proxy: HttpServer
  let proxyPort: number
  let local: HttpServer
  let localPort: number

  beforeEach('start servers', done => {
    const serverOptions = {
      hostname: 'localhost'
    }
    proxy = createServer(serverOptions).listen(0, LOCALHOST, () => {
      ({ port: proxyPort } = proxy.address() as AddressInfo)
      local = new HttpServer((_, res) => {
        res.writeHead(418).end()
        res.end()
      }).listen(0, LOCALHOST, () => {
        ({ port: localPort } = local.address() as AddressInfo)
        done()
      })
    })
  })

  afterEach('stop servers', done => {
    proxy.close(() => local.close(done))
  })

  describe('on upgrade', () => {

    describe('all upgrades', () => {

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

    describe('client upgrades', () => {

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

      context('when the x-tunnel-hostname header is not set', () => {

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

      context('when no tunnel has been created for the hostname', () => {

        it('hangs up the socket connection', done => {
          const reqOptions = {
            port: proxyPort,
            headers: {
              connection: 'upgrade',
              upgrade: '@http-public/tunnel',
              'x-tunnel-hostname': 'unknown.localhost'
            }
          }
          const req = request(reqOptions).once('error', err => {
            expect(err).to.be.an('error', 'socket hang up')
            done()
          })
          req.end()
        })

      })

      context('when a tunnel has been created for the hostname', () => {

        beforeEach(done => {
          const reqOptions = {
            port: proxyPort,
            headers: {
              'x-tunnel-hostname': 'new.localhost'
            }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 201)
            done()
          })
          req.once('error', done)
          req.end()
        })

        it('persists the socket connection', done => {
          const reqOptions = {
            port: proxyPort,
            headers: {
              connection: 'upgrade',
              upgrade: '@http-public/tunnel',
              'x-tunnel-hostname': 'new.localhost'
            }
          }
          const req = request(reqOptions).once('upgrade', (res, socket) => {
            expect(res).to.have.property('statusCode', 101)
            socket.destroy()
            done()
          })
          req.once('error', done)
          req.end()
        })

      })

    })

    describe('remote upgrades', () => {

      context('when no tunnel has been created for the hostname', () => {

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
            expect(res.headers).to.deep.equal({
              connection: 'close'
            })
            done()
          }).once('error', done)
          req.end()
        })

      })
    })

  })

  describe('on request', () => {

    describe('all requests', () => {

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

    describe('remote requests', () => {

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
          req.once('error', done)
          req.end()
        })

      })

      context('when no tunnels are available for the hostname', () => {

        let localSocket: TcpSocket

        beforeEach(done => {
          const reqOptions = {
            port: proxyPort,
            headers: {
              'x-tunnel-hostname': 'new.localhost'
            }
          }
          const req = request(reqOptions)
          req.once('error', done)
          req.end(() => {
            localSocket = connect({ port: localPort })
            localSocket.once('error', done)
            localSocket.once('ready', done)
          })
        })

        afterEach(() => localSocket.destroy())

        it('queues the request', done => {
          const remoteReqOptions = {
            port: proxyPort,
            headers: {
              host: 'new.localhost'
            }
          }
          const remoteReq = request(remoteReqOptions, res => {
            expect(res).to.have.property('statusCode', 418)
            done()
          })
          remoteReq.once('error', done)
          remoteReq.end(() => {
            const tunnelReqOptions = {
              port: proxyPort,
              headers: {
                connection: 'upgrade',
                upgrade: '@http-public/tunnel',
                'x-tunnel-hostname': 'new.localhost'
              }
            }
            const tunnelReq = request(tunnelReqOptions)
            tunnelReq.once('upgrade', (_, tunnelSocket) => {
              pipeline(tunnelSocket, localSocket, tunnelSocket, noop)
            })
            tunnelReq.once('error', done)
            tunnelReq.end()
          })
        })

      })

      context('when a tunnel connection is available for the hostname', () => {

        let localSocket: TcpSocket

        beforeEach(done => {
          const agentReqOptions = {
            port: proxyPort,
            headers: {
              'x-tunnel-hostname': 'new.localhost'
            }
          }
          const agentReq = request(agentReqOptions)
          agentReq.once('error', done)
          agentReq.end(() => {
            localSocket = connect({ port: localPort })
            localSocket.once('error', done)
            localSocket.once('ready', () => {
              const reqOptions = {
                port: proxyPort,
                headers: {
                  connection: 'upgrade',
                  upgrade: '@http-public/tunnel',
                  'x-tunnel-hostname': 'new.localhost'
                }
              }
              const tunnelReq = request(reqOptions)
              tunnelReq.once('upgrade', (_, tunnelSocket) => {
                pipeline(tunnelSocket, localSocket, tunnelSocket, noop)
                done()
              })
              tunnelReq.once('error', done)
              tunnelReq.end()
            })
          })
        })

        afterEach(() => localSocket.destroy())

        it('forwards the remote request to the local server', done => {
          const reqOptions = {
            port: proxyPort,
            headers: {
              host: 'new.localhost'
            }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 418)
            done()
          })
          req.once('error', done)
          req.end()
        })

      })

    })

    describe('client requests', () => {

      context('when the x-tunnel-hostname header is not set', () => {
        it('responds with a 400 error', done => {
          const reqOptions = {
            port: proxyPort
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 400)
            done()
          })
          req.once('error', done)
          req.end()
        })
      })

      context('when the tunnel hostname is not occupied', () => {

        it('responds with a 201 success', done => {
          const reqOptions = {
            port: proxyPort,
            headers: {
              'x-tunnel-hostname': 'new.localhost'
            }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 201)
            done()
          })
          req.once('error', done)
          req.end()
        })

      })

      context('when the tunnel hostname is already occupied', () => {

        beforeEach(done => {
          const reqOptions = {
            port: proxyPort,
            headers: { 'x-tunnel-hostname': 'new.localhost' }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 201)
            done()
          })
          req.once('error', done)
          req.end()
        })

        it('responds with a 409 error', done => {
          const reqOptions = {
            port: proxyPort,
            headers: { 'x-tunnel-hostname': 'new.localhost' }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 409)
            done()
          })
          req.once('error', done)
          req.end()
        })

      })

    })

  })

})
