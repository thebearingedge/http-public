import WebSocketClient from 'ws'
import retry from 'promise-retry'

// eslint-disable-next-line no-console
const log = (...data: any[]): void => console.log('Client:', ...data)

;(function main(): void {

  ;(async () => {

    const client = await createClient()

    client
      .on('close', (...args: any[]) => {
        log('closed', args)
        client.removeAllListeners()
        main()
      })
      .on('message', (...args: any[]) => {
        log('message', args)
      })
      .on('error', err => {
        console.error(err)
        process.exit(1)
      })

    client.send(JSON.stringify({ foo: 'bar' }))

  })().catch(err => {
    console.error(err)
    process.exit(1)
  })

})()

async function createClient(): Promise<WebSocketClient> {
  return await retry(async retry => {
    const client = new WebSocketClient('ws://localhost:3000')
    try {
      return await new Promise((resolve, reject) => {
        client.once('open', () => {
          client.removeAllListeners()
          resolve(client)
        })
        client.once('error', err => {
          client.removeAllListeners()
          reject(err)
        })
      })
    } catch (err) {
      return retry(err)
    }
  })
}
