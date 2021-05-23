#!/usr/bin/env node
import { join } from 'path'
import { readFileSync } from 'fs'
import { program } from 'commander'
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

program
  .command('client <serverUrl>', { isDefault: true })
  .alias('c')
  .description('start a local tunnel client')
  .requiredOption('-t, --token <token>', 'access token for the tunnel server')
  .requiredOption('-d, --subdomain <name>', 'subdomain for the tunneled app')
  .option('-p, --local-port <port>', 'port number of the local app', '3000')
  .option('-l, --local-host <host>', 'hostname of the local app', 'localhost')
  .option('--secure', 'use https to connect to the local app', false)
  .option('--verbose', 'log requests arriving through the tunnel', false)
  .action((serverUrl, { token, secure, localHost, localPort, verbose }) => {

  })

program.parse()
