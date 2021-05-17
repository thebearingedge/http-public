import { IncomingMessage as Req } from 'http'

export const getHostname = (value: unknown): string | undefined => {
  if (!isString(value)) return
  try {
    return new URL(`http://${value}`).hostname
  } catch (err) {}
}

export const getRequestHead = (req: Req): string => {
  let head = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    head += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`
  }
  return head + '\r\n'
}

export const isUndefined = (value: unknown): value is void => {
  return typeof value === 'undefined'
}

export const isString = (value: unknown): value is string => {
  return typeof value === 'string'
}

export const noop = (..._args: any[]): void => {}