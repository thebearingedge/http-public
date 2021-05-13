import { createClient } from './create-client'

// eslint-disable-next-line no-console
const log = (...data: any[]): void => console.log('Client -', ...data)

;(function main(): void {

  ;(async () => {

    const client = await createClient('ws://test.localhost:3000')
    log('connected')
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
        console.error('Client -', err)
        process.exit(1)
      })

  })().catch(err => {
    console.error(err)
    process.exit(1)
  })

})()
