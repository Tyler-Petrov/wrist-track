// Stand-in for @zeppos/zml/base-side, so app-side/index.js can run under
// `node --test`. The settings store is the Zepp app's key-value storage,
// which the Side Service uses for both preferences and its caches.
const store = new Map()

export const settingsLib = {
  getItem: (key) => (store.has(key) ? store.get(key) : ''),
  setItem: (key, value) => {
    store.set(key, String(value))
  },
  removeItem: (key) => {
    store.delete(key)
  }
}

/** zml wraps the options object; nothing the tests exercise needs the wrapper. */
export function BaseSideService(options) {
  return options
}

export function resetSettings(initial = {}) {
  store.clear()
  for (const key of Object.keys(initial)) store.set(key, String(initial[key]))
}

export function readSetting(key) {
  return store.has(key) ? store.get(key) : ''
}

export function writeSetting(key, value) {
  store.set(key, String(value))
}
