// Minimal Chrome DevTools Protocol client for driving the Zepp OS Simulator.
// The simulator is an Electron app; it picks a fresh debugging port on every
// launch and records it in the first line of DevToolsActivePort.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

function port() {
  if (process.env.SIM_CDP_PORT) return process.env.SIM_CDP_PORT
  return readFileSync(`${homedir()}/.config/simulator/DevToolsActivePort`, 'utf8').split('\n')[0].trim()
}

export async function targets() {
  const response = await fetch(`http://127.0.0.1:${port()}/json/list`)
  return response.json()
}

export async function findTarget(match) {
  const list = await targets()
  const target = list.find((item) => item.title === match || item.url.includes(match))
  if (!target) throw new Error(`No CDP target matching "${match}" in ${list.map((i) => i.title).join(', ')}`)
  return target
}

export function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  const pending = new Map()
  const listeners = new Map()
  let nextId = 1

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve())
    socket.addEventListener('error', (event) => reject(new Error(`CDP socket error: ${event.message || 'unknown'}`)))
  })

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result)
      return
    }
    ;(listeners.get(message.method) || []).forEach((handler) => handler(message.params))
  })

  return {
    ready,
    on(method, handler) {
      listeners.set(method, [...(listeners.get(method) || []), handler])
    },
    async send(method, params = {}) {
      await ready
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    async evaluate(expression) {
      const result = await this.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true
      })
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
      }
      return result.result.value
    },
    close() {
      socket.close()
    }
  }
}

export async function attach(match) {
  const client = connect(await findTarget(match))
  await client.ready
  return client
}
