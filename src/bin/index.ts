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
  .command('client <remote> [local]', { isDefault: true })
  .alias('c')
  .description('start a local tunnel client', {
    remote: 'public server origin \n(example: https://tunnel.my.site)',
    local: 'local server origin \n(default: http://localhost:3000)'
  })
  .requiredOption('-t, --token <token>', 'access token for the tunnel server')
  .requiredOption('-d, --subdomain <name>', 'subdomain for the tunnel')
  .option('-l, --log', 'log requests arriving through the tunnel', false)
  .option('-c, --connections <count>', 'number of connections to open', '10')
  .action((remoteAddress, localAddress, config) => {
    const remote = new URL(remoteAddress)
    const local = new URL(localAddress)
    const connections = parseInt(config.connections, 10)
    const options = { ...config, remote, local, connections }
    createClient(options, (err, client) => {
      if (err != null) throw err
    })
  })

program
  .command('server')
  .alias('s')
  .description('start a public tunnel server')
  .requiredOption('-t, --token <token>', 'access token required for clients')
  .option('-h, --host <host>', 'hostname of the server', 'localhost')
  .option('-a, --address <address>', 'ip address to listen on', '0.0.0.0')
  .option('-p, --port <port>', 'port number to listen on', '1111')
  .action(({ token, address, host, port }) => {
    createServer({ host, token }).listen(port, address, () => {
      // eslint-disable-next-line no-console
      console.log(`http-public listening at ${address}:${port} for ${host}\n`)
    })
  })

program.parse()
