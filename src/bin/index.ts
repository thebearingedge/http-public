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
  .command('serve')
  .alias('s')
  .description('start a public tunnel server')
  .option('-p, --port <port>', 'port to listen on', '80')
  .option('-a, --address <address>', 'ip address to listen on', '0.0.0.0')
  .option('-h, --host <host>', 'public hostname of the server', 'localhost')
  .requiredOption('-t, --token <token>', 'access token required for clients')
  .action(({ token, address, host, port }) => {
    createServer({ host, token }).listen(port, address)
  })

program.parse()
