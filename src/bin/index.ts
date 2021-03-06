#!/usr/bin/env node
import { join } from 'path'
import { readFileSync } from 'fs'
import { program } from 'commander'
import { createClient } from '../client'
import { createServer } from '../server'

process
  .on('SIGINT', () => process.exit())
  .on('SIGTERM', () => process.exit())
  .on('uncaughtException', err => {
    console.error(err)
    process.exit(1)
  })

const packageJSON = readFileSync(join(__dirname, '../../package.json'), 'utf8')
const { version } = JSON.parse(packageJSON)

program
  .name('http-public')
  .version(`v${version}`, '-v, --version', 'output the version number')
  .description('Forward HTTP traffic from the public Internet to localhost.')

program
  .command('client', { isDefault: true })
  .alias('c')
  .argument('<proxy>', 'public server origin \nexample: https://tunnel.my.site')
  .argument('[local]', 'local server origin \ndefault: http://localhost:3000')
  .requiredOption('-t, --token <token>', 'access token for the tunnel server')
  .requiredOption('-n, --subdomain <name>', 'subdomain for the tunnel')
  .option('-c, --connections <count>', 'number of connections to open', '10')
  .action((proxy, local, config) => {
    const proxyUrl = new URL(proxy)
    const localUrl = new URL(local)
    const connections = parseInt(config.connections, 10)
    if (Number.isNaN(connections)) {
      throw new Error('invalid argument for --connections')
    }
    const options = { ...config, proxyUrl, localUrl, connections }
    createClient(options, (err, publicUrl, client) => {
      if (err != null) throw err
      client?.connect()
      client?.on('error', console.error)
      // eslint-disable-next-line no-console
      console.log(`http-public proxy listening at ${publicUrl}`)
    })
  })

program
  .command('server')
  .alias('s')
  .description('start a public tunnel server')
  .requiredOption('-t, --token <token>', 'access token required for clients')
  .option('-n, --host <name>', 'hostname of the server', 'localhost')
  .option('-a, --address <address>', 'ip address to listen on', '127.0.0.1')
  .option('-p, --port <port>', 'port number to listen on', '1111')
  .action(({ token, address, host, port }) => {
    createServer({ host, token }).listen(port, address, () => {
      // eslint-disable-next-line no-console
      console.log(`http-public listening at ${address}:${port} for ${host}`)
    })
  })

program.parse()
