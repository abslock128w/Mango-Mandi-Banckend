// A Server-Sent Events parser for a streaming fetch body (pure, unit-tested in
// tests/unit/ops-sse.unit.ts). Feed it text as it arrives; it returns the complete events.

export interface SseMessage {
  event: string
  data: string
  id: string | null
}

export function createSseParser() {
  let buffer = ''
  return function push(chunk: string): SseMessage[] {
    buffer += chunk.replace(/\r\n?/g, '\n')
    const out: SseMessage[] = []
    let cut: number
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 2)
      let event = 'message'
      let id: string | null = null
      const data: string[] = []
      for (const line of block.split('\n')) {
        if (!line || line.startsWith(':')) continue
        const colon = line.indexOf(':')
        const field = colon < 0 ? line : line.slice(0, colon)
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
        if (field === 'event') event = value
        else if (field === 'data') data.push(value)
        else if (field === 'id') id = value
      }
      if (data.length || event !== 'message') out.push({ event, data: data.join('\n'), id })
    }
    return out
  }
}

/** The JSON in an event's data, or null when it is not JSON. */
export function parseData<T>(m: SseMessage): T | null {
  try {
    return JSON.parse(m.data) as T
  } catch {
    return null
  }
}

/** Waits before reconnect attempt n (1, 2, 4 … 30 s, with a little jitter). */
export const backoffMs = (attempt: number, jitter = Math.random()) => Math.min(30_000, 1000 * 2 ** Math.max(0, attempt - 1)) * (0.85 + 0.3 * jitter)

/** After this many failed connects in a row the panel polls every POLL_MS instead. */
export const FAILS_BEFORE_POLLING = 3
export const POLL_MS = 15_000
