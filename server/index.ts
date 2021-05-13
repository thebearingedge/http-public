import { createServer } from './create-server'

// eslint-disable-next-line no-console
const log = (...data: any[]): void => console.log('Server -', ...data)

const server = createServer()

server.listen(3000, () => {
  log('listening:', server.address())
})
