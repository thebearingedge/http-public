import { AddressInfo } from 'net'
import { request, Server as HttpServer } from 'http'
import WebSocket from 'ws'
import chai, { expect } from 'chai'
import { chaiStruct } from 'chai-struct'
import { createServer } from './create-server'

chai.use(chaiStruct)

describe('createServer', () => {

  let proxyServer: HttpServer
  let proxyServerPort: number
  let proxyServerHost: string
  let localServer: HttpServer

  beforeEach('start server', done => {
    const serverOptions = {
      hostname: 'localhost'
    }
    proxyServer = createServer(serverOptions).listen(0, '127.0.0.1', () => {
      const { port } = proxyServer.address() as AddressInfo
      proxyServerPort = port
      proxyServerHost = `http://localhost:${port}`
      localServer = new HttpServer().listen(0, '127.0.0.1', done)
    })
  })

  afterEach('stop server', done => {
    proxyServer.close(() => localServer.close(done))
  })

  it('requires a valid host header', done => {
    const reqOptions = {
      port: proxyServerPort,
      headers: {
        connection: 'upgrade',
        upgrade: 'websocket'
      }
    }
    const req = request(reqOptions)
    req.once('error', err => {
      expect(err).to.have.property('message', 'socket hang up')
      done()
    })
    req.end()
  })

  it('requires a valid x-remote-hostname header', done => {
    const reqOptions = {
      port: proxyServerPort,
      headers: {
        connection: 'upgrade',
        upgrade: 'websocket'
      }
    }
    const req = request(reqOptions)
    req.once('error', err => {
      expect(err).to.have.property('message', 'socket hang up')
      done()
    })
    req.end()
  })

  it('accepts a control connection over websockets', done => {
    const controller = new WebSocket(proxyServerHost, {
      headers: { 'x-remote-hostname': 'test.localhost' }
    })
    controller.once('open', () => {
      controller.terminate()
      done()
    })
  })

  it('ignores requests to unknown hostnames', done => {
    const reqOptions = {
      port: proxyServerPort,
      headers: { host: 'unknown.localhost' }
    }
    const req = request(reqOptions, res => {
      expect(res).to.have.property('statusCode', 404)
      done()
    })
    req.end()
  })

  it('requests new connections from the local client', done => {
    const controller = new WebSocket(proxyServerHost, {
      headers: { 'x-remote-hostname': 'test.localhost' }
    })
    controller.once('message', (data: string) => {
      const message = JSON.parse(data)
      expect(message).to.have.structure({
        event: 'client_connection_requested',
        payload: {
          tunnelId: String,
          remoteHostname: 'test.localhost'
        }
      })
      const { tunnelId, remoteHostname } = message.payload
      const tunnelReq = request({
        port: proxyServerPort,
        headers: {
          host: 'localhost',
          connection: 'upgrade',
          upgrade: 'tunnel',
          'x-tunnel-id': tunnelId,
          'x-tunnel-host': remoteHostname
        }
      })
      tunnelReq.once('upgrade', (_, socket) => {
        controller.send(JSON.stringify({
          event: 'client_connection_established',
          payload: { tunnelId }
        }))
        socket.once('data', () => {
          socket.end("HTTP/1.1 418 I'm a teapot\r\n\r\n")
        })
      })
      tunnelReq.end()
    })
    controller.once('open', () => {
      const remoteReq = request({
        port: proxyServerPort,
        headers: { host: 'test.localhost' }
      }, res => {
        expect(res).to.have.property('statusCode', 418)
        controller.terminate()
        done()
      })
      remoteReq.end()
    })
  })

})
