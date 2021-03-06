import { pipeline } from 'stream'
import { randomBytes } from 'crypto'
import { connect, AddressInfo, Socket } from 'net'
import { request, Server as HttpServer } from 'http'
import WebSocket from 'ws'
import { expect } from 'chai'
import { useFakeTimers, SinonFakeTimers } from 'sinon'
import { CLIENT_ACK, IDLE_TIMEOUT } from './constants'
import { createLocalServer } from './util.test'
import { createServer } from './server'
import { noop } from './util'

describe('server', () => {

  const host = 'localhost'
  const token = randomBytes(8).toString('base64')

  let proxyPort: number
  let proxyServer: HttpServer
  let localPort: number
  let localServer: HttpServer
  let local: Socket

  beforeEach('start servers', done => {
    proxyServer = createServer({ host, token }).listen(0, host, () => {
      ({ port: proxyPort } = proxyServer.address() as AddressInfo)
      localServer = createLocalServer().listen(0, host, () => {
        ({ port: localPort } = localServer.address() as AddressInfo)
        local = connect(localPort).once('connect', done)
      })
    })
  })

  afterEach('stop servers', done => {
    localServer.close(() => proxyServer.close(done))
  })

  describe('on request', () => {

    describe('for all requests', () => {

      it('requires a host header', done => {
        const reqOptions = {
          port: proxyPort
        }
        const req = request(reqOptions, res => {
          expect(res).to.have.property('statusCode', 400)
          res.resume()
          res.once('end', done)
        })
        req.removeHeader('host')
        req.end()
      })

    })

    describe('for client requests', () => {

      context('when the x-tunnel-token header is not set', () => {

        it('responds with a 403 error', done => {
          const reqOptions = {
            port: proxyPort
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 403)
            res.resume()
            res.once('end', done)
          })
          req.end()
        })

      })

      context('when the x-tunnel-token header is not correct', () => {

        it('responds with a 403 error', done => {
          const reqOptions = {
            port: proxyPort,
            headers: {
              'x-tunnel-token': 'not the token'
            }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 403)
            res.resume()
            res.once('end', done)
          })
          req.end()
        })

      })

      context('when the x-tunnel-host header is not set', () => {

        it('responds with a 400 error', done => {
          const reqOptions = {
            port: proxyPort,
            headers: {
              'x-tunnel-token': token
            }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 400)
            res.resume()
            res.once('end', done)
          })
          req.end()
        })

      })

      context('when the x-tunnel-host header is not valid', () => {

        it('responds with a 400 error', done => {
          const reqOptions = {
            port: proxyPort,
            headers: {
              'x-tunnel-host': '@',
              'x-tunnel-token': token
            }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 400)
            res.resume()
            res.once('end', done)
          })
          req.end()
        })

      })

      context('when the tunnel hostname is available', () => {

        it('responds with a 201 success', done => {
          const reqOptions = {
            port: proxyPort,
            headers: {
              'x-tunnel-host': 'new.localhost',
              'x-tunnel-token': token
            }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 201)
            res.resume()
            res.once('end', done)
          })
          req.end()
        })

      })

      context('when the tunnel hostname is occupied', () => {

        let clock: SinonFakeTimers

        beforeEach('create a tunnel agent', done => {
          clock = useFakeTimers({ toFake: ['setTimeout'] })
          const reqOptions = {
            port: proxyPort,
            headers: {
              'x-tunnel-host': 'new.localhost',
              'x-tunnel-token': token
            }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 201)
            res.resume()
            res.once('end', done)
          })
          req.end()
        })

        afterEach(() => clock.restore())

        it('responds with a 409 error', done => {
          const reqOptions = {
            port: proxyPort,
            headers: {
              'x-tunnel-host': 'new.localhost',
              'x-tunnel-token': token
            }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 409)
            res.resume()
            res.once('end', done)
          })
          req.end()
        })

        it(`expires the tunnel agent after ${IDLE_TIMEOUT}ms`, done => {
          clock.tick(IDLE_TIMEOUT)
          const reqOptions = {
            port: proxyPort,
            headers: {
              'x-tunnel-host': 'new.localhost',
              'x-tunnel-token': token
            }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 201)
            res.resume()
            res.once('end', done)
          })
          req.end()
        })

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
            res.resume()
            res.once('end', done)
          })
          req.end()
        })

      })

      context('when no tunnels are available for the hostname', () => {

        let tunnelKey: string

        beforeEach('create a tunnel agent', done => {
          const reqOptions = {
            port: proxyPort,
            headers: {
              'x-tunnel-host': 'new.localhost',
              'x-tunnel-token': token
            }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 201)
            tunnelKey = res.headers['x-tunnel-key'] as string
            res.resume()
            res.once('end', done)
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
            res.resume()
            res.once('end', done)
          })
          remoteReq.end(() => {
            const tunnelReqOptions = {
              port: proxyPort,
              headers: {
                connection: 'upgrade',
                upgrade: '@http-public/tunnel',
                'x-tunnel-host': 'new.localhost',
                'x-tunnel-key': tunnelKey
              }
            }
            const tunnelReq = request(tunnelReqOptions)
            tunnelReq.once('upgrade', (_, proxy) => {
              const tunnel = pipeline(proxy, local, proxy, noop)
              tunnel.write(CLIENT_ACK)
            })
            tunnelReq.end()
          })
          remoteReq.end()
        })

      })

      context('when a tunnel connection is available for the hostname', () => {

        let tunnelKey: string

        beforeEach('create a tunnel agent and tunnel', done => {
          const clientReqOptions = {
            port: proxyPort,
            headers: {
              'x-tunnel-host': 'new.localhost',
              'x-tunnel-token': token
            }
          }
          const clientReq = request(clientReqOptions, res => {
            expect(res).to.have.property('statusCode', 201)
            tunnelKey = res.headers['x-tunnel-key'] as string
            res.resume()
            res.once('end', () => {
              const tunnelReqOptions = {
                port: proxyPort,
                headers: {
                  connection: 'upgrade',
                  upgrade: '@http-public/tunnel',
                  'x-tunnel-host': 'new.localhost',
                  'x-tunnel-key': tunnelKey
                }
              }
              const tunnelReq = request(tunnelReqOptions)
              tunnelReq.once('upgrade', (_, proxy) => {
                const tunnel = pipeline(proxy, local, proxy, noop)
                tunnel.write(CLIENT_ACK, done)
              })
              tunnelReq.end()
            })
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
            res.resume()
            res.once('end', done)
          })
          req.end()
        })

        it('responds with a 502 error on broken connections', done => {
          const reqOptions = {
            path: '/broken',
            port: proxyPort,
            headers: {
              host: 'new.localhost'
            }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 502)
            res.resume()
            res.once('end', done)
          })
          req.end()
        })

        it('closes the response after headers are transferred', done => {
          const reqOptions = {
            path: '/streaming',
            port: proxyPort,
            headers: {
              host: 'new.localhost'
            }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 200)
            res.once('data', () => local.destroy())
            res.once('close', done)
          })
          req.end()
        })

      })

    })

  })

  describe('on upgrade', () => {

    describe('for all upgrades', () => {

      it('requires a host header', done => {
        const reqOptions = {
          port: proxyPort,
          headers: {
            connection: 'upgrade',
            upgrade: 'anything'
          }
        }
        const req = request(reqOptions, res => {
          expect(res).to.have.property('statusCode', 400)
          res.resume()
          res.once('end', done)
        })
        req.removeHeader('host')
        req.end()
      })

    })

    describe('for client upgrades', () => {

      context('when the x-tunnel-host is not set', () => {

        it('responds with a 400 error', done => {
          const reqOptions = {
            port: proxyPort,
            headers: {
              connection: 'upgrade',
              upgrade: '@http-public/tunnel'
            }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 400)
            res.resume()
            res.once('end', done)
          })
          req.end()
        })

      })

      context('when the upgrade header is not @http-public/tunnel', () => {

        it('responds with a 400 error', done => {
          const reqOptions = {
            port: proxyPort,
            headers: {
              connection: 'upgrade',
              upgrade: 'unsupported',
              'x-tunnel-host': 'test.localhost'
            }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 400)
            res.resume()
            res.once('end', done)
          })
          req.end()
        })

      })

      context('when no agent is serving the hostname', () => {

        it('responds with a 404 error', done => {
          const reqOptions = {
            port: proxyPort,
            headers: {
              connection: 'upgrade',
              upgrade: '@http-public/tunnel',
              'x-tunnel-host': 'fake.localhost'
            }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 404)
            res.resume()
            res.once('end', done)
          })
          req.end()
        })

      })

      context('when a tunnel agent is serving the hostname', () => {

        let tunnelKey: string

        beforeEach('create a tunnel agent', done => {
          const reqOptions = {
            port: proxyPort,
            headers: {
              'x-tunnel-host': 'new.localhost',
              'x-tunnel-token': token
            }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 201)
            tunnelKey = res.headers['x-tunnel-key'] as string
            res.resume()
            res.once('end', done)
          })
          req.end()
        })

        context('but the tunnel key is incorrect', () => {

          it('responds with a 404 error', done => {
            const reqOptions = {
              port: proxyPort,
              headers: {
                connection: 'upgrade',
                upgrade: '@http-public/tunnel',
                'x-tunnel-host': 'new.localhost',
                'x-tunnel-key': 'not the key'
              }
            }
            const req = request(reqOptions, res => {
              expect(res).to.have.property('statusCode', 404)
              res.resume()
              res.once('end', done)
            })
            req.end()
          })

        })

        context('and the tunnel key is correct', () => {

          it('upgrades the connection', done => {
            const reqOptions = {
              port: proxyPort,
              headers: {
                connection: 'upgrade',
                upgrade: '@http-public/tunnel',
                'x-tunnel-host': 'new.localhost',
                'x-tunnel-key': tunnelKey
              }
            }
            const req = request(reqOptions).once('upgrade', (_, tunnel) => {
              tunnel.end(CLIENT_ACK, done)
            })
            req.end()
          })

          it('requires a valid CLIENT_ACK', done => {
            const reqOptions = {
              port: proxyPort,
              headers: {
                connection: 'upgrade',
                upgrade: '@http-public/tunnel',
                'x-tunnel-host': 'new.localhost',
                'x-tunnel-key': tunnelKey
              }
            }
            const req = request(reqOptions).once('upgrade', (_, tunnel) => {
              tunnel.once('close', () => done())
              tunnel.write('\x11')
            })
            req.end()
          })

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
            res.resume()
            res.once('end', done)
          })
          req.end()
        })

      })

      context('when no tunnels are available for the hostname', () => {

        let tunnelKey: string
        let clock: SinonFakeTimers

        beforeEach('create a tunnel agent', done => {
          clock = useFakeTimers({ toFake: ['setTimeout'] })
          const reqOptions = {
            port: proxyPort,
            headers: {
              'x-tunnel-host': 'new.localhost',
              'x-tunnel-token': token
            }
          }
          const req = request(reqOptions, res => {
            expect(res).to.have.property('statusCode', 201)
            tunnelKey = res.headers['x-tunnel-key'] as string
            res.resume()
            res.once('end', done)
          })
          req.end()
        })

        afterEach(() => clock.restore())

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
          const tunnelReqOptions = {
            port: proxyPort,
            headers: {
              connection: 'upgrade',
              upgrade: '@http-public/tunnel',
              'x-tunnel-host': 'new.localhost',
              'x-tunnel-key': tunnelKey
            }
          }
          const tunnelReq = request(tunnelReqOptions)
          tunnelReq.once('upgrade', (_, proxy) => {
            const tunnel = pipeline(proxy, local, proxy, noop)
            tunnel.write(CLIENT_ACK)
          })
          tunnelReq.end()
        })

        it('responds with a 404 for timed out agents', done => {
          const upgradeReqOptions = {
            port: proxyPort,
            headers: {
              host: 'new.localhost',
              connection: 'upgrade',
              upgrade: 'doo ett!'
            }
          }
          const upgradeReq = request(upgradeReqOptions, res => {
            expect(res).to.have.property('statusCode', 404)
            res.resume()
            res.once('end', done)
          })
          upgradeReq.end(() => {
            const tunnelReqOptions = {
              port: proxyPort,
              headers: {
                connection: 'upgrade',
                upgrade: '@http-public/tunnel',
                'x-tunnel-host': 'new.localhost',
                'x-tunnel-key': tunnelKey
              }
            }
            const tunnelReq = request(tunnelReqOptions)
            tunnelReq.once('upgrade', () => {
              clock.tick(IDLE_TIMEOUT)
            })
            tunnelReq.end()
          })
        })

        it('handles aborted upgrades', done => {
          const upgradeReqOptions = {
            port: proxyPort,
            headers: {
              host: 'new.localhost',
              connection: 'upgrade',
              upgrade: 'doo ett!'
            }
          }
          const upgradeReq = request(upgradeReqOptions)
          upgradeReq.once('error', noop)
          upgradeReq.once('socket', () => {
            upgradeReq.end(() => {
              upgradeReq.destroy()
              const tunnelReqOptions = {
                port: proxyPort,
                headers: {
                  connection: 'upgrade',
                  upgrade: '@http-public/tunnel',
                  'x-tunnel-host': 'new.localhost',
                  'x-tunnel-key': tunnelKey
                }
              }
              const tunnelReq = request(tunnelReqOptions)
              tunnelReq.once('upgrade', (_, tunnel) => {
                tunnel.once('end', done)
                tunnel.write(CLIENT_ACK)
              })
              tunnelReq.end()
            })
          })
        })

      })

      context('when a tunnel connection is available for the hostname', () => {

        let tunnel: Socket
        let tunnelKey: string

        beforeEach('create a tunnel agent and tunnel', done => {
          const clientReqOptions = {
            port: proxyPort,
            headers: {
              'x-tunnel-host': 'new.localhost',
              'x-tunnel-token': token
            }
          }
          const clientReq = request(clientReqOptions, res => {
            expect(res).to.have.property('statusCode', 201)
            tunnelKey = res.headers['x-tunnel-key'] as string
            res.resume()
            res.once('end', () => {
              const tunnelReqOptions = {
                port: proxyPort,
                headers: {
                  connection: 'upgrade',
                  upgrade: '@http-public/tunnel',
                  'x-tunnel-host': 'new.localhost',
                  'x-tunnel-key': tunnelKey
                }
              }
              const tunnelReq = request(tunnelReqOptions)
              tunnelReq.once('upgrade', (_, proxy) => {
                tunnel = pipeline(proxy, local, proxy, noop)
                tunnel.write(CLIENT_ACK, done)
              })
              tunnelReq.end()
            })
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

        it('closes broken tunnel connections', done => {
          tunnel.once('end', done)
          const webSocket = new WebSocket(`ws://localhost:${proxyPort}`, {
            headers: {
              host: 'new.localhost'
            }
          })
          webSocket.on('message', data => {
            expect(String(data)).to.equal('success!')
            webSocket.terminate()
          })
        })

      })

    })

  })

})
