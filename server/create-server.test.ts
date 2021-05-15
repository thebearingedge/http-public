import { AddressInfo, connect } from 'net'
import { request, Server as HttpServer } from 'http'
import WebSocket from 'ws'
import { expect } from 'chai'
import { createServer } from './create-server'

describe('createServer', () => {

  let proxy: HttpServer
  let proxyPort: number
  let proxyHost: string
  let localServer: HttpServer

  beforeEach('start server', done => {
    const serverOptions = {
      hostname: 'localhost'
    }
    proxy = createServer(serverOptions).listen(0, '127.0.0.1', () => {
      const { port } = proxy.address() as AddressInfo
      proxyPort = port
      proxyHost = `http://localhost:${port}`
      localServer = new HttpServer().listen(0, '127.0.0.1', done)
    })
  })

  afterEach('stop server', done => {
    proxy.close(() => localServer.close(done))
  })

  describe('upgrade requests', () => {

    describe('all upgrades', () => {

      it('requires a valid host header', done => {
        const socket = connect({
          host: 'localhost',
          port: proxyPort
        })
        socket.write(
          'GET / HTTP/1.1\r\n' +
          'Connection: upgrade\r\n' +
          'Upgrade: unsupported\r\n\r\n'
        )
        socket.once('error', done)
        socket.once('close', () => done())
      })

    })

    describe('control upgrades', () => {

      it('require an x-remote-hostname header', done => {
        const reqOptions = {
          port: proxyPort,
          headers: {
            connection: 'upgrade',
            upgrade: 'websocket'
          }
        }
        const req = request(reqOptions).once('error', err => {
          expect(err).to.have.property('message', 'socket hang up')
          done()
        })
        req.end()
      })

      it('requires a valid x-remote-hostname header', done => {
        const reqOptions = {
          port: proxyPort,
          headers: {
            connection: 'upgrade',
            upgrade: 'websocket',
            'x-remote-hostname': ''
          }
        }
        const req = request(reqOptions).once('error', err => {
          expect(err).to.have.property('message', 'socket hang up')
          done()
        })
        req.end()
      })

      it('accepts a control connection over websockets', done => {
        const client = new WebSocket(proxyHost, {
          headers: { 'x-remote-hostname': 'test.localhost' }
        })
        client.once('open', () => {
          client.terminate()
          done()
        })
      })

    })

    describe('tunnel upgrades', () => {

      it('require x-tunnel-id and x-tunnel-hostname headers', done => {
        const reqOptions = {
          port: proxyPort,
          headers: {
            connection: 'upgrade',
            upgrade: '@http-public/tunnel'
          }
        }
        const req = request(reqOptions).once('error', err => {
          expect(err).to.have.property('message', 'socket hang up')
          done()
        })
        req.end()
      })

      it('ignores requests to invalid hostnames', done => {
        const reqOptions = {
          port: proxyPort,
          headers: {
            host: 'localhost',
            connection: 'upgrade',
            upgrade: '@http-public/tunnel',
            'x-tunnel-hostname': ''
          }
        }
        const req = request(reqOptions).once('error', err => {
          expect(err).to.have.property('message', 'socket hang up')
          done()
        })
        req.end()
      })

      it('ignores requests to unknown hostnames', done => {
        const reqOptions = {
          port: proxyPort,
          headers: {
            host: 'localhost',
            connection: 'upgrade',
            upgrade: '@http-public/tunnel',
            'x-tunnel-hostname': 'unknown.localhost'
          }
        }
        const req = request(reqOptions).once('error', err => {
          expect(err).to.have.property('message', 'socket hang up')
          done()
        })
        req.end()
      })

    })

  })

  describe('http requests', () => {

    it('requires a valid host header', done => {
      const socket = connect({
        host: 'localhost',
        port: proxyPort
      })
      socket.write('GET / HTTP/1.1\r\n\r\n')
      socket.once('error', done)
      socket.once('data', data => {
        const message = data.toString()
        expect(message).to.match(/^HTTP\/1\.1 400 Bad Request/)
        socket.end()
        done()
      })
    })

    it('ignores requests to unknown hostnames', done => {
      const reqOptions = {
        port: proxyPort,
        headers: { host: 'unknown.localhost' }
      }
      const req = request(reqOptions, res => {
        expect(res).to.have.property('statusCode', 404)
        done()
      })
      req.end()
    })

  })

  it('requests new connections from the local client', done => {
    const client = new WebSocket(proxyHost, {
      headers: { 'x-remote-hostname': 'test.localhost' }
    })
    client.once('message', (data: string) => {
      const message = JSON.parse(data)
      const { tunnelId, remoteHostname } = message.payload
      const tunnelReq = request({
        port: proxyPort,
        headers: {
          host: 'localhost',
          connection: 'upgrade',
          upgrade: '@http-public/tunnel',
          'x-tunnel-id': tunnelId,
          'x-tunnel-hostname': remoteHostname
        }
      })
      tunnelReq.once('upgrade', (_, socket) => {
        client.send(JSON.stringify({
          event: 'tunnel_connection_established',
          payload: { tunnelId }
        }))
        socket.once('data', () => {
          socket.end("HTTP/1.1 418 I'm a teapot\r\n\r\n")
        })
      })
      tunnelReq.end()
    })
    client.once('open', () => {
      const remoteReq = request({
        port: proxyPort,
        headers: { host: 'test.localhost' }
      }, res => {
        expect(res).to.have.property('statusCode', 418)
        client.terminate()
        done()
      })
      remoteReq.end()
    })
  })

})
