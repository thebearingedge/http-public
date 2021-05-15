export const getHostname = (value: unknown): string | undefined => {
  if (!isString(value)) return
  try {
    return new URL(`http://${value}`).hostname
  } catch (err) { }
}

export const isUndefined = (value: unknown): value is void => {
  return typeof value === 'undefined'
}

export const isString = (value: unknown): value is string => {
  return typeof value === 'string'
}

export const noop = (...args: any[]): void => {}
